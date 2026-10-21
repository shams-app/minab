import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Row } from '../src/language/minab-executor.js';
import { openTestDatabase, type TestDatabase } from './support/database.js';
import { loadSchema, sameValue, type SchemaSpec } from './support/minab.js';

/**
 * Shamsine card M.1. A read that goes through a link (`.customer.vip`, `.customer.orders`, `^.customer`) follows
 * the key the record in hand carries, not the key of the stored row. A new record has no stored row, and an
 * edited one still has the old key. When the record does not carry the key, the stored row is read, as before.
 */

const schema: SchemaSpec = {
    tables: [
        { name: 'Region', primaryKey: 'id', columns: { id: 'INTEGER', name: 'TEXT' } },
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: {
                id: 'INTEGER',
                name: 'TEXT',
                vip: 'BOOLEAN',
                region_id: 'INTEGER?',
                region: { ref: 'Region', foreignKey: 'region_id' },
                orders: { collection: 'Order', foreignKey: 'customer_id' }
            }
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: {
                id: 'INTEGER',
                total: 'INTEGER',
                customer_id: 'INTEGER?',
                customer: { ref: 'Customer', foreignKey: 'customer_id' }
            }
        }
    ]
};

// Customer 3 is a vip in the north with three orders; customer 4 is not, lives in the south and has two.
const rows: Record<string, Row[]> = {
    Region: [
        { id: 1, name: 'North' },
        { id: 2, name: 'South' }
    ],
    Customer: [
        { id: 3, name: 'Ada', vip: true, region_id: 1 },
        { id: 4, name: 'Bob', vip: false, region_id: 2 }
    ],
    Order: [
        { id: 1, total: 10, customer_id: 4 },
        { id: 2, total: 20, customer_id: 3 },
        { id: 3, total: 30, customer_id: 3 },
        { id: 4, total: 40, customer_id: 4 },
        { id: 5, total: 50, customer_id: 3 }
    ]
};

const loaded = loadSchema(schema, 'Order');
let db: TestDatabase;

beforeAll(async () => {
    db = await openTestDatabase();
}, 60000);

afterAll(async () => {
    await db?.close();
});

/** Runs `expr` with `record` as `.` (a row of `Order`), and answers the value and the statements it sent. */
async function interpret(expr: string, record: Row): Promise<{ value: unknown; statements: { text: string; params: unknown[] }[] }> {
    return await db.isolated(loaded.script(rows), async () => {
        const { model, errors } = await loaded.parse(expr);
        expect(errors).toEqual([]);
        const statements: { text: string; params: unknown[] }[] = [];
        const spy = {
            execute: async (q: { text: string; params: unknown[] }) => {
                statements.push(q);
                return await db.executor.execute(q);
            }
        };
        const result = await loaded.run(model, spy, { table: 'Order', row: record });
        if (!result.ok) throw new Error(result.reason);
        return { value: result.value, statements };
    });
}

/** Runs `expr` on the stored row of `Order` `id`, as SQL in Postgres (`FROM Order WHERE .id == id SELECT expr`). */
async function inSql(expr: string, id: number): Promise<unknown> {
    return await db.isolated(loaded.script(rows), async () => {
        const { model, errors } = await loaded.parse(`FROM Order WHERE .id == ${id} SELECT ${expr} AS v`);
        expect(errors).toEqual([]);
        const result = await loaded.run(model, db.executor);
        if (!result.ok) throw new Error(result.reason);
        return (result.value as Row[])[0]?.v ?? null;
    });
}

describe('a link read follows the key the record carries', () => {
    test('a new record: a key and no id', async () => {
        const { value, statements } = await interpret('.customer.vip', { customer_id: 3 });
        expect(value).toBe(true);
        // Only the key of the link is a parameter: the primary key is not bound when the SQL does not use it.
        expect(statements).toHaveLength(1);
        expect(statements[0].params).toEqual([3]);
    });

    test('an edited record: the key differs from the stored row', async () => {
        // Order 1 is stored with customer 4, who is not a vip.
        expect((await interpret('.customer.vip', { id: 1, customer_id: 4 })).value).toBe(false);
        expect((await interpret('.customer.vip', { id: 1, customer_id: 3 })).value).toBe(true);
    });

    test('a key that is null: the link was cleared', async () => {
        expect((await interpret('.customer.vip', { id: 1, customer_id: null })).value).toBeNull();
    });

    test('no key in the record: the stored row is read, as before', async () => {
        expect((await interpret('.customer.vip', { id: 1 })).value).toBe(false);
        expect((await interpret('.customer.vip', { id: 2 })).value).toBe(true);
    });

    test('no key and no id: nothing to read', async () => {
        expect((await interpret('.customer.vip', {})).value).toBeNull();
    });

    test('two links in a row', async () => {
        expect((await interpret('.customer.region.name', { customer_id: 3 })).value).toBe('North');
        expect((await interpret('.customer.region.name', { id: 1, customer_id: 3 })).value).toBe('North');
        expect((await interpret('.customer.region.name', { id: 1 })).value).toBe('South');
    });

    test('the many side of a link: COUNT(.customer.orders)', async () => {
        expect((await interpret('COUNT(.customer.orders)', { customer_id: 3 })).value).toBe(3);
        expect((await interpret('COUNT(.customer.orders)', { id: 1, customer_id: 3 })).value).toBe(3);
        expect((await interpret('COUNT(.customer.orders)', { id: 1 })).value).toBe(2);
    });

    test('^.customer inside a query', async () => {
        const expr = 'COUNT(#Order[.customer.region.name == ^.customer.region.name])';
        // The orders of customers in the region of the key the record carries.
        expect((await interpret(expr, { id: 1, customer_id: 3 })).value).toBe(3);
        expect((await interpret(expr, { id: 1, customer_id: 4 })).value).toBe(2);
        expect((await interpret(expr, { id: 1 })).value).toBe(2);
    });

    test('^.customer compared with the link of another row', async () => {
        const expr = 'COUNT(#Order[.customer == ^.customer])';
        expect((await interpret(expr, { id: 1, customer_id: 3 })).value).toBe(3);
        expect((await interpret(expr, { id: 1 })).value).toBe(2);
    });
});

describe('both runtimes agree when the record is the stored row', () => {
    const exprs = ['.customer.vip', '.customer.region.name', 'COUNT(.customer.orders)', '.customer.region.name == "North"'];
    for (const expr of exprs) {
        for (const id of [1, 2]) {
            test(`${expr} on order ${id}`, async () => {
                const stored = rows.Order.find(r => r.id === id)!;
                const interpreted = (await interpret(expr, stored)).value;
                expect(sameValue(interpreted, await inSql(expr, id))).toBe(true);
            });
        }
    }
});
