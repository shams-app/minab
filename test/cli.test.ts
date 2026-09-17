import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadConfigFile, ConfigError } from '../src/cli/config.js';
import { formatDiagnostic, summarize } from '../src/cli/diagnostics.js';
import { DataSourceError, FixtureExecutor } from '../src/cli/executors.js';
import { EXIT_OK, EXIT_PROGRAM_ERROR, EXIT_USAGE_ERROR, formatSql, formatValue, runCli, type CliIo } from '../src/cli/main.js';

/**
 * Phase 6's CLI. These drive `runCli` in-process rather than spawning
 * `node out/...`, so a failure points at a line of TypeScript instead of
 * at a subprocess, and so the suite doesn't depend on a prior build.
 *
 * The assertions are deliberately about what a *user sees* — the exit
 * code, the message, the caret — since that is the whole deliverable of
 * this phase. Everything underneath it already has its own suite.
 */

let dir: string;

/** Captures what the CLI wrote, the way a terminal would show it. */
class Capture implements CliIo {
    readonly stdout: string[] = [];
    readonly stderr: string[] = [];

    constructor(readonly cwd: string) {}

    out(text: string): void { this.stdout.push(text); }
    err(text: string): void { this.stderr.push(text); }

    get output(): string { return this.stdout.join('\n'); }
    get errors(): string { return this.stderr.join('\n'); }
}

const CONFIG = {
    schema: {
        tables: [
            {
                name: 'Booking',
                primaryKey: 'id',
                columns: { id: 'UUID', room_id: 'UUID', start_date: 'DATE', end_date: 'DATE' }
            },
            {
                name: 'Customer',
                primaryKey: 'id',
                columns: {
                    id: 'UUID',
                    name: 'TEXT',
                    country: 'TEXT?',
                    orders: { collection: 'Order', foreignKey: 'customer_id' }
                }
            },
            {
                name: 'Order',
                primaryKey: 'id',
                columns: {
                    id: 'UUID',
                    customer: { ref: 'Customer', foreignKey: 'customer_id' },
                    total: 'DECIMAL'
                }
            }
        ]
    },
    rule: { recordTable: 'Booking' },
    record: { id: 'b-1', room_id: 'room-7', start_date: '2026-10-01', end_date: '2026-10-05' },
    data: { responses: [{ match: 'EXISTS', value: false }] }
};

const OVERLAP_RULE = `.end_date > .start_date AND NOT EXISTS(
    #Booking[. != ^ AND .room_id == ^.room_id
             AND .start_date < ^.end_date AND .end_date > ^.start_date]
)`;

function write(name: string, contents: string): string {
    const path = join(dir, name);
    writeFileSync(path, contents);
    return path;
}

function writeJson(name: string, value: unknown): string {
    return write(name, JSON.stringify(value, null, 2));
}

