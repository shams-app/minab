/**
 * The golden corpus (Q5, decision D38): programs from a release, with what that release said about them.
 * `compat.test.ts` runs every folder of `corpus/` against today's code. `scripts/compat-snapshot.mjs`
 * writes a new folder from the current code. Both use this file, so they cannot drift apart.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureExecutor } from '../../src/host/fixture-executor.js';
import { parseConfig, parseRuleContext, type FixtureResponse } from '../../src/host/config.js';
import { createMinab, type MinabRuleContext, type MinabSchema } from '../../src/runtime/index.js';

/** The rule context as a config file writes it (`rule` in `minab.config.json`). */
export type ContextSpec = Record<string, string | boolean>;

export interface RunExpectation {
    ok: boolean;
    /** The value as JSON, when the run worked. */
    value?: unknown;
    /** The error code, when it failed. */
    code?: string;
    /** How many statements reached the data source. */
    statements: number;
}

export interface CorpusEntry {
    context?: ContextSpec;
    /** A config file of the corpus folder: the program is an example with its own schema and data. */
    config?: string;
    /** The codes of all diagnostics `prepare` gave, in order. */
    check: string[];
    /** Only for programs that run on a fixture. */
    run?: RunExpectation;
}

export type CorpusExpected = Record<string, CorpusEntry>;

/** The same instant for every run, so dates in answers do not change. */
const CLOCK = { now: () => new Date('2026-01-15T12:00:00Z'), timeZone: 'UTC' };

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

