/**
 * The host-supplied schema contract.
 *
 * Minab has no in-file table/column declarations — `#Customer` (spec §2.2)
 * is deliberately "opened inline without a prior declaration." Minab is
 * embedded in a larger web application (editing happens in-browser, inside
 * Monaco) and that host supplies the real table names, column names, and
 * built-in function signatures at runtime; they are never declared in
 * `.minab` source.
 *
 * Column/function types are structured (roadmap Phase 4's `types.ts`)
 * rather than the provisional display strings Phase 2 shipped with — this
 * is what lets the type-checker actually reason about `ref`/`collection`
 * traversal and no-implicit-coercion instead of just "does this name exist."
 */

import type { ArrayType, DeclaredType, RefType, ScalarType } from './types.js';

/**
 * A column's type as the host describes it. `scalar`/`array`/`ref` reuse
 * `types.ts`'s shapes directly; the `collection` case is host-facing-only
 * (just the target table — the type-checker fills in the rest, since a
 * collection's own `element` shape is always derivable from `table`).
 */
export type MinabFieldType = ScalarType | ArrayType | RefType | { kind: 'collection'; table: string };

export interface MinabColumnSchema {
    name: string;
    type: MinabFieldType;
}

export interface MinabTableSchema {
    name: string;
    columns: MinabColumnSchema[];
}

export interface MinabFunctionSchema {
    name: string;
    paramTypes: DeclaredType[];
    returnType: DeclaredType;
}

export interface MinabSchema {
    tables: MinabTableSchema[];
    functions: MinabFunctionSchema[];
}

export const EMPTY_SCHEMA: MinabSchema = { tables: [], functions: [] };

/**
 * Host-supplied context distinguishing a field-level rule from a record-
 * level rule or general program (spec §6.2). Minab's own grammar has no
 * marker for this — a rule that uses `$` is *implicitly* field-level, but
 * whether `$` is legal at all in the program being validated is a fact
 * only the host knows (which validation slot this program is attached
 * to), not something derivable from the source text. See Phase 3's
 * `Validator`, which is the only consumer of this.
 */
export interface MinabRuleContext {
    /** True when `$` (FieldValue) is valid anywhere in this program. */
    isFieldRule: boolean;
    /**
     * The declared type of the field being validated, when the host
     * supplies it — lets `$` participate in type-checking (Phase 4), e.g.
     * `.total > $` needs to know `$`'s type to check the comparison. Left
     * `undefined` when the host doesn't supply it, in which case `$` types
     * as `unknown` (no false positives).
     */
    fieldType?: MinabFieldType;
}

export const DEFAULT_RULE_CONTEXT: MinabRuleContext = { isFieldRule: false };

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
