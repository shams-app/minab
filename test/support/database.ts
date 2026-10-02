import type { QueryExecutor, Row, SqlQuery } from '../../src/language/minab-executor.js';

/**
 * A database for tests: PGlite (Postgres in this process) by default,
 * or a real Postgres when `MINAB_TEST_DATABASE_URL` is set. Both give
 * the same small API, so a test never knows which one it talks to.
 *
 * Values come back in one shape on both:
 *  - `bigint` and `integer` are JS numbers,
 *  - `numeric` is a `Decimal` (its exact text is kept),
 *  - dates, times and timestamps are the text Postgres prints (UTC).
 */

/** An exact `numeric` value, kept as text so nothing is rounded. */
export class Decimal {
    constructor(readonly text: string) {}
    toJSON(): string {
        return this.text;
    }
}

export interface TestDatabase {
    readonly kind: 'pglite' | 'postgres';
    exec(sql: string): Promise<void>;
    query(text: string, params?: unknown[]): Promise<Row[]>;
    /** A Minab executor over this database. */
    readonly executor: QueryExecutor;
    /**
     * Runs `fn` in a fresh schema that holds `setupSql`'s tables, then drops it,
     * so cases never see each other's rows. Cases in one file run one after another.
     */
    isolated<T>(setupSql: string, fn: () => Promise<T>): Promise<T>;
    close(): Promise<void>;
}

const OID = { INT8: 20, INT2: 21, INT4: 23, NUMERIC: 1700, DATE: 1082, TIME: 1083, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 };

const asNumber = (value: string) => Number(value);
const asDecimal = (value: string) => new Decimal(value);
const asText = (value: string) => value;

function executorOf(db: Pick<TestDatabase, 'query'>): QueryExecutor {
    return {
        execute: (query: SqlQuery) => db.query(query.text, query.params)
    };
}

let counter = 0;

function isolation(db: Pick<TestDatabase, 'exec'>) {
    return async <T>(setupSql: string, fn: () => Promise<T>): Promise<T> => {
        const schema = `case_${process.pid}_${counter++}`;
        await db.exec(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}", public;`);
        try {
            await db.exec(setupSql);
            return await fn();
        } finally {
            await db.exec(`SET search_path TO public; DROP SCHEMA "${schema}" CASCADE;`);
        }
    };
}

async function openPglite(): Promise<TestDatabase> {
    const [{ PGlite, types }, { citext }] = await Promise.all([import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/citext')]);
    const db = await PGlite.create({
        extensions: { citext },
        parsers: {
            [types.INT8]: asNumber,
            [types.NUMERIC]: asDecimal,
            [types.DATE]: asText,
            [types.TIME]: asText,
            [types.TIMESTAMP]: asText,
            [types.TIMESTAMPTZ]: asText
        }
    });
    await db.exec(`SET TIME ZONE 'UTC'; CREATE EXTENSION IF NOT EXISTS citext;`);
    const self: TestDatabase = {
        kind: 'pglite',
        exec: async sql => void (await db.exec(sql)),
        query: async (text, params = []) => (await db.query<Row>(text, params, { rowMode: 'object' })).rows,
        get executor() {
            return executorOf(self);
        },
        isolated: isolation({ exec: sql => self.exec(sql) }),
        close: () => db.close()
    };
    return self;
}

async function openPostgres(url: string): Promise<TestDatabase> {
    const { Client } = await import('pg');
    const parsers: Record<number, (value: string) => unknown> = {
        [OID.INT8]: asNumber,
        [OID.INT2]: asNumber,
        [OID.INT4]: asNumber,
        [OID.NUMERIC]: asDecimal,
        [OID.DATE]: asText,
        [OID.TIME]: asText,
        [OID.TIMESTAMP]: asText,
        [OID.TIMESTAMPTZ]: asText
    };
    const client = new Client({
        connectionString: url,
        types: { getTypeParser: ((oid: number, format?: string) => parsers[oid] ?? (format === 'binary' ? (v: unknown) => v : (v: string) => v)) as never }
    });
    await client.connect();
    await client.query(`SET TIME ZONE 'UTC'`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    const self: TestDatabase = {
        kind: 'postgres',
        exec: async sql => void (await client.query(sql)),
        query: async (text, params = []) => (await client.query(text, params)).rows as Row[],
        get executor() {
            return executorOf(self);
        },
        isolated: isolation({ exec: sql => self.exec(sql) }),
        close: () => client.end()
    };
    return self;
}

/** One database per test file: call it in `beforeAll`, and `close()` in `afterAll`. */
export async function openTestDatabase(): Promise<TestDatabase> {
    const url = process.env.MINAB_TEST_DATABASE_URL;
    return url ? await openPostgres(url) : await openPglite();
}