/** The folders of `corpus/`, oldest name first. */
export function corpusVersions(corpusRoot: string): string[] {
    if (!existsSync(corpusRoot)) return [];
    return readdirSync(corpusRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** Checks one program, and runs it when it has a config with a fixture. */
export async function evaluateEntry(
    dir: string,
    schema: MinabSchema,
    program: string,
    entry: Pick<CorpusEntry, 'context' | 'config'>
): Promise<Omit<CorpusEntry, 'context' | 'config'>> {
    const source = readFileSync(join(dir, program), 'utf8');
    let context: MinabRuleContext = parseRuleContext(entry.context, 'context');
    let useSchema = schema;
    let responses: FixtureResponse[] = [];
    let record: Record<string, unknown> | undefined;
    let fieldValue: unknown;
    if (entry.config) {
        const config = parseConfig(readJson(join(dir, entry.config)));
        useSchema = config.schema;
        context = config.ruleContext;
        responses = config.responses;
        record = config.record;
        fieldValue = config.fieldValue;
    }
    const minab = createMinab({ schema: useSchema, ruleContext: context });
    try {
        const prepared = await minab.prepare(source);
        const check = prepared.diagnostics.map(d => d.code);
        if (!entry.config || !prepared.ok) return { check };
        const data = new FixtureExecutor(responses);
        const result = await prepared.run({ record, fieldValue }, { data, clock: CLOCK }, { writes: 'dry-run' });
        const statements = data.statements.length;
        const run: RunExpectation = result.ok
            ? { ok: true, value: JSON.parse(JSON.stringify(result.value ?? null)), statements }
            : { ok: false, code: result.error.code, statements };
        return { check, run };
    } finally {
        minab.dispose();
    }
}

// ---- building a corpus folder ---------------------------------------------

const FENCE = '`'.repeat(3);

/** Plain program blocks of a Markdown file (no tag or `minab`), named like `spec-6-1-2`. */
function blocksOf(prefix: string, text: string): { name: string; source: string }[] {
    const blocks: { name: string; source: string }[] = [];
    const counts = new Map<string, number>();
    let section = '';
    let open: { info: string; lines: string[] } | undefined;
    for (const line of text.split('\n')) {
        if (open) {
            if (!line.startsWith(FENCE)) {
                open.lines.push(line);
                continue;
            }
            const { info, lines } = open;
            open = undefined;
            if (info !== '' && info !== 'minab') continue;
            const index = (counts.get(section) ?? 0) + 1;
            counts.set(section, index);
            blocks.push({ name: `${prefix}-${section}-${index}`, source: lines.join('\n') });
        } else if (line.startsWith(FENCE)) {
            open = { info: line.slice(FENCE.length).trim(), lines: [] };
        } else {
            const heading = /^#{2,4} (\d+(?:\.\d+)*)\.? /.exec(line);
            if (heading) section = heading[1].replaceAll('.', '-');
        }
    }
    return blocks;
}

/** Contexts a spec or showcase block may be written for. The first one that checks clean is kept. */
const CONTEXTS: ContextSpec[] = [
    { recordTable: 'Order' },
    {},
    { recordTable: 'Customer' },
    { recordTable: 'Booking' },
    { recordTable: 'Order', fieldType: 'DECIMAL' },
    { recordTable: 'Order', fieldType: 'TEXT' },
    { recordTable: 'Order', fieldType: 'UUID' }
];

/**
 * Writes `<corpusRoot>/<version>/` from the current code: the spec and showcase blocks that check clean in
 * some context, and every example with its config. Returns how many programs it wrote.
 */
export async function writeCorpus(root: string, corpusRoot: string, version: string): Promise<number> {
    const dir = join(corpusRoot, version);
    if (existsSync(dir)) throw new Error(`${dir} exists. A corpus folder is never changed by the snapshot script.`);
    mkdirSync(dir, { recursive: true });
    const schemaText = readFileSync(join(root, 'test/fixtures/spec-schema.json'), 'utf8');
    writeFileSync(join(dir, 'schema.json'), schemaText);
    const schema = parseConfig({ schema: JSON.parse(schemaText) }).schema;
    const expected: CorpusExpected = {};
    const seen = new Set<string>();

    const docs = [
        ...blocksOf('spec', readFileSync(join(root, 'docs/query-language-spec.md'), 'utf8')),
        ...blocksOf('showcase', readFileSync(join(root, 'docs/showcase.md'), 'utf8'))
    ];
    for (const block of docs) {
        const source = block.source.trim() + '\n';
        if (seen.has(source)) continue;
        const file = `${block.name}.minab`;
        writeFileSync(join(dir, file), source);
        let kept: Omit<CorpusEntry, 'config'> | undefined;
        for (const context of CONTEXTS) {
            const result = await evaluateEntry(dir, schema, file, { context });
            // Only programs that are valid today: they are the ones a host may have stored.
            if (result.check.length === 0) {
                kept = { context, ...result };
                break;
            }
        }
        if (kept) {
            expected[file] = kept;
            seen.add(source);
        } else {
            // Not a program in any context (a template, or wrong on purpose). Remove it again.
            const { rmSync } = await import('node:fs');
            rmSync(join(dir, file));
        }
    }

    const examples = join(root, 'examples');
    for (const name of readdirSync(examples).sort()) {
        const program = join(examples, name, `${name}.minab`);
        if (!existsSync(program)) continue;
        const file = `example-${name}.minab`;
        const config = `example-${name}.config.json`;
        writeFileSync(join(dir, file), readFileSync(program));
        writeFileSync(join(dir, config), readFileSync(join(examples, name, 'minab.config.json')));
        expected[file] = { config, ...(await evaluateEntry(dir, schema, file, { config })) };
    }

    writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
    return Object.keys(expected).length;
}

/** Runs one corpus folder against today's code. Returns one line for each program whose answer changed. */
export async function compareCorpus(dir: string): Promise<string[]> {
    const schema = parseConfig({ schema: readJson(join(dir, 'schema.json')) }).schema;
    const expected = readJson(join(dir, 'expected.json')) as unknown as CorpusExpected;
    const problems: string[] = [];
    for (const [program, entry] of Object.entries(expected)) {
        const actual = await evaluateEntry(dir, schema, program, entry);
        const want = JSON.stringify({ check: entry.check, run: entry.run });
        const got = JSON.stringify(actual);
        if (want !== got) problems.push(`${program}: expected ${want}, got ${got}`);
    }
    return problems;
}
