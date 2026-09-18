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
 *    anywhere. This is the same trick `test/evaluation.test.ts` uses.
 *  - `PostgresExecutor` — a real connection, for the case the fixture
 *    can't answer: whether the SQL this compiler emits is actually valid
 *    SQL. `pg` is loaded dynamically and is not a dependency of this
 *    package; a host embedding Minab brings its own driver, and the CLI
 *    should not force one on someone who only wants `compile`/`check`.
 */

import { matchResponse, type FixtureResponse } from './config.js';
import type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';

/** Thrown for a data-source problem (no fixture answer, a driver that isn't installed, a database that rejects the SQL). Reported as a message, never a stack trace. */
export class DataSourceError extends Error {}

/**
 * Answers from the config's `data.responses`, in order: the first response
 * whose `match` appears in the generated SQL wins, and a response with no
 * `match` answers anything.
 *
 * Running out of answers is an error rather than an empty result. A silent
 * `[]` would look exactly like "the database says no rows", which is the
 * wrong answer to the question the fixture was asked; the message prints
 * the SQL that went unanswered so the missing response can be written.
 */
export class FixtureExecutor implements QueryExecutor {
    readonly statements: SqlQuery[] = [];

    constructor(private readonly responses: FixtureResponse[]) {}

    async execute(query: SqlQuery): Promise<Row[]> {
        this.statements.push(query);
        const response = matchResponse(this.responses, query);
        if (!response) {
            throw new DataSourceError(
                this.responses.length === 0
                    ? `this program needs data, and no data source was configured.\n` +
                      `Add a "data" section to the config, or pass --database <url>.\n` +
                      `Unanswered statement:\n  ${query.text}`
                    : `no configured response matches this statement:\n  ${query.text}\n` +
                      `Add a response with a "match" substring of it, or one with no "match" at all.`
            );
        }
        return response.rows;
    }
}

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

/** Wraps an executor so every statement it runs is reported (`--trace`) as it happens, rather than only after the program finishes. */
export function traced(executor: QueryExecutor, onStatement: (query: SqlQuery) => void): QueryExecutor {
    return {
        async execute(query: SqlQuery): Promise<Row[]> {
            onStatement(query);
            return await executor.execute(query);
        }
    };
}
