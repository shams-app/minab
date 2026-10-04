/**
 * A data port over any function `(text, params) => rows`.
 *
 * TypeORM (`dataSource.query`, or a `QueryRunner`'s `query`) and Prisma (`$queryRawUnsafe`)
 * both fit, and this package depends on neither. Minab's SQL uses Postgres `$1` placeholders.
 */

import { DataSourceError } from '../host/fixture-executor.js';
import type { DataPort, Row, SqlQuery, WritePort, WriteTransaction } from '../runtime/index.js';

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

/**
 * What a query function may return for a write: the rows, an object with `rows` and `rowCount` (like `pg`),
 * or the pair TypeORM's PostgreSQL driver gives for `UPDATE` and `DELETE`: `[rows, affected]`.
 */
export type WriteQueryResult = QueryFunctionResult | { rows?: Row[]; rowCount?: number | null } | [Row[], number];

export type WriteQueryFunction = (text: string, params: unknown[]) => Promise<WriteQueryResult>;

/** The number of rows a write changed, from any of the results above. */
export function affectedRows(result: WriteQueryResult): number {
    if (Array.isArray(result)) {
        if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') return result[1];
        return result.length;
    }
    const counted = result as { rows?: Row[]; rowCount?: number | null };
    return counted.rowCount ?? counted.rows?.length ?? 0;
}

/**
 * A write port over a query function, for a host that already has a transaction: a TypeORM
 * `QueryRunner` it started, or a Prisma transaction client. The host starts and ends the
 * transaction. This port only executes the statements inside it. When the run fails, the
 * transaction function throws, and the host rolls back.
 *
 * ```ts
 * await dataSource.transaction(async manager => {
 *     const query = (text, params) => manager.query(text, params);
 *     const result = await program.run({}, { data: queryFunctionDataPort(query), write: queryFunctionWritePort(query) }, { writes: 'apply' });
 *     if (!result.ok) throw new Error(result.error.message); // rolls back the host's transaction
 * });
 * ```
 */
export function queryFunctionWritePort(query: WriteQueryFunction): WritePort {
    return { transaction: work => work(writeTransaction(query)) };
}

/** The transaction object both write ports hand to Minab: reads and writes over one query function. */
export function writeTransaction(query: WriteQueryFunction): WriteTransaction {
    return {
        execute: wrapQuery(query as QueryFunction).execute,
        async executeWrite(statement: SqlQuery): Promise<{ rows: Row[]; affected: number }> {
            const result = await wrapWrite(query, statement);
            return { rows: [], affected: affectedRows(result) };
        }
    };
}

async function wrapWrite(run: WriteQueryFunction, query: SqlQuery): Promise<WriteQueryResult> {
    try {
        return await run(query.text, query.params);
    } catch (e) {
        // Same rule as reads: the statement is part of the report, the SQLSTATE stays on the error.
        const error = new DataSourceError(
            `the database rejected this statement:\n  ${query.text}\n` + `  parameters: ${JSON.stringify(query.params)}\n` + `${(e as Error).message}`
        );
        const code = (e as { code?: unknown }).code;
        if (typeof code === 'string') Object.assign(error, { code });
        throw error;
    }
}
