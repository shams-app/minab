/**
 * Production plan phase P1: random group expressions over random rows never throw.
 *
 * Every program checks. Every run is a value, `null`, or a coded error (`eval.integerOutOfRange` is the only one that
 * numbers can still make). Division by zero never fails in a group expression.
 */

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { scalarType, type MinabSchema } from '../../src/language/schema.js';
import { createMinab } from '../../src/runtime/index.js';
import { FUZZ_RUNS, FUZZ_SEED, fuzzParams } from './support.js';

const scalar = (base: Parameters<typeof scalarType>[0], nullable = true) => ({ kind: 'scalar' as const, type: scalarType(base, { nullable }) });
const schema: MinabSchema = {
    version: 'fuzz-group',
    tables: [
        {
            name: 'Sale',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID', false) },
                { name: 'A', type: scalar('DECIMAL') },
                { name: 'B', type: scalar('DECIMAL') },
                { name: 'N', type: scalar('INTEGER') }
            ]
        }
    ]
};

const column = fc.constantFrom('.A', '.B', '.N');
const rowExpression = fc.oneof(
    column,
    fc.tuple(column, fc.constantFrom('+', '-', '*', '/'), column).map(([a, op, b]) => `${a} ${op} ${b}`),
    fc.tuple(column, fc.integer({ min: 0, max: 3 })).map(([a, n]) => `${a} * ${n}`)
);
const aggregate = fc.tuple(fc.constantFrom('SUM', 'AVG', 'MIN', 'MAX', 'COUNT'), rowExpression).map(([fn, e]) => `${fn}(${e})`);
const term = fc.oneof(aggregate, fc.integer({ min: 0, max: 5 }).map(String));
const expression = fc.tuple(term, fc.constantFrom('+', '-', '*', '/', '%', '\\'), term).map(([a, op, b]) => `${a} ${op} ${b}`);
const program = fc.oneof(
    aggregate,
    expression,
    fc.tuple(expression, term).map(([e, t]) => `if ${e} > ${t} { ${e} } else { ${t} }`)
);

const number = fc.oneof(
    fc.constant(null),
    fc.integer({ min: -50, max: 50 }),
    fc.double({ min: -50, max: 50, noNaN: true }).map(n => n.toFixed(2))
);
const row = fc.record({ A: number, B: number, N: fc.oneof(fc.constant(null), fc.integer({ min: -9, max: 9 })) });
const rows = fc.array(row, { maxLength: 8 });

describe(`group expressions (seed ${FUZZ_SEED}, ${FUZZ_RUNS} cases)`, () => {
    test('every program checks, and every run is a value, null or a coded error', async () => {
        const minab = createMinab({ schema });
        await fc.assert(
            fc.asyncProperty(program, rows, async (source, groupRows) => {
                const prepared = await minab.prepare(source, { ruleContext: { isFieldRule: false, groupTable: 'Sale' } });
                expect(
                    prepared.diagnostics.filter(d => d.severity === 'error'),
                    source
                ).toEqual([]);
                const result = await prepared.run({ groupRows });
                if (!result.ok) expect(result.error.code, `${source} -> ${result.error.message}`).toBe('eval.integerOutOfRange');
            }),
            fuzzParams()
        );
    }, 300_000);
});
