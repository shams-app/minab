import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
 * `check-only` examples are the constructs the evaluator doesn't execute yet. Since X6 every
 * construct runs, so no example is check-only; the suite still knows the label, so a new
 * construct that arrives before its execution can be pinned the same way.
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

/**
 * Each example keeps its own expected result in `examples/<name>/expected.json`
 * (see `examples/README.md`), so two phases that change different examples
 * never edit the same file. A folder that holds `<name>.minab` is an example
 * and must have the file. A folder without such a program is not an example
 * (later: `examples/nestjs`, `examples/browser`) and is ignored.
 */
const exampleDirectories = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .filter(name => existsSync(join(EXAMPLES_DIR, name, `${name}.minab`)));

function loadExample(name: string): RunExample | CheckOnlyExample {
    const raw = JSON.parse(readFileSync(join(EXAMPLES_DIR, name, 'expected.json'), 'utf8')) as Record<string, unknown>;
    if (raw.mode === 'run') {
        return { name, mode: 'run', json: raw.json, statements: raw.statements as number, compiles: raw.compiles as boolean };
    }
    return { name, mode: 'check-only', refusal: new RegExp(raw.refusal as string) };
}

describe('examples/ keeps one expected.json per example', () => {
    test('there are examples to test', () => {
        expect(exampleDirectories.length).toBeGreaterThan(0);
    });

    test.each(exampleDirectories)('%s has an expected.json that says how it is checked', name => {
        const file = join(EXAMPLES_DIR, name, 'expected.json');
        expect(existsSync(file), `examples/${name}/expected.json is missing`).toBe(true);
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (raw.mode === 'run') {
            expect(Object.keys(raw).sort()).toEqual(['compiles', 'json', 'mode', 'statements']);
            expect(typeof raw.statements).toBe('number');
            expect(typeof raw.compiles).toBe('boolean');
        } else {
            expect(raw.mode).toBe('check-only');
            expect(Object.keys(raw).sort()).toEqual(['mode', 'refusal']);
            expect(typeof raw.refusal).toBe('string');
        }
    });

    test.each(exampleDirectories)('%s holds its program, its config and its expected result, and nothing else runnable', name => {
        const files = readdirSync(join(EXAMPLES_DIR, name)).sort();
        expect(files).toEqual([`${name}.minab`, 'expected.json', 'minab.config.json'].sort());
    });
});

// An example without `expected.json` fails the guard above; the others still run.
const MANIFEST: (RunExample | CheckOnlyExample)[] = exampleDirectories.filter(name => existsSync(join(EXAMPLES_DIR, name, 'expected.json'))).map(loadExample);

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
