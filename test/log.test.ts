/**
 * Production plan phase L7 — `LOG` and the call statement (decisions D19, D36, D37).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EXIT_OK, runCli, type CliIo } from '../src/cli/main.js';
import { createMinab, type MinabEvent } from '../src/runtime/index.js';
import { orderSchema } from './support/runtime.js';

const minab = createMinab({ schema: orderSchema() });

async function run(source: string, limits?: { logEntries: number }) {
    const program = await minab.prepare(source);
    expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const events: MinabEvent[] = [];
    const result = await program.run({}, { events: { emit: event => events.push(event) } }, limits ? { limits } : {});
    return { result, program, logs: events.filter(e => e.kind === 'log') as Extract<MinabEvent, { kind: 'log' }>[] };
}

describe('LOG as an expression', () => {
    test('gives the value back unchanged and logs it', async () => {
        const { result, logs } = await run('LOG(2) + 1');
        expect(result).toMatchObject({ ok: true, value: 3, logs: ['2'] });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ message: '2', value: 2 });
        expect(logs[0].label).toBeUndefined();
        expect(logs[0].range).toBeDefined();
        expect(logs[0].time).toBeGreaterThanOrEqual(0);
    });

    test('a label comes first, and logs arrive in evaluation order', async () => {
        const { result } = await run('LOG(1, "first") + LOG(2, "second")');
        expect(result).toMatchObject({ ok: true, value: 3, logs: ['first: 1', 'second: 2'] });
    });

    test('a DECIMAL prints plainly, a null prints as null', async () => {
        const { result } = await run('LOG(CAST("24.50" AS DECIMAL), "price"); LOG(null);\n1');
        expect(result).toMatchObject({ ok: true, value: 1, logs: ['price: 24.5', 'null'] });
    });

    test('the right side of a short-circuited AND does not run', async () => {
        const { result, logs } = await run('false AND LOG(true)');
        expect(result).toMatchObject({ ok: true, value: false, logs: [] });
        expect(logs).toEqual([]);
    });

    test('a branch that is not taken does not log', async () => {
        const { result } = await run('if true { LOG(1, "yes") } else { LOG(2, "no") }');
        expect(result).toMatchObject({ ok: true, value: 1, logs: ['yes: 1'] });
    });

    test('a text with a newline is one line, so it cannot fake a second log line', async () => {
        const { result, logs } = await run('LOG("a\\nb: 1")');
        expect(result).toMatchObject({ ok: true });
        expect(logs[0].message).not.toContain('\n');
        expect(logs[0].message).toBe('"a\\nb: 1"');
        expect(logs[0].value).toBe('a\nb: 1');
    });

    test('a label with a newline is one line too', async () => {
        const { logs } = await run('LOG(1, "a\\nb")');
        expect(logs[0].message).toBe('a\\nb: 1');
    });
});

describe('the call statement', () => {
    test('LOG(x); works at the top level', async () => {
        const { result } = await run('let n: INTEGER = 5;\nLOG(n, "n");\nn * 2');
        expect(result).toMatchObject({ ok: true, value: 10, logs: ['n: 5'] });
    });

    test('LOG(x); works in a function body', async () => {
        const { result } = await run(`
            fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL {
                let cut: DECIMAL = LOG(total * rate / 100, "cut");
                LOG(cut);
                total - cut
            }
            discounted(200, 10)
        `);
        expect(result).toMatchObject({ ok: true, value: '180', logs: ['cut: 20', '20'] });
    });

    test('a call to a user function can stand alone; the value is dropped', async () => {
        const { result } = await run('fn f(n: INTEGER): INTEGER { LOG(n, "in f") }\nf(7);\n1');
        expect(result).toMatchObject({ ok: true, value: 1, logs: ['in f: 7'] });
    });

    test('a statement that is not a call is an error', async () => {
        const program = await minab.prepare('1 + 2;\n3');
        expect(program.diagnostics.map(d => d.code)).toContain('call.statementNotACall');
        expect(program.ok).toBe(false);
    });

    test('assignment and let still parse next to it', async () => {
        const { result } = await run('fn f(): INTEGER { let a: INTEGER = 1; a += 2; LOG(a); a }\nf()');
        expect(result).toMatchObject({ ok: true, value: 3, logs: ['3'] });
    });
});

describe('the limit (D36)', () => {
    test('150 logs with logEntries 100 keep 100 and set logsTruncated', async () => {
        // Loops do not run yet (X4), so the program has 150 statements.
        const source = `${Array.from({ length: 150 }, (_, i) => `LOG(${i});`).join('\n')}\n1`;
        const { result, logs } = await run(source, { logEntries: 100 });
        expect(result).toMatchObject({ ok: true, logsTruncated: true });
        if (!result.ok) throw new Error('expected ok');
        expect(result.logs).toHaveLength(100);
        expect(logs).toHaveLength(100);
    });

    test('under the limit there is no logsTruncated', async () => {
        const { result } = await run('LOG(1)');
        expect(result).toMatchObject({ ok: true });
        if (result.ok) expect(result.logsTruncated).toBeUndefined();
    });
});

describe('LOG in SQL (D19)', () => {
    test('a warning in a query clause, and the query still compiles as the plain value', async () => {
        const program = await minab.prepare('FROM Order WHERE LOG(.total, "t") > 1 SELECT .id');
        expect(program.diagnostics.map(d => [d.code, d.severity])).toEqual([['call.logInSql', 'warning']]);
        expect(program.ok).toBe(true);
        const sql = program.compile();
        expect(sql).toMatchObject({ ok: true });
        if (sql.ok) {
            expect(sql.sql.text).not.toContain('LOG');
            expect(sql.sql.params).toHaveLength(1);
        }
    });

    test('a warning in a filter on a collection', async () => {
        const program = await minab.prepare('COUNT(#Order[LOG(.total) > 1]) > 0');
        expect(program.diagnostics.map(d => d.code)).toEqual(['call.logInSql']);
    });

    test('no warning outside SQL', async () => {
        const program = await minab.prepare('COUNT(#Order) < LOG(5)');
        expect(program.diagnostics).toEqual([]);
    });

    test('the query still runs', async () => {
        const program = await minab.prepare('FROM Order WHERE LOG(.total) > 1 SELECT .id');
        const result = await program.run({}, { data: { execute: async () => [{ id: 'a' }] } });
        expect(result).toMatchObject({ ok: true, value: [{ id: 'a' }], logs: [] });
    });
});

describe('minab run', () => {
    let dir: string;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'minab-log-'));
        writeFileSync(join(dir, 'minab.config.json'), JSON.stringify({ schema: { tables: [] } }));
        writeFileSync(join(dir, 'rule.minab'), 'let n: INTEGER = 4;\nLOG(n, "n");\nLOG("a\\nb");\nn * 2');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    async function cli(...argv: string[]) {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const io: CliIo = { cwd: dir, out: t => stdout.push(t), err: t => stderr.push(t) };
        const code = await runCli(argv, io);
        return { code, stdout, stderr };
    }

    test('prints the logs to stderr as file:line:col label: value', async () => {
        const { code, stdout, stderr } = await cli('run', 'rule.minab');
        expect(code).toBe(EXIT_OK);
        expect(stdout).toEqual(['8']);
        expect(stderr).toEqual(['rule.minab:2:1 n: 4', 'rule.minab:3:1 "a\\nb"']);
    });

    test('--json keeps stdout parseable, and the logs stay on stderr', async () => {
        const { stdout, stderr } = await cli('run', '--json', 'rule.minab');
        expect(JSON.parse(stdout.join('\n'))).toBe(8);
        expect(stderr).toHaveLength(2);
    });

    test('--no-logs turns them off', async () => {
        const { stdout, stderr } = await cli('run', '--no-logs', 'rule.minab');
        expect(stdout).toEqual(['8']);
        expect(stderr).toEqual([]);
    });
});
