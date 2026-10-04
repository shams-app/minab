import { beforeAll, describe, expect, test } from 'vitest';
import { castValue } from '../src/language/casts.js';
import { Big } from '../src/language/values.js';
import { loadSchema } from './support/minab.js';

/**
 * Production plan C3 (decision D16): `CAST` in the interpreter. The two runtimes are
 * compared in `test/differential/cases/c3-cast.cases.ts`; the cases here are the ones
 * Postgres cannot answer the same way (literals, error codes, host values, JSON).
 */

const loaded = loadSchema({
    tables: [{ name: 'One', primaryKey: 'id', columns: { id: 'INTEGER' } }]
});
const noDatabase = { execute: async () => [] };

async function run(expr: string) {
    const program = await loaded.parse(expr);
    expect(program.errors).toEqual([]);
    return await loaded.run(program.model, noDatabase);
}

describe('CAST in the interpreter', () => {
    beforeAll(async () => {
        await loaded.parse('1'); // the first parse builds the language services
    }, 60_000);

    test.each([
        ['CAST(3.5 AS INTEGER)', 4],
        ['CAST(-3.5 AS INTEGER)', -4],
        ['CAST(3.7 AS INTEGER)', 4],
        ['CAST(" 12 " AS INTEGER) + 1', 13],
        ['CAST(5 AS TEXT) == "5"', true],
        ['CAST(2.50 AS TEXT)', '2.5'],
        ['CAST("Yes" AS BOOLEAN)', true],
        ['CAST(null AS DATE)', null],
        ['CAST("2026-10-02T08:30:00Z" AS DATETIME)', '2026-10-02T08:30:00.000Z'],
        ['CAST(CAST("2026-10-02 08:30:00" AS DATETIME) AS DATE)', '2026-10-02'],
        ['CAST(CAST("2026-10-02 08:30:00" AS DATETIME) AS TIME)', '08:30:00'],
        ['CAST(CAST("2026-10-02" AS DATE) AS DATETIME)', '2026-10-02T00:00:00.000Z'],
        ['CAST("123E4567-E89B-12D3-A456-426614174000" AS UUID)', '123e4567-e89b-12d3-a456-426614174000'],
        ['CAST("[1, 2]" AS JSON)', [1, 2]]
    ])('%s', async (expr, expected) => {
        expect(await run(expr)).toEqual({ ok: true, value: expected });
    });

    test.each([
        ['CAST("12a" AS INTEGER)', '"12a"', 'TEXT', 'INTEGER'],
        ['CAST("maybe" AS BOOLEAN)', '"maybe"', 'TEXT', 'BOOLEAN'],
        ['CAST("not-a-uuid" AS UUID)', '"not-a-uuid"', 'TEXT', 'UUID'],
        ['CAST("2026-02-30" AS DATE)', '"2026-02-30"', 'TEXT', 'DATE'],
        ['CAST(99999999999999999999.5 AS INTEGER)', '99999999999999999999.5', 'DECIMAL', 'INTEGER'],
        ['CAST("99999999999999999999" AS INTEGER)', '"99999999999999999999"', 'TEXT', 'INTEGER'],
        ['CAST(true AS DECIMAL)', 'true', 'BOOLEAN', 'DECIMAL']
    ])('%s fails with eval.castFailed', async (expr, value, from, to) => {
        expect(await run(expr)).toMatchObject({
            ok: false,
            code: 'eval.castFailed',
            reason: `cannot cast ${value} to ${to}`,
            params: { value, from, to }
        });
    });

    test('a JSON object cannot become an INTEGER', async () => {
        expect(await run('CAST(CAST("{}" AS JSON) AS INTEGER)')).toMatchObject({
            ok: false,
            code: 'eval.castFailed'
        });
    });

    test('a JSON number can become an INTEGER, a JSON string cannot', () => {
        expect(castValue(2.5, { base: 'INTEGER' }, 'JSON')).toBe(3);
        expect(() => castValue('12', { base: 'INTEGER' }, 'JSON')).toThrow(/cannot cast/);
    });

    test('an array converts item by item', () => {
        expect(castValue(['1', ' 2 ', null], { base: 'INTEGER', array: true }, 'TEXT', true)).toEqual([1, 2, null]);
        expect(() => castValue(['1'], { base: 'INTEGER' }, 'TEXT', true)).toThrow(/cannot cast/);
    });

    test('a host Date is read as UTC', () => {
        const date = new Date('2026-10-02T08:30:00.000Z');
        expect(castValue(date, { base: 'DATE' }, 'DATETIME')).toBe('2026-10-02');
        expect(castValue(date, { base: 'TEXT' }, 'DATETIME')).toBe('2026-10-02 08:30:00');
    });

    test('a decimal stays exact', () => {
        expect(castValue('0.1', { base: 'DECIMAL' }, 'TEXT')).toEqual(new Big('0.1'));
        expect(castValue(new Big('1e-7'), { base: 'TEXT' })).toBe('0.0000001');
    });
});
