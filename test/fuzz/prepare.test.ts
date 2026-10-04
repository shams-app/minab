/**
 * Phase Q3: `prepare` never throws, and finishes each input in under 200 ms.
 *
 * Inputs: random token sequences, and programs from the spec, the showcase and the examples with
 * tokens deleted, swapped or repeated.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinab } from '../../src/runtime/index.js';
import { orderSchema } from '../support/runtime.js';
import { FUZZ_RUNS, FUZZ_SEED, fuzzParams } from './support.js';

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const minab = createMinab({ schema: orderSchema(), ruleContext: { recordTable: 'Order', isFieldRule: false } });
const TIME_LIMIT_MS = 200;

/** Splits a program into tokens (names, numbers, strings, quoted names, comments and single symbols). */
function tokens(source: string): string[] {
    return source.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|[\p{L}_][\p{L}\p{N}_]*|[0-9]+(?:\.[0-9]+)?|\S/gu) ?? [];
}

/** Every Minab block of the spec and the showcase, and every example program. */
function corpus(): string[] {
    const programs: string[] = [];
    for (const file of ['docs/query-language-spec.md', 'docs/showcase.md']) {
        const text = readFileSync(root(file), 'utf8');
        for (const match of text.matchAll(/```(minab)?\n([\s\S]*?)```/g)) programs.push(match[2]);
    }
    for (const dir of readdirSync(root('examples'), { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        for (const file of readdirSync(root(`examples/${dir.name}`))) {
            if (file.endsWith('.minab')) programs.push(readFileSync(root(`examples/${dir.name}/${file}`), 'utf8'));
        }
    }
    return programs.filter(p => p.length > 0 && p.length < 4_000);
}

const VOCABULARY = [
    ...[
        'FROM',
        'WHERE',
        'SELECT',
        'GROUPBY',
        'HAVING',
        'ORDERBY',
        'LIMIT',
        'JOIN',
        'ON',
        'AS',
        'AND',
        'OR',
        'NOT',
        'IN',
        'LIKE',
        'IS',
        'NULL',
        'TRUE',
        'FALSE'
    ],
    ...['IF', 'THEN', 'ELSE', 'SWITCH', 'CASE', 'LET', 'LOOP', 'CAST', 'EXISTS', 'COUNT', 'SUM', 'INSERT', 'UPDATE', 'DELETE', 'LOG', 'RETURN'],
    ...['Order', 'Customer', 'total', 'status', 'id', 'x', 'y', '日本', 'ß', '`quoted name`'],
    ...[
        '(',
        ')',
        '[',
        ']',
        '{',
        '}',
        ',',
        ';',
        ':',
        '.',
        '^',
        '$',
        '#',
        '+',
        '-',
        '*',
        '/',
        '\\',
        '%',
        '==',
        '!=',
        '<',
        '<=',
        '>',
        '>=',
        '=',
        '&',
        '|',
        '!',
        '?'
    ],
    ...['0', '1', '42', '3.14', '"text"', "'it''s'", '"\\"', '"unterminated', '/* open', '// comment\n', '\u0000', '‮', '😀']
];

const tokenSequence = fc.array(fc.constantFrom(...VOCABULARY), { maxLength: 40 }).map(list => list.join(' '));

/** A corpus program with tokens deleted, swapped or repeated (at most 8 times each). */
function mutated(programs: string[]): fc.Arbitrary<string> {
    const edit = fc.oneof(
        fc.record({ kind: fc.constant('delete' as const), at: fc.nat(), count: fc.integer({ min: 1, max: 3 }) }),
        fc.record({ kind: fc.constant('swap' as const), at: fc.nat(), other: fc.nat() }),
        fc.record({ kind: fc.constant('repeat' as const), at: fc.nat(), count: fc.integer({ min: 2, max: 8 }) })
    );
    return fc.tuple(fc.constantFrom(...programs), fc.array(edit, { minLength: 1, maxLength: 4 })).map(([program, edits]) => {
        const list = tokens(program);
        for (const e of edits) {
            if (list.length === 0) break;
            const at = e.at % list.length;
            if (e.kind === 'delete') list.splice(at, e.count);
            else if (e.kind === 'swap') [list[at], list[e.other % list.length]] = [list[e.other % list.length], list[at]];
            else list.splice(at, 1, ...Array<string>(e.count).fill(list[at]));
        }
        return list.join(' ');
    });
}

/** The property: `prepare` returns diagnostics and does not throw, and it is quick. */
async function prepared(source: string): Promise<void> {
    const started = performance.now();
    const program = await minab.prepare(source);
    const took = performance.now() - started;
    expect(Array.isArray(program.diagnostics)).toBe(true);
    for (const diagnostic of program.diagnostics) {
        expect(typeof diagnostic.code).toBe('string');
        expect(diagnostic.range.start.line).toBeGreaterThanOrEqual(0);
    }
    if (program.ok) expect(program.diagnostics.some(d => d.severity === 'error')).toBe(false);
    // A refused program does not run and does not compile; it does not throw either.
    if (!program.ok) {
        expect(await program.run({ record: {} }, {})).toMatchObject({ ok: false });
        expect(program.compile().ok).toBe(false);
    }
    if (took >= TIME_LIMIT_MS) throw new Error(`prepare took ${took.toFixed(0)} ms (limit ${TIME_LIMIT_MS} ms) for: ${JSON.stringify(source)}`);
}

describe(`prepare never throws (seed ${FUZZ_SEED}, ${FUZZ_RUNS} cases for each property)`, () => {
    beforeAll(async () => {
        // The language services are built on the first call. That is not what these tests measure.
        await minab.prepare('1');
    }, 60_000);

    test('random token sequences', async () => {
        await fc.assert(fc.asyncProperty(tokenSequence, prepared), fuzzParams());
    }, 600_000);

    test('random text, including odd Unicode', async () => {
        await fc.assert(fc.asyncProperty(fc.string({ unit: 'binary', maxLength: 120 }), prepared), fuzzParams());
    }, 600_000);

    test('programs of the spec, the showcase and the examples with tokens deleted, swapped or repeated', async () => {
        const programs = corpus();
        expect(programs.length).toBeGreaterThan(50);
        await fc.assert(fc.asyncProperty(mutated(programs), prepared), fuzzParams());
    }, 600_000);

    test('the corpus itself prepares without throwing', async () => {
        for (const program of corpus()) await prepared(program);
    }, 600_000);
});
