/**
 * Production plan phase R2 — many `prepare` + `run` pairs at once on one
 * `Minab` must not disturb each other (ADR 0002, section 10).
 */

import { describe, expect, test } from 'vitest';
import type { QueryExecutor, Row, SqlQuery } from '../src/language/minab-executor.js';
import { createMinab } from '../src/runtime/index.js';
import { orderSchema } from './support/runtime.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A fake data port: waits a random time, then answers from the first SQL parameter. */
function fakeData(known: Set<string>): QueryExecutor {
    return {
        async execute(query: SqlQuery): Promise<Row[]> {
            await delay(Math.random() * 20);
            return [{ value: known.has(String(query.params[0])) }];
        }
    };
}

describe('50 prepare + run pairs at once on one Minab', () => {
    test('every result is its own', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const fieldRule = {
            isFieldRule: true,
            recordTable: 'Order',
            fieldType: { kind: 'scalar', base: 'UUID', nullable: false, array: false, arrayNullable: false }
        } as const;
        const recordRule = { isFieldRule: false, recordTable: 'Order' };
        const known = new Set(Array.from({ length: 50 }, (_, i) => `c-${i}`).filter(id => Number(id.slice(2)) % 2 === 0));

        const jobs = Array.from({ length: 50 }, (_, i) => async () => {
            if (i % 5 === 0) {
                // A record rule that needs no data: the answer depends on the record only.
                const program = await minab.prepare(`.total > ${i}`, { ruleContext: recordRule });
                const result = await program.run({ record: { total: i + (i % 2 ? 1 : -1) } });
                return { ok: result.ok && result.value === (i % 2 === 1) };
            }
            // A field rule that asks the data port: a different source and a different `$` each time.
            const program = await minab.prepare(`EXISTS(#Customer[.id == $]) AND ${i} == ${i}`, { ruleContext: fieldRule });
            const result = await program.run({ fieldValue: `c-${i}` }, { data: fakeData(known) });
            return { ok: program.ok && result.ok && result.value === known.has(`c-${i}`) };
        });

        const results = await Promise.all(jobs.map(job => job()));
        expect(results.filter(r => !r.ok)).toHaveLength(0);
        expect(minab.cacheStats().openDocuments).toBe(0);
        expect(minab.cacheStats().created).toBe(2);
    });

    test('one program run many times at once gives each run its own record', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: { isFieldRule: false, recordTable: 'Order' } });
        const program = await minab.prepare('.total > 10');
        const answers = await Promise.all(Array.from({ length: 50 }, (_, i) => program.run({ record: { total: i } })));
        expect(answers.map(a => a.ok && a.value)).toEqual(Array.from({ length: 50 }, (_, i) => i > 10));
    });

    test('two schemas at the same time stay apart', async () => {
        const a = createMinab({ schema: orderSchema('a') });
        const b = createMinab({ schema: { ...orderSchema('b'), tables: orderSchema().tables.filter(t => t.name === 'Customer') } });
        const [fromA, fromB] = await Promise.all([a.prepare('FROM Order SELECT .id'), b.prepare('FROM Order SELECT .id')]);
        expect(fromA.ok).toBe(true);
        expect(fromB.ok).toBe(false);
        expect(fromB.diagnostics.length).toBeGreaterThan(0);
    });
});
