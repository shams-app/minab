/**
 * A data port over any function `(text, params) => rows`.
 *
 * TypeORM (`dataSource.query`, or a `QueryRunner`'s `query`) and Prisma (`$queryRawUnsafe`)
 * both fit, and this package depends on neither. Minab's SQL uses Postgres `$1` placeholders.
 */

import { DataSourceError } from '../host/fixture-executor.js';
import type { DataPort, Row, SqlQuery } from '../runtime/index.js';

/** What the function may return: the rows, or an object that has them (like `pg`). */
export type QueryFunctionResult = Row[] | { rows: Row[] };

export type QueryFunction = (text: string, params: unknown[]) => Promise<QueryFunctionResult>;

/** Calls `run` for each statement and keeps the SQLSTATE `code` of a failure. */
export function wrapQuery(run: QueryFunction): DataPort {
    return {
        async execute(query: SqlQuery): Promise<Row[]> {
            try {
                const result = await run(query.text, query.params);
                return Array.isArray(result) ? result : result.rows;
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

/**
 * A data port over a query function. Create it for each request, from the query function of
 * the request's transaction, so a rule sees the rows that transaction wrote.
 *
 * ```ts
 * queryFunctionDataPort((text, params) => dataSource.query(text, params)); // TypeORM
 * queryFunctionDataPort((text, params) => prisma.$queryRawUnsafe(text, ...params)); // Prisma
 * ```
 */
export function queryFunctionDataPort(query: QueryFunction): DataPort {
    return wrapQuery(query);
}
