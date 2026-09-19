/**
 * The CLI's two data sources (roadmap Phase 6).
 *
 * `QueryExecutor` (see `minab-executor.ts`) is the whole contract: take
 * SQL text plus positional parameters, give back rows. Inside the host
 * application that's whatever connection the host already has. From a
 * command line there are two useful answers:
 *
 *  - `FixtureExecutor` — canned rows from the config file, so a rule or a
 *    query can be run, and its *strategy* inspected, with no database
 *    anywhere. It lives in `src/host/` because it needs no Node APIs and
 *    the web playground uses it too.
 *  - `PostgresExecutor` — a real connection, for the case the fixture
 *    can't answer: whether the SQL this compiler emits is actually valid
 *    SQL. `pg` is loaded dynamically and is not a dependency of this
 *    package; a host embedding Minab brings its own driver, and the CLI
 *    should not force one on someone who only wants `compile`/`check`.
 */

import { DataSourceError } from '../host/fixture-executor.js';
import type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';

export { DataSourceError, FixtureExecutor, traced } from '../host/fixture-executor.js';

/** What the CLI needs from `pg`'s `Client`, and all it uses — kept explicit since the import is untyped. */
interface PgClientLike {
    connect(): Promise<void>;
    query(text: string, params: unknown[]): Promise<{ rows: Row[] }>;
    end(): Promise<void>;
}

export class PostgresExecutor implements QueryExecutor {
    readonly statements: SqlQuery[] = [];

    private constructor(private readonly client: PgClientLike) {}

    /**
     * `pg` is resolved at runtime, from the *user's* installation. The
     * specifier is held in a variable deliberately: a literal
     * `import('pg')` makes `tsc` demand the package's types at build time,
     * which would turn an optional driver into a hard build dependency.
     */
    static async connect(connectionString: string): Promise<PostgresExecutor> {
        const driver = 'pg';
        let pg: { Client: new (config: { connectionString: string }) => PgClientLike };
        try {
            pg = await import(driver);
        } catch {
            throw new DataSourceError(
                `--database needs the "pg" package, which isn't installed.\n` +
                `Install it alongside Minab:  npm install pg`
            );
        }
        const client = new pg.Client({ connectionString });
        try {
            await client.connect();
        } catch (e) {
            throw new DataSourceError(`cannot connect to the database: ${(e as Error).message}`);
        }
        return new PostgresExecutor(client);
    }

    async execute(query: SqlQuery): Promise<Row[]> {
        this.statements.push(query);
        try {
            const result = await this.client.query(query.text, query.params);
            return result.rows;
        } catch (e) {
            // The database rejecting generated SQL is a compiler bug, not a
            // user typo, so the statement itself is part of the report.
            throw new DataSourceError(
                `the database rejected this statement:\n  ${query.text}\n` +
                `  parameters: ${JSON.stringify(query.params)}\n` +
                `${(e as Error).message}`
            );
        }
    }

    async close(): Promise<void> {
        await this.client.end();
    }
}
