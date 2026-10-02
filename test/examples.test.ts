import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { EXIT_OK, EXIT_PROGRAM_ERROR, runCli, type CliIo } from '../src/cli/main.js';

/**
 * Phase 8's `examples/`. Every program a reader is pointed at has to keep
 * working, so each one runs through the real CLI, in-process, exactly as the
 * README says to run it: `check` must be clean, and a `run` example must
 * produce its documented answer from the fixture in its own config.
 *
 * `check-only` examples are the constructs the evaluator doesn't execute yet
 * (loops, `INSERT`/`UPDATE`/`DELETE`). The suite pins that `run` refuses them
 * with an explicit reason — so when execution lands, this fails and the label
 * (and the README's "not executed yet" note) gets updated instead of rotting.
 */

const EXAMPLES_DIR = fileURLToPath(new URL('../examples/', import.meta.url));

class Capture implements CliIo {
    readonly stdout: string[] = [];
    readonly stderr: string[] = [];

    constructor(readonly cwd: string) {}

    out(text: string): void {
        this.stdout.push(text);
    }
    err(text: string): void {
        this.stderr.push(text);
    }

    get output(): string {
        return this.stdout.join('\n');
    }
    get errors(): string {
        return this.stderr.join('\n');
    }
}

async function cli(name: string, command: 'check' | 'run' | 'compile', ...flags: string[]) {
    const capture = new Capture(join(EXAMPLES_DIR, name));
    const code = await runCli([command, join(EXAMPLES_DIR, name, `${name}.minab`), ...flags], capture);
    return Object.assign(capture, { code });
}

interface RunExample {
    name: string;
    mode: 'run';
    /** What `minab run --json` prints. */
    json: unknown;
    /** How many statements reach the data source (`--trace`), i.e. the strategy, not just the answer. */
    statements: number;
    /** Compiles to SQL on its own, or is interpreted (`minab compile` refuses)? */
    compiles: boolean;
}

interface CheckOnlyExample {
    name: string;
    mode: 'check-only';
    /** Why `minab run` refuses it. */
    refusal: RegExp;
}

const MANIFEST: (RunExample | CheckOnlyExample)[] = [
    {
        name: 'first-query',
        mode: 'run',
        json: [
            { id: 'o-104', total: 980, customer_name: 'Ada Lovelace' },
            { id: 'o-87', total: 412.5, customer_name: 'Grace Hopper' }
        ],
        statements: 1,
        compiles: true
    },
    {
        name: 'top-customers',
        mode: 'run',
        json: [
            { customer_name: 'Ada Lovelace', total_spent: 4820.5, order_count: 12 },
            { customer_name: 'Grace Hopper', total_spent: 3180, order_count: 9 }
        ],
        statements: 1,
        compiles: true
    },
    {
        name: 'shipping-report',
        mode: 'run',
        json: [
            { id: 'o-104', total: 980, shipped_at: '2026-09-02T10:14:00Z' },
            { id: 'o-87', total: 412.5, shipped_at: '2026-09-05T16:40:00Z' }
        ],
        statements: 1,
        compiles: true
    },
    {
        name: 'cancelled-orders-limit',
        mode: 'run',
        json: [
            { id: 'c-1', name: 'Ada Lovelace' },
            { id: 'c-2', name: 'Grace Hopper' }
        ],
        statements: 1,
        compiles: true
    },
    // The rule's local half (`.end_date > .start_date`) is settled from the
    // record in hand; only the correlated half reaches the database.
    { name: 'booking-overlap', mode: 'run', json: true, statements: 1, compiles: false },
    { name: 'customer-exists', mode: 'run', json: true, statements: 1, compiles: false },
    // Pure interpreter work: no table is touched, so nothing reaches the data source.
    { name: 'discounted-total', mode: 'run', json: 170, statements: 0, compiles: false },
    { name: 'order-status-switch', mode: 'run', json: true, statements: 0, compiles: false },
    { name: 'overdue-loop', mode: 'check-only', refusal: /"LoopStatement" is not executed yet/ },
    { name: 'order-dml', mode: 'check-only', refusal: /"UpdateStatement" is not executed yet/ },
    { name: 'reconcile-overdue-accounts', mode: 'check-only', refusal: /"LoopStatement" inside a function body is not executed yet/ }
];

describe('examples/ stays in step with this manifest', () => {
    const onDisk = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();

    test('every example directory is listed, and every listed example exists', () => {
        expect(MANIFEST.map(example => example.name).sort()).toEqual(onDisk);
    });

    test.each(onDisk)('%s holds its program and its config, and nothing else runnable', name => {
        const files = readdirSync(join(EXAMPLES_DIR, name)).sort();
        expect(files).toEqual([`${name}.minab`, 'minab.config.json'].sort());
    });
});

describe.each(MANIFEST)('example: $name ($mode)', example => {
    test('check is clean', async () => {
        const result = await cli(example.name, 'check');
        expect(result.errors).toBe('');
        expect(result.output).toContain('no problems found');
        expect(result.code).toBe(EXIT_OK);
    });

    test('the header comment says how to run it', () => {
        const source = readFileSync(join(EXAMPLES_DIR, example.name, `${example.name}.minab`), 'utf8');
        expect(source.startsWith('//')).toBe(true);
        expect(source).toMatch(example.mode === 'run' ? /\/\/\s+minab (run|compile) / : /\/\/\s+minab check /);
        expect(source.includes('CHECK-ONLY')).toBe(example.mode === 'check-only');
    });

    if (example.mode === 'run') {
        test('run gives the documented answer', async () => {
            const result = await cli(example.name, 'run', '--json');
            expect(result.errors).toBe('');
            expect(JSON.parse(result.output)).toEqual(example.json);
            expect(result.code).toBe(EXIT_OK);
        });

        test(`sends ${example.statements} statement(s) to the data source`, async () => {
            const result = await cli(example.name, 'run', '--trace');
            const sent = result.errors.split('\n').filter(line => /^(SELECT|WITH|INSERT|UPDATE|DELETE)\b/.test(line));
            expect(sent).toHaveLength(example.statements);
        });

        test(example.compiles ? 'compile prints SQL' : 'compile explains it is interpreted', async () => {
            const result = await cli(example.name, 'compile');
            if (example.compiles) {
                expect(result.code).toBe(EXIT_OK);
                expect(result.output).toMatch(/^SELECT /);
            } else {
                expect(result.code).toBe(EXIT_PROGRAM_ERROR);
                expect(result.errors).toContain('minab run');
            }
        });
    } else {
        test('run refuses with an explicit reason, not a wrong answer', async () => {
            const result = await cli(example.name, 'run');
            expect(result.code).toBe(EXIT_PROGRAM_ERROR);
            expect(result.errors).toMatch(example.refusal);
            expect(result.output).toBe('');
        });
    }
});

describe('README output blocks match what the CLI really prints', () => {
    const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

    test('the query table for top-customers', async () => {
        const result = await cli('top-customers', 'run');
        expect(readme).toContain(result.output);
    });

    test('the compiled SQL for top-customers', async () => {
        const result = await cli('top-customers', 'compile');
        expect(readme).toContain(result.output);
    });

    test('the --trace output for booking-overlap', async () => {
        const result = await cli('booking-overlap', 'run', '--trace');
        // The README wraps the one-line statement to fit; compare with whitespace collapsed.
        const flat = (text: string) => text.replace(/\s+/g, ' ');
        expect(flat(readme)).toContain(flat(result.errors));
        expect(readme).toContain(result.output);
    });
});
