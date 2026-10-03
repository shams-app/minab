import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { Diagnostic } from 'vscode-languageserver-types';
import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/host/config.js';
import type { Model } from '../src/language/generated/ast.js';
import { createMinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabRuleContext } from '../src/language/schema.js';

/**
 * Guard for the written language (L2).
 *
 * 1. Every Minab example in `docs/query-language-spec.md` and
 *    `docs/showcase.md` is parsed, and checked when the fixture schema
 *    (`test/fixtures/spec-schema.json`) has the tables it needs.
 * 2. The grammar block in spec §11 is the same text as
 *    `src/language/minab.langium` (whitespace and comments aside).
 *
 * A block is a fenced code block with no language tag, or the tag `minab`.
 * Blocks tagged `json`, `sql`, `ts`, `console`, `langium` and so on are not
 * examples. A block is named by its file, its section and its place in that
 * section (counted from 1): `spec §6.1 #2`.
 *
 * When you add or change an example, nothing needs to change here: a new
 * example is parsed and checked by default. This file lists only the blocks
 * that are not plain programs (`NOT_PROGRAMS`), the ones that need help to be
 * checked (`CHECK`), and the ones that are wrong on purpose (`ERRORS`).
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

// ---- finding the blocks ---------------------------------------------------

type File = 'spec' | 'showcase';

interface Block {
    file: File;
    /** Like `§6.1`. */
    section: string;
    /** Place in the section, from 1. */
    index: number;
    source: string;
}

const key = (b: Pick<Block, 'file' | 'section' | 'index'>) => `${b.file} ${b.section} #${b.index}`;

const FENCE = '`'.repeat(3);

function blocksOf(file: File, path: string): Block[] {
    const blocks: Block[] = [];
    const counts = new Map<string, number>();
    let section = '';
    let open: { info: string; lines: string[] } | undefined;
    for (const line of read(path).split('\n')) {
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
            blocks.push({ file, section, index, source: lines.join('\n') });
        } else if (line.startsWith(FENCE)) {
            open = { info: line.slice(FENCE.length).trim(), lines: [] };
        } else {
            const heading = /^#{2,4} (\d+(?:\.\d+)*)\.? /.exec(line);
            if (heading) section = `§${heading[1]}`;
        }
    }
    return blocks;
}

const spec = read('../docs/query-language-spec.md');
const blocks = [...blocksOf('spec', '../docs/query-language-spec.md'), ...blocksOf('showcase', '../docs/showcase.md')];
const byKey = new Map(blocks.map(b => [key(b), b]));

// ---- what is not a plain program ---------------------------------------------

/** Blocks that are not Minab programs. They are skipped, each with its reason. */
const NOT_PROGRAMS: Record<string, string> = {
    'spec §3.4 #1': 'shows a wrong line with a ✗ note',
    'spec §3.4 #2': 'three separate WHERE clauses, not a query',
    'spec §3.5 #1': 'shows a wrong line with a ✗ note',
    'spec §4.1 #1': 'clause template',
    'spec §5.1 #1': 'precedence list',
    'spec §5.5 #1': 'CAST template',
    'spec §5.6 #1': 'is/isnot template',
    'spec §6.3 #1': 'excerpt of the grammar; the tests for §11 below check it',
    'spec §5.6 #2': 'uses { ... } as a placeholder',
    'spec §7.1 #1': 'declaration template',
    'spec §7.6 #1': 'tuple type template',
    'spec §7.7 #1': 'shows wrong lines with ✗ notes',
    'spec §8.1 #1': 'function template',
    'spec §8.1 #2': 'uses ... as a placeholder body',
    'spec §9.1 #1': 'if template',
    'spec §9.1.1 #1': 'if! template',
    'spec §9.2 #1': 'switch template',
    'spec §9.3 #1': 'assignment template',
    'spec §9.4 #1': 'loop template',
    'spec §10.1 #1': 'INSERT template',
    'spec §10.2 #1': 'DELETE template',
    'spec §10.3 #1': 'UPDATE template'
};