async function cli(...argv: string[]): Promise<Capture & { code: number }> {
    const capture = new Capture(dir);
    const code = await runCli(argv, capture);
    return Object.assign(capture, { code });
}

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'minab-cli-'));
    writeJson('minab.config.json', CONFIG);
    write('rule.minab', OVERLAP_RULE);
    write('query.minab', 'FROM Order GROUPBY .customer HAVING SUM(.total) > 1000 SELECT KEY.name AS name, SUM(.total) AS spent');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('minab run', () => {
    test('evaluates a validation rule against the configured record and data', async () => {
        const result = await cli('run', 'rule.minab');
        expect(result.errors).toBe('');
        expect(result.output).toBe('true');
        expect(result.code).toBe(EXIT_OK);
    });

    test('--trace shows the one statement the correlated check pushes down', async () => {
        const result = await cli('run', 'rule.minab', '--trace');
        expect(result.stderr).toHaveLength(1);
        expect(result.stderr[0]).toContain('SELECT EXISTS');
        // The local half (`.end_date > .start_date`) never reaches SQL —
        // ADR 0001's pushdown boundary, visible from the command line.
        expect(result.stderr[0]).not.toContain('end_date >');
    });

    test('prints query rows as a table', async () => {
        const config = { ...CONFIG, data: { responses: [{ rows: [{ name: 'Ada', spent: 1700 }] }] } };
        writeJson('rows.config.json', config);
        const result = await cli('run', 'query.minab', '--config', 'rows.config.json');
        expect(result.output).toBe(['name  spent', '----  -----', 'Ada   1700'].join('\n'));
    });

    test('--json prints the value instead of the table', async () => {
        const config = { ...CONFIG, data: { responses: [{ rows: [{ name: 'Ada' }] }] } };
        writeJson('json.config.json', config);
        const result = await cli('run', 'query.minab', '--config', 'json.config.json', '--json');
        expect(JSON.parse(result.output)).toEqual([{ name: 'Ada' }]);
    });

    test('--field supplies `$` for a field rule', async () => {
        writeJson('field.config.json', {
            ...CONFIG,
            rule: { recordTable: 'Booking', isFieldRule: true, fieldType: 'INTEGER' },
            data: { responses: [] }
        });
        write('field.minab', '$ > 10');
        const passing = await cli('run', 'field.minab', '--config', 'field.config.json', '--field', '42');
        expect(passing.output).toBe('true');
        const failing = await cli('run', 'field.minab', '--config', 'field.config.json', '--field', '4');
        expect(failing.output).toBe('false');
    });

    test('a program needing data with no data source says so, and shows the unanswered statement', async () => {
        writeJson('nodata.config.json', { ...CONFIG, data: { responses: [] } });
        const result = await cli('run', 'rule.minab', '--config', 'nodata.config.json');
        expect(result.code).toBe(EXIT_PROGRAM_ERROR);
        expect(result.errors).toContain('no data source was configured');
        expect(result.errors).toContain('SELECT EXISTS');
    });

    test('a construct the evaluator does not implement yet reports its reason, not a stack trace', async () => {
        // Loops are Phase 5's explicit "next increment" (spec §9.4).
        write('loop.minab', 'loop n from 0 to 3 { }');
        const result = await cli('run', 'loop.minab');
        expect(result.code).toBe(EXIT_PROGRAM_ERROR);
        expect(result.errors).toContain('minab: cannot evaluate this program:');
        expect(result.errors).not.toContain('at ');
    });
});

describe('minab compile', () => {
    test('prints the SQL and its parameters', async () => {
        const result = await cli('compile', 'query.minab');
        expect(result.code).toBe(EXIT_OK);
        expect(result.output).toContain('FROM "Order" GROUP BY "Order"."customer_id"');
        expect(result.output).toContain('-- parameters\n--   $1 = 1000');
    });

    test('--json prints the statement as data', async () => {
        const result = await cli('compile', 'query.minab', '--json');
        expect(JSON.parse(result.output)).toMatchObject({ params: [1000] });
    });

    test('a program with no SQL form points at `run` instead of failing blankly', async () => {
        write('fn.minab', 'fn double(x: INTEGER): INTEGER { x * 2 }\n&double(21)');
        const result = await cli('compile', 'fn.minab');
        expect(result.code).toBe(EXIT_PROGRAM_ERROR);
        expect(result.errors).toContain('does not compile to SQL on its own');
        expect(result.errors).toContain('minab run');
        // ...and `run` really does handle it.
        expect((await cli('run', 'fn.minab')).output).toBe('42');
    });
});

