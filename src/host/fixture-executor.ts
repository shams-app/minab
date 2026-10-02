/**
 * Data sources any host can use without a database driver.
 *
 * `QueryExecutor` (see `minab-executor.ts`) is the whole contract: take
 * SQL text plus positional parameters, give back rows. `FixtureExecutor`
 * answers from canned responses, so a rule or a query can be run — and its
 * *strategy* inspected — with no database anywhere. The CLI uses it for a
 * config's `data.responses`; `test/evaluation.test.ts` uses the same trick.
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

/** Wraps an executor so every statement it runs is reported (`--trace`) as it happens, rather than only after the program finishes. */
export function traced(executor: QueryExecutor, onStatement: (query: SqlQuery) => void): QueryExecutor {
    return {
        async execute(query: SqlQuery): Promise<Row[]> {
            onStatement(query);
            return await executor.execute(query);
        }
    };
}