/** Blocks that hold several separate pieces. Each piece is its own program. */
const PIECES: Record<string, 'lines' | 'paragraphs'> = {
    'spec §5.3 #1': 'lines',
    'spec §5.5 #2': 'lines',
    'spec §7.6 #3': 'lines',
    'showcase §7 #6': 'lines',
    'showcase §9 #3': 'lines',
    'showcase §9 #4': 'paragraphs',
    'showcase §10 #4': 'lines'
};

// ---- how to check ------------------------------------------------------------

/** Who the program belongs to: the record under validation, and the field. */
type Context = 'none' | 'order' | 'customer' | 'booking' | 'orderTotal' | 'orderTextField' | 'orderIdField';

const CONTEXTS: Record<Context, MinabRuleContext> = {
    none: { isFieldRule: false },
    order: { isFieldRule: false, recordTable: 'Order' },
    customer: { isFieldRule: false, recordTable: 'Customer' },
    booking: { isFieldRule: false, recordTable: 'Booking' },
    orderTotal: { isFieldRule: true, fieldType: scalarType('DECIMAL'), recordTable: 'Order' },
    orderTextField: { isFieldRule: true, fieldType: scalarType('TEXT'), recordTable: 'Order' },
    orderIdField: { isFieldRule: true, fieldType: scalarType('UUID'), recordTable: 'Order' }
};

const DEFAULT_CONTEXT: Context = 'order';

/** Functions the spec calls but never declares. */
const STUBS = 'fn cumulativeAdd(inputs: INTEGER[]): INTEGER { 0 }\nfn notifyManager(customerId: UUID): BOOLEAN { true }';

interface CheckSetup {
    context?: Context;
    /** Declarations put in front: `STUBS`, or another block's text. */
    prelude?: (block: (key: string) => string) => string;
    /** The block is only parsed. This is the reason. */
    parseOnly?: string;
}

const COLLECTION_FILTER_BUG =
    'a filter on a to-many column at the top of a rule does not type-check yet ("needs a statically known table"; see docs/status.md, "Next job")';
const NO_RECORD_TABLE = 'needs a record table with relations (doctor, customers) that the fixture does not have';

const CHECK: Record<string, CheckSetup> = {
    'spec §3.1 #1': { context: 'customer' },
    'spec §3.2 #1': { parseOnly: COLLECTION_FILTER_BUG },
    'spec §3.2 #2': { parseOnly: COLLECTION_FILTER_BUG },
    'spec §3.3 #1': { context: 'orderIdField' },
    'spec §5.3 #1': { parseOnly: COLLECTION_FILTER_BUG },
    'spec §6.1 #1': { context: 'booking' },
    'spec §6.1 #2': { parseOnly: COLLECTION_FILTER_BUG },
    'spec §6.1 #3': { context: 'booking' },
    'spec §6.2 #1': { context: 'orderTextField' },
    'spec §6.2 #2': { context: 'orderTotal' },
    'spec §6.2 #3': { context: 'orderIdField' },
    'spec §6.3 #2': { context: 'booking' },
    'spec §6.3 #3': { context: 'order' },
    'spec §7.4 #2': { parseOnly: COLLECTION_FILTER_BUG },
    'spec §8.4 #1': { context: 'customer', prelude: () => STUBS },
    'spec §8.4 #2': { prelude: block => block('spec §8.2 #1') },
    'spec §9.1 #4': { prelude: () => STUBS },
    'spec §9.1 #5': { prelude: block => block('spec §8.2 #2') },
    'spec §9.2 #4': { context: 'customer' },
    'spec §9.3 #3': { parseOnly: NO_RECORD_TABLE },
    'spec §9.3 #4': { parseOnly: NO_RECORD_TABLE },
    'spec §9.3 #5': { parseOnly: NO_RECORD_TABLE },
    'spec §9.3 #6': { parseOnly: NO_RECORD_TABLE },
    'spec §9.4 #4': { parseOnly: COLLECTION_FILTER_BUG },
    'spec §10.1 #2': { parseOnly: NO_RECORD_TABLE },
    'spec §10.2 #2': { parseOnly: NO_RECORD_TABLE },
    'spec §10.3 #2': { parseOnly: NO_RECORD_TABLE },
    'spec §10.3 #3': { parseOnly: NO_RECORD_TABLE },
    'showcase §1 #1': { context: 'booking' },
    'showcase §1 #2': { context: 'orderTotal' },
    'showcase §1 #3': { parseOnly: COLLECTION_FILTER_BUG },
    'showcase §2 #1': { context: 'booking' },
    'showcase §9 #4': { parseOnly: NO_RECORD_TABLE },
    'showcase §10 #2': { prelude: block => block('showcase §10 #1') },
    'showcase §10 #4': { context: 'customer', prelude: block => block('showcase §10 #1') },
    'showcase §11 #2': { context: 'customer' },
    'showcase §11 #4': { prelude: () => STUBS },
    'showcase §11 #6': { prelude: () => STUBS },
    'showcase §12 #3': { parseOnly: COLLECTION_FILTER_BUG },
    'showcase §13 #1': { parseOnly: NO_RECORD_TABLE },
    'showcase §13 #2': { parseOnly: NO_RECORD_TABLE },
    'showcase §13 #3': { parseOnly: NO_RECORD_TABLE },
    'showcase §13 #4': { parseOnly: NO_RECORD_TABLE },
    'showcase §13 #5': { parseOnly: NO_RECORD_TABLE }
};

