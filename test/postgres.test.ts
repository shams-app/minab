import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EXIT_OK, runCli, type CliIo } from '../src/cli/main.js';

/**
 * The generated SQL, executed.
 *
 * Every other suite checks the compiler by diffing its output against
 * hand-written expected SQL, which proves the text is what we meant and
 * nothing about whether a database accepts it. `docs/status.md` has
 * carried that gap since Phase 5, along with a second one: `CITEXT`
 * case-insensitivity is asserted in the interpreter and *assumed* in the
 * compiled path. Both need a real server, so this suite is opt-in:
 *
 *   MINAB_TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/scratch npm test
 *
 * It drops and recreates its three tables, so point it at a throwaway
 * database. Without the variable the whole file skips, and CI stays green
 * on a machine with no Postgres.
 *
 * It drives the Phase 6 CLI rather than the services directly, so what it
 * proves is the same path a user takes: `minab run --database <url>`.
 */

const connectionString = process.env.MINAB_TEST_DATABASE_URL;

const SCHEMA = {
    tables: [
        {
            name: 'Booking',
            primaryKey: 'id',
            columns: { id: 'UUID', room_id: 'UUID', start_date: 'DATE', end_date: 'DATE' }
        },
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                name: 'TEXT',
                email: 'CITEXT',
                country: 'TEXT?',
                orders: { collection: 'Order', foreignKey: 'customer_id' }
            }
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                customer: { ref: 'Customer', foreignKey: 'customer_id' },
                status: 'TEXT',
                total: 'DECIMAL'
            }
        }
    ]
};

const ADA = '11111111-1111-1111-1111-111111111111';
const GRACE = '22222222-2222-2222-2222-222222222222';
const ROOM = 'cccccccc-0000-0000-0000-000000000001';
const BOOKING_ONE = 'b0000000-0000-0000-0000-000000000001';

const SETUP = `
DROP TABLE IF EXISTS "Order";
DROP TABLE IF EXISTS "Customer";
DROP TABLE IF EXISTS "Booking";
CREATE EXTENSION IF NOT EXISTS citext;
CREATE TABLE "Customer" (id uuid PRIMARY KEY, name text NOT NULL, email citext NOT NULL, country text);
CREATE TABLE "Order" (id uuid PRIMARY KEY, customer_id uuid REFERENCES "Customer"(id), status text NOT NULL, total numeric NOT NULL);
CREATE TABLE "Booking" (id uuid PRIMARY KEY, room_id uuid NOT NULL, start_date date NOT NULL, end_date date NOT NULL);
INSERT INTO "Customer" VALUES
  ('${ADA}', 'Ada Lovelace', 'ada@example.com', 'NL'),
  ('${GRACE}', 'Grace Hopper', 'grace@example.com', 'US');
INSERT INTO "Order" VALUES
  ('a0000000-0000-0000-0000-000000000001', '${ADA}', 'paid', 800),
  ('a0000000-0000-0000-0000-000000000002', '${ADA}', 'paid', 900),
  ('a0000000-0000-0000-0000-000000000003', '${GRACE}', 'paid', 300);
INSERT INTO "Booking" VALUES
  ('${BOOKING_ONE}', '${ROOM}', '2026-10-01', '2026-10-05'),
  ('b0000000-0000-0000-0000-000000000002', '${ROOM}', '2026-10-04', '2026-10-08');
`;

let dir: string;

class Capture implements CliIo {
    readonly stdout: string[] = [];
    readonly stderr: string[] = [];
    constructor(readonly cwd: string) {}
    out(text: string): void {
        this.stdout.push(text);
    }
    err(text: string): void {
        this.stderr.push(text);
    }
    get output(): string {
        return this.stdout.join('\n');
    }
    get errors(): string {
        return this.stderr.join('\n');
    }
}

/** The CLI's table output, as cells — so an assertion says what the rows are, not how wide a column happened to be. */
function rows(capture: Capture): string[][] {
    const lines = capture.output.split('\n');
    return lines.slice(2).map(line => line.split(/\s{2,}/));
}

