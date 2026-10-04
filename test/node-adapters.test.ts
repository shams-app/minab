/**
 * Production plan phase H1 — the Node adapters (`src/node/`).
 * The data port runs against PGlite, or a real Postgres when `MINAB_TEST_DATABASE_URL` is set.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMinab } from '../src/runtime/index.js';
import { pgDataPort, queryFunctionDataPort, systemClock } from '../src/node/index.js';
import { openTestDatabase, type TestDatabase } from './support/database.js';
import { orderSchema } from './support/runtime.js';

const context = { signal: new AbortController().signal };
const record = { recordTable: 'Order', isFieldRule: false };
const RULE = 'EXISTS(#Customer[.id == ^.customer_id])';
const CUSTOMER = '00000000-0000-0000-0000-0000000000c1';

describe('queryFunctionDataPort', () => {
    test('the function gets $1-style SQL and the parameters', async () => {
        const calls: { text: string; params: unknown[] }[] = [];
        const port = queryFunctionDataPort(async (text, params) => {
            calls.push({ text, params });
            return [{ value: true }];
        });
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const program = await minab.prepare(RULE);
        const result = await program.run({ record: { customer_id: CUSTOMER } }, { data: port });
        expect(result).toMatchObject({ ok: true, value: true });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.text).toMatch(/\$1/);
        expect(calls[0]!.text).not.toContain('?');
        expect(calls[0]!.params).toContain(CUSTOMER);
    });

    test('an object with rows works too, like the result of pg', async () => {
        const port = queryFunctionDataPort(async () => ({ rows: [{ n: 1 }] }));
        expect(await port.execute({ text: 'SELECT 1 AS n', params: [] }, context)).toEqual([{ n: 1 }]);
    });

    test('a failure keeps its SQLSTATE and names the statement', async () => {
        const port = queryFunctionDataPort(async () => {
            throw Object.assign(new Error('boom'), { code: '42P01' });
        });
        await expect(port.execute({ text: 'SELECT 1', params: [] }, context)).rejects.toMatchObject({
            code: '42P01',
            message: expect.stringContaining('SELECT 1')
        });
    });
});

describe('systemClock', () => {
    test('is the real time, in UTC by default', () => {
        const clock = systemClock();
        expect(clock.timeZone).toBe('UTC');
        expect(Math.abs(clock.now().getTime() - Date.now())).toBeLessThan(1000);
    });

    test('keeps the time zone it is given', () => {
        expect(systemClock('Asia/Tehran').timeZone).toBe('Asia/Tehran');
    });

    test('an unknown time zone is refused at once', () => {
        expect(() => systemClock('Mars/Olympus')).toThrow(RangeError);
    });
});

describe('over a database', () => {
    let db: TestDatabase;
    beforeAll(async () => {
        db = await openTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await db?.close();
    });

    const SETUP = `CREATE TABLE "Customer" (id uuid PRIMARY KEY, name text NOT NULL);
        CREATE TABLE "Order" (id uuid PRIMARY KEY, customer_id uuid, total numeric, status text);`;

    /** Both PGlite and `pg` give `{ rows }`: this is what `pgDataPort` wraps. */
    const client = () => ({ query: async (text: string, params: unknown[]) => ({ rows: await db.query(text, params) }) });

    async function ask(data: ReturnType<typeof pgDataPort>) {
        const program = await createMinab({ schema: orderSchema(), ruleContext: record }).prepare(RULE);
        expect(program.diagnostics).toEqual([]);
        return program.run({ record: { customer_id: CUSTOMER } }, { data });
    }

    test('pgDataPort runs a correlated rule', async () => {
        await db.isolated(SETUP, async () => {
            expect(await ask(pgDataPort(client()))).toMatchObject({ ok: true, value: false });
            await db.exec(`INSERT INTO "Customer" VALUES ('${CUSTOMER}', 'Ada')`);
            expect(await ask(pgDataPort(client()))).toMatchObject({ ok: true, value: true });
        });
    });

    test('queryFunctionDataPort runs the same rule', async () => {
        await db.isolated(SETUP, async () => {
            await db.exec(`INSERT INTO "Customer" VALUES ('${CUSTOMER}', 'Ada')`);
            const port = queryFunctionDataPort((text, params) => db.query(text, params));
            expect(await ask(port)).toMatchObject({ ok: true, value: true });
        });
    });

    test('a rule in a transaction sees the rows the transaction inserted, and not after a rollback', async () => {
        await db.isolated(SETUP, async () => {
            await db.exec('BEGIN');
            try {
                await db.exec(`INSERT INTO "Customer" VALUES ('${CUSTOMER}', 'Ada')`);
                expect(await ask(pgDataPort(client()))).toMatchObject({ ok: true, value: true });
            } finally {
                await db.exec('ROLLBACK');
            }
            expect(await ask(pgDataPort(client()))).toMatchObject({ ok: true, value: false });
        });
    });

    test('a database error reaches the run as a coded error, with no SQL in it', async () => {
        const schema = orderSchema();
        const missing = { ...schema, tables: [{ ...schema.tables.find(t => t.name === 'Customer')!, name: 'NoSuchTableH1' }] };
        const program = await createMinab({ schema: missing }).prepare('FROM NoSuchTableH1 SELECT .id');
        const result = await db.isolated('SELECT 1', () => program.run({}, { data: pgDataPort(client()) }));
        expect(result).toMatchObject({ ok: false, error: { code: 'data.error', params: { sqlstate: '42P01' } } });
    });
});
