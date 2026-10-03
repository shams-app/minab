/**
 * Production plan phase R5: program analysis (`PreparedProgram.analysis`).
 *
 * Part 1 pins each construct family. Part 2 is the proof by running: every
 * program of the spec, the showcase and the examples that analysis calls
 * `local` runs with a data port that fails the test when it is called.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { loadConfigFile } from '../src/cli/config.js';
import { parseConfig } from '../src/host/config.js';
import type { QueryExecutor } from '../src/language/minab-executor.js';
import type { MinabRuleContext } from '../src/language/schema.js';
import { createMinab } from '../src/runtime/index.js';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const spec = JSON.parse(readFileSync(here('./fixtures/spec-schema.json'), 'utf8')) as { tables: unknown[] };
const { schema } = parseConfig({ schema: spec });

const order: MinabRuleContext = { isFieldRule: false, recordTable: 'Order' };
const customer: MinabRuleContext = { isFieldRule: false, recordTable: 'Customer' };

async function analyze(source: string, ruleContext: MinabRuleContext = order, localHostFunctions: string[] = []) {
    const minab = createMinab({ schema: { ...schema, version: 'analysis' }, ruleContext, localHostFunctions });
    const program = await minab.prepare(source);
    minab.dispose();
    return program;
}

describe('analysis: the cases of the card', () => {
    test('plain record fields are local', async () => {
        const { analysis } = await analyze('.total > .discount_rate');
        expect(analysis.tier).toBe('local');
        expect(analysis.needsData).toBe(false);
        expect(analysis.recordFields).toEqual(['discount_rate', 'total']);
        expect(analysis.tables).toEqual([]);
        expect(analysis.writes).toBe(false);
    });

    test('a filter on a collection needs data', async () => {
        const { analysis } = await analyze('COUNT(.orders[.status == "x"]) < 5', customer);
        expect(analysis.tier).toBe('data');
        expect(analysis.needsData).toBe(true);
        expect(analysis.tables).toEqual(['Order']);
        expect(analysis.recordFields).toEqual(['orders']);
        expect(analysis.builtins).toEqual(['COUNT']);
    });

    test('crossing a relation needs data', async () => {
        const { analysis } = await analyze('.customer.name == "Ada"');
        expect(analysis.tier).toBe('data');
        expect(analysis.recordFields).toEqual(['customer']);
        expect(analysis.tables).toEqual(['Customer']);
    });

    test('a host input stays local', async () => {
        const { analysis } = await analyze('currentUser.id == .id');
        expect(analysis.tier).toBe('local');
        expect(analysis.inputs).toEqual(['currentUser']);
        expect(analysis.recordFields).toEqual(['id']);
    });

    test('a local host function stays local, another one needs data', async () => {
        const local = await analyze('slugify(.status) == "x"', order, ['slugify']);
        expect(local.analysis.hostFunctions).toEqual(['slugify']);
        expect(local.analysis.tier).toBe('local');
        const remote = await analyze('slugify(.status) == "x"');
        expect(remote.analysis.hostFunctions).toEqual(['slugify']);
        expect(remote.analysis.needsData).toBe(true);
        expect(remote.analysis.tier).toBe('data');
    });

    test('a user function that reads #Order makes the rule data', async () => {
        const { analysis } = await analyze('fn big(): BOOLEAN { COUNT(#Order) > 3 }\nbig()');
        expect(analysis.tier).toBe('data');
        expect(analysis.userFunctions).toEqual(['big']);
        expect(analysis.tables).toEqual(['Order']);
    });
});

describe('analysis: construct families', () => {
    test('sigils: $ and the whole record', async () => {
        const field: MinabRuleContext = {
            ...order,
            isFieldRule: true,
            fieldType: { kind: 'scalar', base: 'DECIMAL', nullable: false, array: false, arrayNullable: false }
        };
        const dollar = (await analyze('$ > 1', field)).analysis;
        expect(dollar.readsFieldValue).toBe(true);
        expect(dollar.tier).toBe('local');
        const whole = (await analyze('. == .')).analysis;
        expect(whole.readsWholeRecord).toBe(true);
        expect(whole.recordFields).toEqual([]);
    });

    test('#T and FROM read a table', async () => {
        expect((await analyze('COUNT(#Order)')).analysis).toMatchObject({ tier: 'data', tables: ['Order'], recordFields: [] });
        const query = (await analyze('FROM Order AS o JOIN Customer AS c ON o.customer_id == c.id WHERE .total > 1 SELECT .id')).analysis;
        expect(query.tier).toBe('data');
        expect(query.tables).toEqual(['Customer', 'Order']);
        expect(query.recordFields).toEqual([]);
    });

    test('a subquery reads a table, and ^ reaches the record', async () => {
        const { analysis } = await analyze('COUNT((FROM Order WHERE .total > ^.total SELECT .id)) > 0', order);
        expect(analysis.tier).toBe('data');
        expect(analysis.tables).toEqual(['Order']);
        expect(analysis.recordFields).toEqual(['total']);
    });

    test('a filter over a local list does not need data', async () => {
        const { analysis } = await analyze('COUNT([1, 2, 3][. > ^.total]) > 1');
        expect(analysis.tier).toBe('local');
        expect(analysis.recordFields).toEqual(['total']);
        expect(analysis.builtins).toEqual(['COUNT']);
    });

    test('both branches of if and switch count', async () => {
        const branch = (await analyze('if .total > 1 { true } else { COUNT(#Order) > 1 }')).analysis;
        expect(branch.tier).toBe('data');
        expect(branch.tables).toEqual(['Order']);
        const sw = (await analyze('switch .status { "a" => true, _ => COUNT(#Order) > 1 }')).analysis;
        expect(sw.tier).toBe('data');
        const flat = (await analyze('switch .status { "a" => .total > 1, _ => .total > 2 }')).analysis;
        expect(flat.tier).toBe('local');
    });

    test('user functions follow calls, also through other functions and recursion', async () => {
        const chain = (await analyze('fn a(x: INTEGER): INTEGER { COUNT(#Order) + x }\nfn b(x: INTEGER): INTEGER { a(x) }\nb(1) > 0')).analysis;
        expect(chain.userFunctions).toEqual(['a', 'b']);
        expect(chain.tier).toBe('data');
        const local = (await analyze('fn dbl(x: DECIMAL): DECIMAL { x * 2 + .total }\ndbl(.total) > 1')).analysis;
        expect(local.tier).toBe('local');
        expect(local.recordFields).toEqual(['total']);
        expect(local.inputs).toEqual([]);
        const recursive = (await analyze('fn f(x: INTEGER): INTEGER { f(x) }\nf(1) > 0')).analysis;
        expect(recursive.userFunctions).toEqual(['f']);
    });

    test('variables and loop variables are not inputs', async () => {
        const { analysis } = await analyze('let n: INTEGER = 1;\nloop i from 1 to 3 { n += i; }\nn > 1');
        expect(analysis.inputs).toEqual([]);
        expect(analysis.tier).toBe('local');
        expect(analysis.writes).toBe(false);
    });

    test('DML and record path assignment write', async () => {
        const insert = (await analyze('INSERT #Order VALUES { total: 1 };\ntrue')).analysis;
        expect(insert).toMatchObject({ writes: true, needsData: true, tier: 'data' });
        const update = (await analyze('UPDATE #Order WHERE .total > 1 SET { status: "x" };\ntrue')).analysis;
        expect(update).toMatchObject({ writes: true, tier: 'data' });
        const remove = (await analyze('DELETE #Order WHERE .total > 1;\ntrue')).analysis;
        expect(remove).toMatchObject({ writes: true, tier: 'data' });
        const assign = (await analyze('.total = 1;\ntrue')).analysis;
        expect(assign).toMatchObject({ writes: true, needsData: false, tier: 'data' });
    });

    test('no record table: a field read is data (it cannot be told from a relation)', async () => {
        const { analysis } = await analyze('.total > 1', { isFieldRule: false });
        expect(analysis.tier).toBe('data');
    });

    test('a syntax error gets the safe answer', async () => {
        const broken = await analyze('.total >');
        expect(broken.ok).toBe(false);
        expect(broken.analysis).toMatchObject({ tier: 'data', needsData: true, writes: true, readsWholeRecord: true });
    });

    test('a type error is still analyzed', async () => {
        const unknown = await analyze('slugify(.status) == "x"', order, ['slugify']);
        expect(unknown.ok).toBe(false);
        expect(unknown.analysis).toMatchObject({ tier: 'local', hostFunctions: ['slugify'] });
    });
});

describe('dependsOn', () => {
    test('lists the fields a change can affect', async () => {
        const rule = await analyze('.total > .discount_rate');
        expect(rule.dependsOn('total')).toBe(true);
        expect(rule.dependsOn('discount_rate')).toBe(true);
        expect(rule.dependsOn('status')).toBe(false);
    });

    test('a relation also depends on its foreign key', async () => {
        const rule = await analyze('.customer.name == "Ada"');
        expect(rule.dependsOn('customer')).toBe(true);
        expect(rule.dependsOn('customer_id')).toBe(true);
        expect(rule.dependsOn('status')).toBe(false);
    });

    test('the whole record depends on every field', async () => {
        const rule = await analyze('. == .');
        expect(rule.dependsOn('anything')).toBe(true);
    });

    test('a broken program depends on every field', async () => {
        expect((await analyze('.total >')).dependsOn('status')).toBe(true);
    });
});

// ---- the proof by running ----------------------------------------------------

const FENCE = '`'.repeat(3);

/** Plain and `minab` code blocks of a Markdown file. Each block, and each of its lines, is a candidate program. */
function candidates(path: string): string[] {
    const found: string[] = [];
    let open: { info: string; lines: string[] } | undefined;
    for (const line of readFileSync(here(path), 'utf8').split('\n')) {
        if (open) {
            if (!line.startsWith(FENCE)) {
                open.lines.push(line);
                continue;
            }
            const { info, lines } = open;
            open = undefined;
            if (info !== '' && info !== 'minab') continue;
            found.push(lines.join('\n'));
            for (const piece of lines.join('\n').split(/\n\s*\n/)) found.push(piece);
            for (const one of lines) if (one.trim() !== '' && !one.trim().startsWith('//')) found.push(one);
        } else if (line.startsWith(FENCE)) {
            open = { info: line.slice(FENCE.length).trim(), lines: [] };
        }
    }
    return found;
}

