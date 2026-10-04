/**
 * Phase Q3: `run` stays inside its limits.
 *
 * Random well-typed expressions (arithmetic, comparisons, `IN`, `LIKE`, aggregates over one relation) run on
 * PGlite with tight limits. Every run ends with a value or a coded error (`limit.*`, `eval.*`, `data.*`,
 * `cancelled`), never with an uncaught exception, and never later than the wall time plus 50 ms.
 */

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { databaseScript } from '../../src/host/ddl.js';
import { createMinab, type DataPort, type Limits } from '../../src/runtime/index.js';
import { openTestDatabase, type TestDatabase } from '../support/database.js';
import { orderSchema } from '../support/runtime.js';
import { FUZZ_RUNS, FUZZ_SEED, fuzzParams } from './support.js';

const LIMITS: Partial<Limits> = { wallTimeMs: 150, statements: 6, rowsPerStatement: 20, loopIterations: 50, callDepth: 8 };
const GRACE_MS = 50;

// ---- the generator ----------------------------------------------------------

const small = fc.integer({ min: -3, max: 12 });
const money = fc.tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 99 })).map(([a, b]) => `${a}.${String(b).padStart(2, '0')}`);
const word = fc.constantFrom('a', 'ab', 'abc', 'x_y', 'ß', 'ی', '%', '');
const pattern = fc.constantFrom('a%', '%b%', '_b_', '%', '', 'a\\%', '%a%a%a%b', '__', 'ß%');

/** A number (integer or decimal) expression. `depth` bounds the tree. */
const number: fc.Memo<string> = fc.memo(depth => {
    if (depth <= 1) return fc.oneof(small.map(String), money);
    const sub = number(depth - 1);
    return fc.oneof(
        { weight: 2, arbitrary: small.map(String) },
        { weight: 1, arbitrary: money },
        { weight: 3, arbitrary: fc.tuple(sub, fc.constantFrom('+', '-', '*', '/', '%', '\\'), sub).map(([a, op, b]) => `(${a} ${op} ${b})`) },
        { weight: 1, arbitrary: sub.map(a => `ABS(${a})`) },
        { weight: 1, arbitrary: sub.map(a => `(-${a})`) },
        { weight: 2, arbitrary: aggregate }
    );
});

/** An aggregate over one relation: `Order`. Each one is a statement for the data port. */
const aggregate: fc.Arbitrary<string> = fc.oneof(
    fc.constant('COUNT(#Order)'),
    money.map(m => `COUNT(#Order[.total > ${m}])`),
    pattern.map(p => `COUNT(#Order[.status LIKE ${JSON.stringify(p)}])`),
    fc.tuple(fc.constantFrom('SUM', 'AVG', 'MIN', 'MAX'), money).map(([fn, m]) => `${fn}(#Order[.total <= ${m}].total)`)
);

const boolean: fc.Memo<string> = fc.memo(depth => {
    const num = number(Math.min(depth, 3));
    const base = fc.oneof(
        fc.tuple(num, fc.constantFrom('==', '!=', '<', '<=', '>', '>='), num).map(([a, op, b]) => `${a} ${op} ${b}`),
        fc.tuple(small, fc.array(small, { minLength: 1, maxLength: 4 })).map(([a, list]) => `${a} IN [${list.join(', ')}]`),
        fc.tuple(word, pattern).map(([w, p]) => `${JSON.stringify(w)} LIKE ${JSON.stringify(p)}`),
        fc.tuple(word, word).map(([a, b]) => `${JSON.stringify(a)} == ${JSON.stringify(b)}`),
        fc.constantFrom('TRUE', 'FALSE')
    );
    if (depth <= 1) return base;
    const sub = boolean(depth - 1);
    return fc.oneof(
        { weight: 3, arbitrary: base },
        { weight: 1, arbitrary: fc.tuple(sub, fc.constantFrom('AND', 'OR'), sub).map(([a, op, b]) => `(${a}) ${op} (${b})`) },
        { weight: 1, arbitrary: sub.map(a => `NOT (${a})`) }
    );
});

const program = fc.oneof(number(5), boolean(4));

// ---- the property -----------------------------------------------------------

const rows = {
    Order: [
        { id: '00000000-0000-0000-0000-000000000001', customer_id: '00000000-0000-0000-0000-0000000000c1', total: '5.50', status: 'abc' },
        { id: '00000000-0000-0000-0000-000000000002', customer_id: '00000000-0000-0000-0000-0000000000c1', total: '120.00', status: 'ab' },
        { id: '00000000-0000-0000-0000-000000000003', customer_id: '00000000-0000-0000-0000-0000000000c1', total: '0.99', status: 'ß' }
    ],
    Customer: [{ id: '00000000-0000-0000-0000-0000000000c1', name: 'Ada' }]
};

let database: TestDatabase;
let schemaName: string;
beforeAll(async () => {
    database = await openTestDatabase();
    schemaName = `fuzz_${process.pid}`;
    await database.exec(`CREATE SCHEMA "${schemaName}"; SET search_path TO "${schemaName}", public;`);
    await database.exec(databaseScript(orderSchema(), rows));
}, 60_000);
afterAll(async () => {
    await database?.exec(`SET search_path TO public; DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
    await database?.close();
});

const CODED = /^(limit|eval|data)\.|^cancelled$/;

describe(`run stays inside its limits (seed ${FUZZ_SEED}, ${FUZZ_RUNS} cases)`, () => {
    test('a random expression ends with a value or a coded error, in time', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: LIMITS });
        const port: DataPort = { execute: query => database.executor.execute(query) };
        let ran = 0;
        await fc.assert(
            fc.asyncProperty(program, async source => {
                const prepared = await minab.prepare(source);
                const started = performance.now();
                const result = await prepared.run({}, { data: port });
                const took = performance.now() - started;
                if (prepared.ok) ran++;
                if (!result.ok) expect(result.error.code, `${source} -> ${result.error.message}`).toMatch(CODED);
                if (took > LIMITS.wallTimeMs! + GRACE_MS)
                    throw new Error(`run took ${took.toFixed(0)} ms (limit ${LIMITS.wallTimeMs} ms + ${GRACE_MS}) for: ${source}`);
            }),
            fuzzParams()
        );
        // The generator must make real programs, or the test proves nothing.
        expect(ran).toBeGreaterThan(FUZZ_RUNS * 0.8);
    }, 900_000);

    test('limits so tight that every statement trips them end in coded errors', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { statements: 1, rowsPerStatement: 1, wallTimeMs: 100 } });
        const port: DataPort = { execute: query => database.executor.execute(query) };
        await fc.assert(
            fc.asyncProperty(aggregate, aggregate, async (a, b) => {
                const result = await (await minab.prepare(`${a} + ${b}`)).run({}, { data: port });
                expect(result.ok ? 'ok' : result.error.code).toMatch(/^ok$|^(limit|eval|data)\./);
            }),
            fuzzParams({ numRuns: Math.min(FUZZ_RUNS, 300) })
        );
    }, 300_000);
});