describe('minab check', () => {
    test('accepts a valid program', async () => {
        const result = await cli('check', 'rule.minab');
        expect(result.code).toBe(EXIT_OK);
        expect(result.output).toBe('rule.minab: no problems found');
    });

    test('reports a syntax error with a caret, and nothing else', async () => {
        write('syntax.minab', '.end_date >> .start_date');
        const result = await cli('check', 'syntax.minab');
        expect(result.code).toBe(EXIT_PROGRAM_ERROR);
        expect(result.errors).toContain('syntax.minab:1:12: error:');
        expect(result.errors).toContain('1 | .end_date >> .start_date');
        expect(result.errors).toContain('  |            ^');
        // A half-recovered AST would otherwise produce type errors *about
        // the typo's fallout*, which is noise on top of the real message.
        expect(result.errors).not.toContain('infer');
        expect(result.stderr[result.stderr.length - 1]).toBe('minab: 1 error — not a valid program');
    });

    test('reports a type error once, at the innermost node that caused it', async () => {
        write('type.minab', 'FROM Booking WHERE .room_id == "x" SELECT .id');
        const result = await cli('check', 'type.minab');
        expect(result.code).toBe(EXIT_PROGRAM_ERROR);
        const reported = result.stderr.filter(line => line.includes('requires an explicit CAST'));
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain('type.minab:1:20: error:');
    });

    test('an unknown table is a validation error, not a crash', async () => {
        write('unknown.minab', 'EXISTS(#Nonexistent[.id == "x"])');
        const result = await cli('check', 'unknown.minab');
        expect(result.code).toBe(EXIT_PROGRAM_ERROR);
        expect(result.errors).toContain('Nonexistent');
    });
});

