/**
 * The host-supplied schema contract.
 *
 * Minab has no in-file table/column declarations — `#Customer` (spec §2.2)
 * is deliberately "opened inline without a prior declaration." Minab is
 * embedded in a larger web application (editing happens in-browser, inside
 * Monaco) and that host supplies the real table names, column names, and
 * built-in function signatures at runtime; they are never declared in
 * `.minab` source. Phase 2 shipped a first cut with a free-form, display-
 * only `type: string` per column; Phase 4 (the type system) replaces that
 * with the structured `ColumnType` below, matching spec §3's `scalar` /
 * `ref(Table)` / `collection(Table)` distinction and §7.2's logical types.
 */

import { scalarType, type MinabType, type ScalarType } from './minab-types.js';

/** A schema column's relational shape (spec §3). */
export type ColumnType =
    | { kind: 'scalar'; type: ScalarType }
    | { kind: 'ref'; table: string; nullable: boolean }
    | { kind: 'collection'; table: string };

export interface MinabColumnSchema {
    name: string;
    type: ColumnType;
}

export interface MinabTableSchema {
    name: string;
    columns: MinabColumnSchema[];
}

/**
 * `paramTypes`/`returnType` use the same structured `MinabType` as
 * everything else, for consistency — this field predates Phase 4 and its
 * actual purpose (beyond the built-in/user-`fn` split, both of which are
 * resolved without consulting it — see `minab-builtins.ts` and
 * `FunctionDecl` resolution in `minab-type-checker.ts`) is unclear; it's
 * left structurally upgraded but unconsumed until a real need surfaces.
 */
export interface MinabFunctionSchema {
    name: string;
    paramTypes: MinabType[];
    returnType: MinabType;
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
 * `Validator`, which is the only consumer of `isFieldRule`.
 */
export interface MinabRuleContext {
    /** True when `$` (FieldValue) is valid anywhere in this program. */
    isFieldRule: boolean;
    /**
     * `$`'s type inside a field rule — the type of whichever field this
     * program is attached to. Only meaningful when `isFieldRule` is true;
     * the host knows it the same way it knows `isFieldRule` itself
     * (nothing in Minab source names the field). Absent means the type
     * checker can't type `$` and reports an error.
     */
    fieldType?: ScalarType;
    /**
     * The table a bare top-level `.`/`^` resolves to (spec §6) — "the
     * record under validation." `MinabScopeResolver` (Phase 2) can't know
     * this: a validation rule's source never names its own table, only
     * wherever the host attaches the rule does. Without this, `.field` at
     * the top level of *every* validation rule (record- or field-level —
     * the primary use case in spec §6) would be untypeable; found during
     * Phase 4 implementation, same "host-supplied fact, same shape as
     * `isFieldRule`" pattern as `fieldType` above.
     */
    recordTable?: string;
}

export const DEFAULT_RULE_CONTEXT: MinabRuleContext = { isFieldRule: false };

// Re-exported so callers building a `MinabSchema`/`MinabRuleContext`
// fixture don't need a separate import from `minab-types.ts` just for
// this one helper.
export { scalarType };

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
