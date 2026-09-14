/**
 * The host-supplied schema contract.
 *
 * Minab has no in-file table/column declarations — `#Customer` (spec §2.2)
 * is deliberately "opened inline without a prior declaration." Minab is
 * embedded in a larger web application (editing happens in-browser, inside
 * Monaco) and that host supplies the real table names, column names, and
 * built-in function signatures at runtime; they are never declared in
 * `.minab` source. This is a first cut at that contract, informed by what
 * the scope resolver (`minab-scope-resolver.ts`) needs — expect it to grow
 * once Phase 4's type system needs richer column types and relation info.
 */

export interface MinabColumnSchema {
    name: string;
    /**
     * A provisional, display-only type string (e.g. "INTEGER", "TEXT[]",
     * "ref(Customer)") — not yet the real logical type from spec §7.2.
     * Phase 4 should replace this with a proper type representation.
     */
    type: string;
}

export interface MinabTableSchema {
    name: string;
    columns: MinabColumnSchema[];
}

export interface MinabFunctionSchema {
    name: string;
    paramTypes: string[];
    returnType: string;
}

export interface MinabSchema {
    tables: MinabTableSchema[];
    functions: MinabFunctionSchema[];
}

export const EMPTY_SCHEMA: MinabSchema = { tables: [], functions: [] };

/**
 * Thin lookup wrapper around a host-supplied `MinabSchema`. Kept as its own
 * service (rather than folding lookups into the scope resolver) so a host
 * can swap in a live/async-backed implementation later without touching
 * resolution logic.
 */
export class SchemaProvider {
    constructor(private readonly schema: MinabSchema) {}

    getTable(name: string): MinabTableSchema | undefined {
        return this.schema.tables.find(t => t.name === name);
    }

    getColumn(tableName: string, columnName: string): MinabColumnSchema | undefined {
        return this.getTable(tableName)?.columns.find(c => c.name === columnName);
    }

    getFunction(name: string): MinabFunctionSchema | undefined {
        return this.schema.functions.find(f => f.name === name);
    }
}