/**
 * Blocks that are wrong on purpose. The spec says so in the text next to
 * them. Each one must make the checker report this code.
 */
interface ExpectedError {
    file: File;
    section: string;
    index: number;
    expect: string;
    context?: Context;
}

const ERRORS: ExpectedError[] = [
    { file: 'showcase', section: '§7', index: 4, expect: 'type.initializerMismatch' },
    { file: 'showcase', section: '§7', index: 7, expect: 'null.orderingWithNull', context: 'order' },
    { file: 'showcase', section: '§10', index: 5, expect: 'call.functionNameCase' },
    { file: 'showcase', section: '§11', index: 3, expect: 'type.initializerMismatch', context: 'customer' }
];
const expectedErrors = new Map(ERRORS.map(e => [key(e), e]));

// ---- parsing and checking -------------------------------------------------

const schemaSpec = JSON.parse(read('./fixtures/spec-schema.json')) as { tables: unknown[] };
const schema = parseConfig({ schema: schemaSpec }).schema;

const bare = parseHelper<Model>(createMinabServices(EmptyFileSystem).Minab);
const checkers = new Map<Context, ReturnType<typeof parseHelper<Model>>>();

function checker(context: Context) {
    let helper = checkers.get(context);
    if (!helper) {
        helper = parseHelper<Model>(createMinabServices(EmptyFileSystem, schema, CONTEXTS[context]).Minab);
        checkers.set(context, helper);
    }
    return helper;
}

const messageOf = (d: Diagnostic) => (typeof d.message === 'string' ? d.message : (d.message as { value: string }).value);

async function parseErrors(source: string): Promise<string[]> {
    const { parseResult } = await bare(source);
    return [...parseResult.lexerErrors, ...parseResult.parserErrors].map(e => e.message);
}

async function checkDiagnostics(source: string, context: Context): Promise<Diagnostic[]> {
    const document = await checker(context)(source, { validation: true });
    return (document.diagnostics ?? []).filter(d => d.severity === 1);
}

function pieces(block: Block): string[] {
    const mode = PIECES[key(block)];
    if (mode === 'lines') return block.source.split('\n').filter(line => line.trim() !== '' && !line.trim().startsWith('//'));
    if (mode === 'paragraphs') return block.source.split(/\n\s*\n/).filter(part => part.trim() !== '');
    return [block.source];
}

const prelude = (block: Block): string => {
    const make = CHECK[key(block)]?.prelude;
    if (!make) return '';
    return (
        make(name => {
            const found = byKey.get(name);
            if (!found) throw new Error(`prelude names a block that does not exist: ${name}`);
            return found.source;
        }) + '\n'
    );
};

// ---- the tests --------------------------------------------------------------

