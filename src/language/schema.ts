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
import { EMPTY_HOST, type ResolvedHost, type ResolvedHostFunction } from './host-declarations.js';

/**
 * A schema column's relational shape (spec §3).
 *
 * `foreignKey` says *how* the two tables are linked, which nothing in
 * Minab source ever names. Phases 2-4 never needed it — resolution and
 * typing only care about the target table. Execution (Phase 5) does: to
 * run `.customer.country` or `COUNT(.orders[...])` at all, something has
 * to know which column joins the two. It sits on opposite sides for the
 * two kinds, which is exactly the `ref`/`collection` distinction:
 *  - `ref`: the column *on this table* holding the target row's key.
 *  - `collection`: the column *on the target table* holding this row's key.
 * Both are *physical* column names (the name in the database), and may
 * name a column that is not in the schema. They are never mapped through
 * `sqlName`.
 *
 * Optional so existing hosts/fixtures keep working; a traversal across a
 * relation that doesn't declare one fails with an explicit reason rather
 * than guessing at a naming convention.
 */
export type ColumnType =
    | { kind: 'scalar'; type: ScalarType }
    | { kind: 'ref'; table: string; nullable: boolean; foreignKey?: string }
    | { kind: 'collection'; table: string; foreignKey?: string };

export interface MinabColumnSchema {
    /** The name Minab source and result rows use. Any text (spec §2.4). */
    name: string;
    type: ColumnType;
    /** The column's name in the database, when it differs from `name`. The compiler writes `sqlName ?? name`. */
    sqlName?: string;
}

export interface MinabTableSchema {
    /** The name Minab source uses. Any text (spec §2.4). */
    name: string;
    /** The table's name in the database, when it differs from `name`. The compiler writes `sqlName ?? name`. */
    sqlName?: string;
    columns: MinabColumnSchema[];
    /**
     * The column identifying a row of this table. Needed by Phase 5 to
     * compare two records (`. != ^`, spec §6.1) and to follow a `ref`
     * to its target row — both of which are questions about row identity
     * that Minab source never spells out. This is the "primary-key marker
     * in the schema contract that doesn't exist yet" Phase 4 flagged when
     * it found the four `ref`-compared-to-scalar defects.
     *
     * It is a *schema* column name (a `name`, not a `sqlName`); the compiler
     * maps it to the column's `sqlName` when it writes SQL.
     */
    primaryKey?: string;
}

export interface MinabSchema {
    /**
     * Names this schema for caches (runtime D29). Two schemas with the same
     * version must be the same schema. Shamsine: a hash of the datasets'
     * fields. When it is missing, the runtime hashes the whole schema.
     */
    version?: string;
    tables: MinabTableSchema[];
}

export const EMPTY_SCHEMA: MinabSchema = { tables: [] };

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
 * Thin lookup wrapper around a host-supplied `MinabSchema`, plus the host's
 * declared inputs and functions (D27). Kept as its own service (rather than
 * folding lookups into the scope resolver) so a host can swap in a
 * live/async-backed implementation later without touching resolution logic.
 */
export class SchemaProvider {
    constructor(
        private readonly schema: MinabSchema,
        private readonly host: ResolvedHost = EMPTY_HOST
    ) {}

    getTable(name: string): MinabTableSchema | undefined {
        return this.schema.tables.find(t => t.name === name) ?? this.host.inputTables.get(name);
    }

    getColumn(tableName: string, columnName: string): MinabColumnSchema | undefined {
        return this.getTable(tableName)?.columns.find(c => c.name === columnName);
    }

    /** The type of a host input, or `undefined` when the host declared no input of this name. */
    getHostInput(name: string): MinabType | undefined {
        return this.host.inputs.get(name);
    }

    getHostFunction(name: string): ResolvedHostFunction | undefined {
        return this.host.functions.get(name);
    }

    /** Every declared host input, with its type. The editor lists them. */
    hostInputs(): ReadonlyMap<string, MinabType> {
        return this.host.inputs;
    }

    /** Every declared host function. The editor lists them. */
    hostFunctions(): ReadonlyMap<string, ResolvedHostFunction> {
        return this.host.functions;
    }

    /** Every table of the schema. */
    tables(): readonly MinabTableSchema[] {
        return this.schema.tables;
    }

    /** True when the name belongs to the host: an input or a function (D11). */
    isHostName(name: string): boolean {
        return this.host.inputs.has(name) || this.host.functions.has(name);
    }
}
