/**
 * The PostgreSQL data port (moved here from `src/cli/executors.ts` in R7).
 *
 * `pg` is loaded at run time, from the host's own installation. It is not a
 * dependency of this package: a host that embeds Minab brings its own driver,
 * and the CLI should not force one on someone who only wants `compile` or `check`.
 */

import { DataSourceError } from '../host/fixture-executor.js';
import type { DataPort, Row, SqlQuery } from '../runtime/index.js';

/** What the port needs from `pg`'s `Client`, and all it uses. The import is untyped, so this is explicit. */
export interface PgClientLike {
    connect(): Promise<void>;
    query(text: string, params: unknown[]): Promise<{ rows: Row[] }>;
    end(): Promise<void>;
}

/** A data port over a connected client. It does not close the client: the host owns it. */
export function pgDataPort(client: Pick<PgClientLike, 'query'>): DataPort {
    return {
        async execute(query: SqlQuery): Promise<Row[]> {
            try {
                const result = await client.query(query.text, query.params);
                return result.rows;
            } catch (e) {
                // The database rejecting generated SQL is a compiler bug, not a user typo,
                // so the statement itself is part of the report. The SQLSTATE stays on the
                // error, so the runtime can still map it to a code.
                const error = new DataSourceError(
                    `the database rejected this statement:\n  ${query.text}\n` + `  parameters: ${JSON.stringify(query.params)}\n` + `${(e as Error).message}`
                );
                const code = (e as { code?: unknown }).code;
                if (typeof code === 'string') Object.assign(error, { code });
                throw error;
            }
        }
    };
}

export interface PostgresConnection extends DataPort {
    /** Every statement sent through this connection. */
    readonly statements: SqlQuery[];
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
        execute(query, context) {
            statements.push(query);
            return port.execute(query, context);
        },
        close: () => client.end()
    };
}
