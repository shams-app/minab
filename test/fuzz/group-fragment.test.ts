/**
 * Production plan phase P2: a group expression with hostile text literals never changes the shape of the host's
 * statement.
 *
 * Each fragment goes into `SELECT <fragment> AS v FROM (VALUES …) AS b(…) GROUP BY ()`. That statement must give exactly
 * one row, or the compile answer is a coded error. A text answer must be one of the program's own literals, byte for
 * byte: a quote, a backslash, `--`, `;`, `/*` or a letter from another script stays inside its literal.
 */

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { scalarType, type MinabSchema } from '../../src/language/schema.js';
import { createMinab } from '../../src/runtime/index.js';
import { openTestDatabase, type TestDatabase } from '../support/database.js';
import { FUZZ_RUNS, FUZZ_SEED, fuzzParams } from './support.js';

const scalar = (base: Parameters<typeof scalarType>[0], nullable = true) => ({ kind: 'scalar' as const, type: scalarType(base, { nullable }) });
const schema: MinabSchema = {
    version: 'fuzz-group-fragment',
    tables: [
        {
            name: 'Sale',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID', false) },
                { name: 'A', type: scalar('DECIMAL') },
                { name: 'N', type: scalar('INTEGER') },
                { name: 'T', type: scalar('TEXT') }
            ]
        }
    ]
};

/** The group rows, as SQL. The values are fixed: the fuzzing is in the program text. */
const ROWS = `(VALUES (1.5::numeric, 2::bigint, 'x'::text), (NULL::numeric, 0::bigint, NULL::text), (-4::numeric, 7::bigint, 'y'::text))`;
const STATEMENT = (fragment: string) => `SELECT ${fragment} AS v FROM ${ROWS} AS b("A", "N", "T") GROUP BY ()`;

/** Text made of the characters that break naive quoting. */
const hostile = fc
    .array(fc.constantFrom("'", "''", '\\', '\\\\', '"', '--', ';', '/*', '*/', '$1', '$$', 'E', ' ', '\n', '\t', 'a', '1', 'ب', 'ş', '😀', ')'), {
        maxLength: 12
    })
    .map(parts => parts.join(''));

/** The same text as a Minab string literal. */
const minabText = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const aggregate = fc.constantFrom('SUM(.A)', 'COUNT(.)', 'COUNT(.T)', 'MAX(.N)', 'AVG(.N)', 'SUM(.A * .N)');
const condition = fc
    .tuple(aggregate, fc.constantFrom('>', '<', '==', '!='), fc.integer({ min: -5, max: 5 }))
    .map(([a, op, n]) => `${a} ${op} ${n}`)
    .chain(c =>
        fc.oneof(
            fc.constant(c),
            hostile.map(t => `${c} OR MAX(.T) == ${minabText(t)}`)
        )
    );

/** A text program and the literals its answer may be. */
const textProgram = fc.oneof(
    fc.tuple(condition, hostile, hostile).map(([c, a, b]) => ({ source: `if ${c} { ${minabText(a)} } else { ${minabText(b)} }`, answers: [a, b] })),
    fc.tuple(hostile, hostile).map(([a, b]) => ({ source: `switch COUNT(.) { 3 => ${minabText(a)}, _ => ${minabText(b)} }`, answers: [a, b] })),
    fc.tuple(condition, hostile).map(([c, a]) => ({ source: `if ${c} { ${minabText(a)} } else { MAX(.T) }`, answers: [a, 'y'] }))
);

/** A number program: aggregates, literals and every operator. */
const numberProgram = fc
    .tuple(
        aggregate,
        fc.constantFrom('+', '-', '*', '/', '%', '\\'),
        fc.oneof(
            aggregate,
            fc.integer({ min: -3, max: 3 }).map(n => `(${n})`)
        )
    )
    .map(([a, op, b]) => ({ source: `${a} ${op} ${b}`, answers: undefined }));

let db: TestDatabase;

beforeAll(async () => {
    db = await openTestDatabase();
}, 60_000);

afterAll(async () => {
    await db?.close();
});

describe(`group expression fragments (seed ${FUZZ_SEED}, ${FUZZ_RUNS} cases)`, () => {
    test('a fragment never changes the statement shape, and text stays inside its literal', async () => {
        const minab = createMinab({ schema });
        await fc.assert(
            fc.asyncProperty(fc.oneof(textProgram, numberProgram), async ({ source, answers }) => {
                const prepared = await minab.prepare(source, { ruleContext: { isFieldRule: false, groupTable: 'Sale' } });
                expect(
                    prepared.diagnostics.filter(d => d.severity === 'error'),
                    source
                ).toEqual([]);
                const fragment = prepared.compileGroupExpression({ column: name => `b."${name}"` });
                if (!fragment.ok) {
                    expect(fragment.error.code, `${source} -> ${fragment.error.message}`).toMatch(/^compile\./);
                    return;
                }
                const rows = await db.query(STATEMENT(fragment.sql));
                expect(rows, `${source}\n${fragment.sql}`).toHaveLength(1);
                if (answers) expect(answers, `${source}\n${fragment.sql}`).toContain(rows[0].v);
            }),
            fuzzParams()
        );
    }, 300_000);
});
