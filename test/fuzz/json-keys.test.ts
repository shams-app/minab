/**
 * Shamsine card M.1b: keys of a `JSON` value never throw.
 *
 * A random path (keys, text keys, positions) is read from a random JSON value, then left as it is, cast, counted or
 * kind-tested. Every program checks, and every run ends with a value, or with `eval.castFailed` for a cast whose kind does
 * not fit. Nothing else: a key never fails (spec §7.3.1).
 */

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createMinab } from '../../src/runtime/index.js';
import { orderSchema } from '../support/runtime.js';
import { FUZZ_RUNS, FUZZ_SEED, fuzzParams } from './support.js';

// `constructor` and `__proto__` are keys an object only inherits: they must read as missing.
const name = fc.constantFrom('a', 'b', 'x', 'constructor', '__proto__', 'toString');
const step = fc.oneof(
    name.map(n => `.${n}`),
    name.map(n => `["${n}"]`),
    fc.integer({ min: 0, max: 3 }).map(n => `[${n}]`)
);
const path = fc.array(step, { minLength: 0, maxLength: 4 }).map(steps => `doc${steps.join('')}`);

const program = fc.oneof(
    path,
    path.map(p => `${p} is null`),
    path.map(p => `${p} isnot object`),
    path.map(p => `COUNT(${p})`),
    fc.tuple(path, fc.constantFrom('TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'JSON')).map(([p, type]) => `CAST(${p} AS ${type})`)
);

const value = fc.jsonValue({ maxDepth: 3 });

describe(`keys of a JSON value (seed ${FUZZ_SEED}, ${FUZZ_RUNS} cases)`, () => {
    test('every program checks, and every run is a value or eval.castFailed', async () => {
        const minab = createMinab({ schema: orderSchema(), inputs: { doc: 'JSON' } });
        await fc.assert(
            fc.asyncProperty(program, value, async (source, doc) => {
                const prepared = await minab.prepare(source);
                expect(
                    prepared.diagnostics.filter(d => d.severity === 'error'),
                    source
                ).toEqual([]);
                const result = await prepared.run({ hostInputs: { doc } });
                if (!result.ok) expect(result.error.code, `${source} on ${JSON.stringify(doc)} -> ${result.error.message}`).toBe('eval.castFailed');
            }),
            fuzzParams()
        );
    }, 300_000);
});