/** Runs one program against the real database and returns what the CLI printed. */
async function run(program: string, configOverrides: Record<string, unknown> = {}): Promise<Capture> {
    const name = `p${Math.random().toString(36).slice(2)}`;
    writeFileSync(join(dir, `${name}.minab`), program);
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ schema: SCHEMA, ...configOverrides }));
    const capture = new Capture(dir);
    const code = await runCli(['run', `${name}.minab`, '--config', `${name}.json`, '--database', connectionString!], capture);
    expect(capture.errors).toBe('');
    expect(code).toBe(EXIT_OK);
    return capture;
}

describe.skipIf(!connectionString)('the compiled SQL, against a real PostgreSQL server', () => {
    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), 'minab-pg-'));
        const { Client } = await import('pg');
        const client = new Client({ connectionString });
        await client.connect();
        try {
            await client.query(SETUP);
        } finally {
            await client.end();
        }
    }, 30000);

    afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

    test('a GROUPBY/HAVING pipeline query (spec §4.3) returns the right rows', async () => {
        const result = await run(`
            FROM Order
            GROUPBY .customer
            HAVING SUM(.total) > 1000
            SELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count
            ORDERBY total_spent DESC
        `);
        // Ada has 1700 across two orders; Grace's 300 is filtered by HAVING.
        expect(rows(result)).toEqual([['Ada Lovelace', '1700', '2']]);
    });

    test('the correlated booking-overlap rule (spec §6.1) sees the overlap', async () => {
        const rule = `
            .end_date > .start_date AND NOT EXISTS(
                #Booking[. != ^ AND .room_id == ^.room_id
                         AND .start_date < ^.end_date AND .end_date > ^.start_date]
            )
        `;
        const overlapping = await run(rule, {
            rule: { recordTable: 'Booking' },
            record: { id: BOOKING_ONE, room_id: ROOM, start_date: '2026-10-01', end_date: '2026-10-05' }
        });
        expect(overlapping.output).toBe('false');

        // The same booking moved clear of the other one passes, which is
        // what proves the EXISTS is actually discriminating rather than
        // always true: same statement, different bound parameters.
        const clear = await run(rule, {
            rule: { recordTable: 'Booking' },
            record: { id: BOOKING_ONE, room_id: ROOM, start_date: '2026-11-01', end_date: '2026-11-05' }
        });
        expect(clear.output).toBe('true');
    });

    test('`ref` traversal compiles to a subquery the server accepts (spec §3.1)', async () => {
        const result = await run(`
            FROM Order
            WHERE .customer.country == "NL"
            SELECT .customer.name AS who, .total AS total
            ORDERBY total ASC
        `);
        expect(rows(result)).toEqual([
            ['Ada Lovelace', '800'],
            ['Ada Lovelace', '900']
        ]);
    });

    test('a null `ref` yields null rather than dropping the row (spec §7.7 rule 1)', async () => {
        // ADR 0001 chose a correlated subquery over a join for exactly
        // this: an inner join would lose the orphan row entirely.
        const result = await run(`
            FROM Customer
            WHERE .country == null
            SELECT .name AS who
        `);
        expect(result.output).toBe('(no rows)');
    });

    test('CITEXT equality is case-insensitive in the compiled path, not just the interpreter', async () => {
        const result = await run(`FROM Customer WHERE .email == CAST("ADA@Example.COM" AS CITEXT) SELECT .name AS who`);
        expect(rows(result)).toEqual([['Ada Lovelace']]);
    });

    test('null-safe equality compiles to IS NOT DISTINCT FROM and finds the null row (spec §7.7)', async () => {
        // `== null` under SQL's own `=` would match nothing; this is the
        // whole reason the compiler never emits a bare `=` for a user's
        // `==`.
        const result = await run(`FROM Customer WHERE .country != null SELECT .name AS who ORDERBY who ASC`);
        expect(rows(result)).toEqual([['Ada Lovelace'], ['Grace Hopper']]);
    });
});