describe('proof by running: a program called local never calls the data port', () => {
    const calls: string[] = [];
    const throwing: QueryExecutor = {
        execute(query) {
            calls.push(query.text);
            throw new Error(`the data port was called: ${query.text}`);
        }
    };
    const contexts: MinabRuleContext[] = [order, customer, { isFieldRule: false, recordTable: 'Booking' }, { isFieldRule: false }];
    const record = { id: 'x', total: 1, status: 'new', discount_rate: 0, customer_id: 'c' };

    async function prove(minabSchema: typeof schema, sources: string[], contextList: MinabRuleContext[]) {
        let local = 0;
        for (const context of contextList) {
            const minab = createMinab({ schema: { ...minabSchema, version: 'proof' }, ruleContext: context });
            for (const source of new Set(sources)) {
                const program = await minab.prepare(source);
                if (program.analysis.tier !== 'local') continue;
                local++;
                await program.run({ record, fieldValue: 1 }, { data: throwing });
                expect(calls, source).toEqual([]);
            }
            minab.dispose();
        }
        return local;
    }

    test('spec and showcase programs', async () => {
        const sources = [...candidates('../docs/query-language-spec.md'), ...candidates('../docs/showcase.md')];
        const local = await prove(schema, sources, contexts);
        expect(local).toBeGreaterThan(20);
    });

    test('example programs', async () => {
        const root = here('../examples');
        let local = 0;
        for (const name of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())) {
            const dir = join(root, name.name);
            const config = loadConfigFile(join(dir, 'minab.config.json'));
            const source = readFileSync(join(dir, `${name.name}.minab`), 'utf8');
            local += await prove(config.schema, [source], [config.ruleContext]);
        }
        expect(local).toBeGreaterThanOrEqual(0);
    });
});