describe('the lists in this file match the documents', () => {
    test('every listed block exists', () => {
        const listed = [...Object.keys(NOT_PROGRAMS), ...Object.keys(PIECES), ...Object.keys(CHECK), ...ERRORS.map(key)];
        expect(listed.filter(name => !byKey.has(name))).toEqual([]);
    });

    test('the documents still have examples to test', () => {
        expect(blocks.length).toBeGreaterThan(100);
    });
});

describe('spec and showcase examples', () => {
    for (const block of blocks) {
        const name = key(block);
        if (name in NOT_PROGRAMS) continue;
        const expected = expectedErrors.get(name);
        const setup = CHECK[name] ?? {};

        test(`${name}: parses`, async () => {
            for (const part of pieces(block)) expect(await parseErrors(part), part).toEqual([]);
        });

        if (setup.parseOnly) continue;

        if (expected) {
            test(`${name}: is wrong on purpose (${expected.expect})`, async () => {
                const codes = (await checkDiagnostics(block.source, expected.context ?? DEFAULT_CONTEXT)).map(d => d.code);
                expect(codes).toContain(expected.expect);
            });
            continue;
        }

        test(`${name}: checks without errors`, async () => {
            const context = setup.context ?? DEFAULT_CONTEXT;
            for (const part of pieces(block)) {
                const errors = await checkDiagnostics(prelude(block) + part, context);
                expect(errors.map(messageOf), `${part}\n(context: ${context})`).toEqual([]);
            }
        });
    }
});

// ---- spec §11 against the grammar file ------------------------------------

/** Drops comments and extra whitespace, then splits the text into rules. */
function rulesOf(text: string): string[] {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n\r]*/g, ' ')
        .split(';')
        .map(rule => rule.replace(/\s+/g, ' ').trim())
        .filter(rule => rule !== '');
}

function grammarDifference(documented: string[], real: string[]): string {
    const lines: string[] = [];
    const nameOf = (rule: string) => /^(?:hidden )?(?:entry |terminal |fragment )?(\w+)/.exec(rule)?.[1] ?? rule;
    const realByName = new Map(real.map(rule => [nameOf(rule), rule]));
    const documentedByName = new Map(documented.map(rule => [nameOf(rule), rule]));
    for (const [name, rule] of documentedByName) {
        const other = realByName.get(name);
        if (other === undefined) lines.push(`only in spec §11: ${name}\n  spec:    ${rule}`);
        else if (other !== rule) lines.push(`different rule: ${name}\n  spec:    ${rule}\n  grammar: ${other}`);
    }
    for (const [name, rule] of realByName) {
        if (!documentedByName.has(name)) lines.push(`only in minab.langium: ${name}\n  grammar: ${rule}`);
    }
    if (lines.length === 0 && documented.join(';') !== real.join(';')) lines.push('same rules, different order');
    return lines.join('\n');
}

describe('spec §11 grammar block', () => {
    const grammarBlock = /^## 11\. .*\n[\s\S]*?^```langium\n([\s\S]*?)^```/m.exec(spec)?.[1];

    test('the spec has a grammar block in §11', () => {
        expect(grammarBlock).toBeDefined();
    });

    test('is the same as src/language/minab.langium', () => {
        const difference = grammarDifference(rulesOf(grammarBlock ?? ''), rulesOf(read('../src/language/minab.langium')));
        expect(difference, `spec §11 and src/language/minab.langium differ:\n${difference}`).toBe('');
    });

    test('the grammar excerpt in §6.3 is part of it', () => {
        const excerpt = byKey.get('spec §6.3 #1')?.source ?? '';
        const normal = (text: string) => rulesOf(text).join(' ; ');
        expect(normal(grammarBlock ?? '')).toContain(normal(excerpt));
    });

    test('the difference report names a changed rule', () => {
        const changed = rulesOf(grammarBlock ?? '').map(rule => (rule.startsWith('WhereClause') ? "WhereClause: 'WHERE' condition=Expression extra" : rule));
        const difference = grammarDifference(changed, rulesOf(read('../src/language/minab.langium')));
        expect(difference).toContain('different rule: WhereClause');
    });
});
