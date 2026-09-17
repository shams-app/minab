/**
 * The host-supplied execution contract (roadmap Phase 5, ADR 0001).
 *
 * Same shape of thing as `SchemaProvider` in `schema.ts`: Minab source
 * never names a connection, a driver, or a transaction, so the host hands
 * one in. Keeping it behind this interface is what lets the ADR defer
 * "which concrete driver" — the compiler emits text plus positional
 * parameters, and the host runs it however it already runs SQL.
 */

/** A compiled statement: SQL text with `$1`-style positional placeholders, plus the values to bind. */
export interface SqlQuery {
    text: string;
    params: unknown[];
}

export type Row = Record<string, unknown>;

export interface QueryExecutor {
    execute(query: SqlQuery): Promise<Row[]>;
}
