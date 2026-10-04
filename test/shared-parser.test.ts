/**
 * Production plan phase Q4 — one production parser for all service sets.
 *
 * The parser is about 2 MB and has nothing of the schema in it, so production sets share it
 * (`src/language/minab-module.ts`). The results must not change.
 */

import { EmptyFileSystem } from 'langium';
import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/host/config.js';
import { createMinabServices } from '../src/language/minab-module.js';
import type { MinabSchema } from '../src/language/schema.js';
import { createMinab } from '../src/runtime/index.js';
import { orderSchema } from './support/runtime.js';

const record = { recordTable: 'Order', isFieldRule: false };

/** A schema whose `Order` has a `weight` column and no `total` column. */
function weightSchema(): MinabSchema {
    const { schema } = parseConfig({
        schema: { tables: [{ name: 'Order', primaryKey: 'id', columns: { id: 'UUID', weight: 'INTEGER' } }] }
    });
    return { ...schema, version: 'weights' };
}

describe('the shared production parser', () => {
    test('production sets for different schemas use one parser, development sets do not', () => {
        const a = createMinabServices(EmptyFileSystem, orderSchema('a'), record, { mode: 'production' });
        const b = createMinabServices(EmptyFileSystem, weightSchema(), record, { mode: 'production' });
        expect(b.Minab.parser.LangiumParser).toBe(a.Minab.parser.LangiumParser);
        const d1 = createMinabServices(EmptyFileSystem, orderSchema('d1'), record, { mode: 'development' });
        const d2 = createMinabServices(EmptyFileSystem, orderSchema('d2'), record, { mode: 'development' });
        expect(d2.Minab.parser.LangiumParser).not.toBe(d1.Minab.parser.LangiumParser);
        expect(d1.Minab.parser.LangiumParser).not.toBe(a.Minab.parser.LangiumParser);
    });

    test('each schema still gets its own answers, also when prepares overlap', async () => {
        const orders = createMinab({ schema: orderSchema(), ruleContext: record });
        const weights = createMinab({ schema: weightSchema(), ruleContext: record });
        const sources = ['.total > 10', '.weight > 10', 'FROM Order SELECT .id', '1 +'];
        const prepared = await Promise.all(sources.flatMap(source => [orders.prepare(source), weights.prepare(source)]));
        const ok = prepared.map(program => program.ok);
        // order: [orders, weights] for each source
        expect(ok).toEqual([true, false, false, true, true, true, false, false]);
        expect(prepared[1]!.diagnostics[0]!.range).toMatchObject({ start: { line: 0 } });
        expect(orders.cacheStats().created).toBe(1);
        expect(weights.cacheStats().created).toBe(1);
        await expect(prepared[0]!.run({ record: { id: 'o', customer_id: 'c', total: 11, status: 'open' } })).resolves.toMatchObject({
            ok: true,
            value: true
        });
        await expect(prepared[3]!.run({ record: { id: 'o', weight: 5 } })).resolves.toMatchObject({ ok: true, value: false });
    });

    test('a syntax error in one parse does not leak into the next parse', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const bad = await minab.prepare('.total >');
        expect(bad.ok).toBe(false);
        const good = await minab.prepare('.total > 1');
        expect(good.diagnostics).toEqual([]);
        expect(good.ok).toBe(true);
    });

    test('a parse that throws does not leave half-built nodes for the next parse, in any set', async () => {
        const deep = createMinab({ schema: orderSchema('deep'), limits: { nestingDepth: 1_000_000 } });
        // The parser runs out of stack on this one and throws.
        await deep.prepare(`${'['.repeat(150)}1${']'.repeat(150)}`);
        const other = createMinab({ schema: weightSchema(), ruleContext: record });
        const program = await other.prepare('.weight > 1');
        expect(program.diagnostics).toEqual([]);
        expect(program.ok).toBe(true);
    });
});
