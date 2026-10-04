/**
 * The PostgreSQL data port (moved here from `src/cli/executors.ts` in R7).
 *
 * `pg` is loaded at run time, from the host's own installation. It is not a
 * dependency of this package: a host that embeds Minab brings its own driver,
 * and the CLI should not force one on someone who only wants `compile` or `check`.
 */

import { DataSourceError } from '../host/fixture-executor.js';
import type { DataPort, Row, SqlQuery, WritePort } from '../runtime/index.js';
import { wrapQuery, writeTransaction, type WriteQueryResult } from './query-function.js';

/** What the port needs from `pg`'s `Client`, and all it uses. The import is untyped, so this is explicit. */
export interface PgClientLike {
    /** Opens the connection. */
    connect(): Promise<void>;
    /** Runs one statement with `$1`-style parameters. */
    query(text: string, params: unknown[]): Promise<{ rows: Row[] }>;
    /** Closes the connection. */
    end(): Promise<void>;
}

/** A data port over a connected client or pool. It does not close it: the host owns it. */
export function pgDataPort(client: Pick<PgClientLike, 'query'>): DataPort {
    return wrapQuery((text, params) => client.query(text, params));
}

/** What the write port needs from a `pg` pool: it lends one connection for the whole transaction. */
export interface PgPoolLike {
    connect(): Promise<Pick<PgClientLike, 'query'> & { release(error?: unknown): void }>;
}

type PgQueryable = Pick<PgClientLike, 'query'>;

function isPool(source: PgQueryable | PgPoolLike): source is PgPoolLike {
    // A `Client` has `connect` too, so ask for the counter that only a pool has.
    return typeof (source as { totalCount?: unknown }).totalCount === 'number';
}

/**
 * A write port over a `pg` client or pool (X5, D26). One run is one transaction:
 * `BEGIN` before the first statement, `COMMIT` when the run succeeds, `ROLLBACK` when it fails.
 *
 * - A **pool**: the port takes one connection for the transaction and gives it back at the end.
 * - A **client**: the port uses it as it is. Do not share a client between two runs that overlap.
 *
 * The reads of the run use the same connection, so they see the rows the run wrote.
 * A host that already started a transaction should use `queryFunctionWritePort` instead.
 */
export function pgWritePort(clientOrPool: PgQueryable | PgPoolLike): WritePort {
    return {
        async transaction(work) {
            const pooled = isPool(clientOrPool) ? await clientOrPool.connect() : undefined;
            const client: PgQueryable = pooled ?? (clientOrPool as PgQueryable);
            const query = (text: string, params: unknown[]) => client.query(text, params) as Promise<WriteQueryResult>;
            // A connection that failed to roll back is broken: the pool must drop it, not lend it again.
            let broken: unknown;
            try {
                await client.query('BEGIN', []);
                const value = await work(writeTransaction(query));
                await client.query('COMMIT', []);
                return value;
            } catch (e) {
                try {
                    await client.query('ROLLBACK', []);
                } catch (rollbackError) {
                    broken = rollbackError;
                }
                throw e;
            } finally {
                pooled?.release(broken);
            }
        }
    };
}

/** A data port over a connection that `connectPostgres` opened. The host closes it with `close`. */
export interface PostgresConnection extends DataPort {
    /** Every statement sent through this connection. */
    readonly statements: SqlQuery[];
    /** A write port over the same connection (X5): `BEGIN` ... `COMMIT` for one run. */
    readonly write: WritePort;
    /** Closes the connection. */
    close(): Promise<void>;
}

/**
 * Connects with `pg`. The specifier is held in a variable on purpose: a literal
 * `import('pg')` makes `tsc` demand the package's types at build time, which would
 * turn an optional driver into a hard build dependency.
 */
export async function connectPostgres(connectionString: string): Promise<PostgresConnection> {
    const driver = 'pg';
    let pg: {
        Client: new (config: { connectionString: string }) => PgClientLike;
    };
    try {
        pg = await import(driver);
    } catch {
        throw new DataSourceError(`--database needs the "pg" package, which isn't installed.\n` + `Install it alongside Minab:  npm install pg`);
    }
    const client = new pg.Client({ connectionString });
    try {
        await client.connect();
    } catch (e) {
        throw new DataSourceError(`cannot connect to the database: ${(e as Error).message}`);
    }
    const port = pgDataPort(client);
    const statements: SqlQuery[] = [];
    return {
        statements,
        write: pgWritePort(client),
        execute(query, context) {
            statements.push(query);
            return port.execute(query, context);
        },
        close: () => client.end()
    };
}