describe('usage', () => {
    test('--help and --version succeed', async () => {
        expect((await cli('--help')).output).toContain('minab <command> [options] <file.minab>');
        expect((await cli('--version')).output).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('a bad invocation exits 2 and points at --help', async () => {
        for (const argv of [[], ['dance', 'x.minab'], ['run'], ['run', '--bogus', 'x.minab'], ['run', '--config']]) {
            const result = await cli(...argv);
            expect(result.code, argv.join(' ')).toBe(EXIT_USAGE_ERROR);
            expect(result.errors).toContain('minab: ');
        }
    });

    test('a missing program file, and a missing config file, both exit 2', async () => {
        expect((await cli('check', 'nope.minab')).code).toBe(EXIT_USAGE_ERROR);
        expect((await cli('check', 'rule.minab', '--config', 'nope.json')).code).toBe(EXIT_USAGE_ERROR);
    });

    test('options accept --name=value as well as --name value', async () => {
        const result = await cli('run', 'rule.minab', '--config=minab.config.json');
        expect(result.output).toBe('true');
    });

    test('the config is found next to the program, not in the working directory', async () => {
        // `cwd` here is the temp dir's parent, so only upward discovery
        // from the program's own directory can find the config.
        const capture = new Capture(tmpdir());
        expect(await runCli(['run', join(dir, 'rule.minab')], capture)).toBe(EXIT_OK);
        expect(capture.output).toBe('true');
    });
});

describe('the config file', () => {
    test('expands the column-type shorthand', () => {
        const path = writeJson('shorthand.json', {
            schema: { tables: [{ name: 'T', columns: { a: 'TEXT', b: 'TEXT?', c: 'INTEGER[]', d: 'TEXT?[]?' } }] }
        });
        const columns = loadConfigFile(path).schema.tables[0].columns;
        expect(columns.map(c => c.type)).toEqual([
            { kind: 'scalar', type: { kind: 'scalar', base: 'TEXT', nullable: false, array: false, arrayNullable: false } },
            { kind: 'scalar', type: { kind: 'scalar', base: 'TEXT', nullable: true, array: false, arrayNullable: false } },
            { kind: 'scalar', type: { kind: 'scalar', base: 'INTEGER', nullable: false, array: true, arrayNullable: false } },
            { kind: 'scalar', type: { kind: 'scalar', base: 'TEXT', nullable: true, array: true, arrayNullable: true } }
        ]);
    });

    test('carries the relation shapes execution needs', () => {
        const path = writeJson('relations.json', {
            schema: {
                tables: [{
                    name: 'T',
                    primaryKey: 'id',
                    columns: {
                        one: { ref: 'U', foreignKey: 'u_id', nullable: false },
                        many: { collection: 'U', foreignKey: 't_id' }
                    }
                }]
            }
        });
        const table = loadConfigFile(path).schema.tables[0];
        expect(table.primaryKey).toBe('id');
        expect(table.columns[0].type).toEqual({ kind: 'ref', table: 'U', nullable: false, foreignKey: 'u_id' });
        expect(table.columns[1].type).toEqual({ kind: 'collection', table: 'U', foreignKey: 't_id' });
    });

    test('declaring a field type is enough to mean "this is a field rule"', () => {
        const path = writeJson('fieldrule.json', { rule: { fieldType: 'INTEGER' } });
        expect(loadConfigFile(path).ruleContext).toMatchObject({ isFieldRule: true });
    });

    test('a bad type names the JSON path that caused it', () => {
        const path = writeJson('badtype.json', { schema: { tables: [{ name: 'T', columns: { a: 'STRING' } }] } });
        expect(() => loadConfigFile(path)).toThrow(ConfigError);
        expect(() => loadConfigFile(path)).toThrow(/schema\.tables\[0\]\.columns\.a: unknown type "STRING"/);
    });

    test('invalid JSON is reported as invalid JSON', () => {
        const path = write('broken.json', '{ "schema": ');
        expect(() => loadConfigFile(path)).toThrow(/invalid JSON/);
    });
});

describe('the fixture data source', () => {
    test('answers in order, first matching response wins', async () => {
        const executor = new FixtureExecutor([
            { match: 'COUNT', rows: [{ value: 3 }] },
            { rows: [{ value: 'anything else' }] }
        ]);
        expect(await executor.execute({ text: 'SELECT COUNT(*) ...', params: [] })).toEqual([{ value: 3 }]);
        expect(await executor.execute({ text: 'SELECT 1', params: [] })).toEqual([{ value: 'anything else' }]);
        expect(executor.statements).toHaveLength(2);
    });

    test('an unmatched statement is an error, not an empty result', async () => {
        const executor = new FixtureExecutor([{ match: 'COUNT', rows: [] }]);
        await expect(executor.execute({ text: 'SELECT 1', params: [] })).rejects.toThrow(DataSourceError);
    });
});

describe('output formatting', () => {
    test('a diagnostic underlines its own span', () => {
        const diagnostic = {
            severity: 1 as const,
            range: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } },
            message: 'boom'
        };
        expect(formatDiagnostic(diagnostic, 'first\n    total == 1\n', 'x.minab')).toBe(
            ['x.minab:2:5: error: boom', '2 |     total == 1', '  |     ^^^^^'].join('\n')
        );
    });

    test('a multi-line message keeps its detail under the caret', () => {
        const diagnostic = {
            severity: 1 as const,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: 'headline\ndetail'
        };
        expect(formatDiagnostic(diagnostic, 'x', 'x.minab').split('\n')).toEqual([
            'x.minab:1:1: error: headline', '1 | x', '  | ^', '  | detail'
        ]);
    });

    test('summarize counts by severity', () => {
        expect(summarize([{ severity: 1, range: r(), message: 'a' }, { severity: 2, range: r(), message: 'b' }]))
            .toBe('1 error, 1 warning');
        expect(summarize([])).toBe('');
    });

    test('parameters are printed as pasteable SQL comments', () => {
        expect(formatSql({ text: 'SELECT $1', params: ['x'] })).toBe('SELECT $1\n-- parameters\n--   $1 = "x"');
        expect(formatSql({ text: 'SELECT 1', params: [] })).toBe('SELECT 1');
    });

    test('an empty result set says so rather than printing an empty table', () => {
        expect(formatValue([])).toBe('(no rows)');
        expect(formatValue(null)).toBe('null');
        expect(formatValue(true)).toBe('true');
    });

    test('a table pads to the widest cell and renders null', () => {
        expect(formatValue([{ a: 1, b: null }, { a: 22, b: 'x' }])).toBe(
            ['a   b', '--  ----', '1   null', '22  x'].join('\n')
        );
    });
});

function r() {
    return { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
}
