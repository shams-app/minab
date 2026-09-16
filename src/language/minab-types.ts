/**
 * The type system (roadmap Phase 4). A structured representation of
 * Minab's logical types (spec §7.2) plus the relational shapes a schema
 * field can have (spec §3) — used both by `schema.ts` (the host-supplied
 * column/function contract) and by `MinabTypeChecker`'s inference output.
 *
 * This deliberately mirrors the grammar's own `TypeRef`/`TupleType` shape
 * (`minab.langium`) for the `scalar` case, plus three extra kinds that
 * only make sense as an *inferred* type, never as something written in
 * Minab source: `record`/`collection` (the relational traversal targets
 * from spec §3) and `null`/`error` (bookkeeping — see below).
 */

export type LogicalTypeBase =
    | 'TEXT' | 'CITEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN'
    | 'DATE' | 'TIME' | 'DATETIME' | 'UUID' | 'JSON';

/** Types orderable with `<`/`<=`/`>`/`>=` (spec §7.2 — UUID has no ordering). */
export const ORDERABLE_BASES: ReadonlySet<LogicalTypeBase> = new Set([
    'TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'DATE', 'TIME', 'DATETIME'
]);

export const NUMERIC_BASES: ReadonlySet<LogicalTypeBase> = new Set(['INTEGER', 'DECIMAL']);
export const TEXT_BASES: ReadonlySet<LogicalTypeBase> = new Set(['TEXT', 'CITEXT']);

/** Mirrors the grammar's `TypeRef` exactly. `array: true` also stands in for any value-collection: a list literal, a broadcast scalar column, or a JSON array — Minab's own type domain has no separate "array of values" kind beyond this flag. */
export interface ScalarType {
    kind: 'scalar';
    base: LogicalTypeBase;
    nullable: boolean;
    array: boolean;
    arrayNullable: boolean;
}

export interface TupleType {
    kind: 'tuple';
    elements: MinabType[];
}

/** A single related row (a `ref` traversal target, or `.`/`^`/`#alias` itself). */
export interface RecordType {
    kind: 'record';
    table: string;
}

/** A to-many relational collection — NOT reducible to a scalar without an aggregate/predicate (spec §3.4). Also stands in for a collection produced by broadcasting a `ref`/`collection` field across another collection. */
export interface CollectionType {
    kind: 'collection';
    table: string;
}

/** `NullLiteral`'s own type — unifies with any nullable position, and is the one type compatible with an otherwise-mismatched operand for `==`/`!=`/`is`/`isnot` (spec §7.7). */
export interface NullType {
    kind: 'null';
}

export type MinabType = ScalarType | TupleType | RecordType | CollectionType | NullType;

export function scalarType(
    base: LogicalTypeBase,
    options: { nullable?: boolean; array?: boolean; arrayNullable?: boolean } = {}
): ScalarType {
    return {
        kind: 'scalar',
        base,
        nullable: options.nullable ?? false,
        array: options.array ?? false,
        arrayNullable: options.arrayNullable ?? false
    };
}

export const NULL_TYPE: NullType = { kind: 'null' };

export function isScalar(type: MinabType): type is ScalarType {
    return type.kind === 'scalar';
}

export function isNumeric(type: MinabType): type is ScalarType {
    return isScalar(type) && !type.array && NUMERIC_BASES.has(type.base);
}

export function isOrderable(type: MinabType): type is ScalarType {
    return isScalar(type) && !type.array && ORDERABLE_BASES.has(type.base);
}

export function isTextual(type: MinabType): type is ScalarType {
    return isScalar(type) && !type.array && TEXT_BASES.has(type.base);
}

/**
 * `INTEGER` and `DECIMAL` are treated as one numeric family, freely
 * comparable/combinable without an explicit `CAST` (unlike genuinely
 * distinct types, e.g. `TEXT` vs `UUID`) — `DECIMAL` wins when the two
 * mix. This is narrower than spec §5.5's literal wording ("a DECIMAL
 * against an INTEGER... requires an explicit CAST") but was found
 * necessary empirically: applying that sentence literally to bare numeric
 * literals (`.total > 1000` where `.total` is DECIMAL) would reject most
 * of the existing showcase corpus, which never CASTs a plain integer
 * literal against a DECIMAL column. Flagged for Hamed to confirm — same
 * "found empirically, documented, judgment call" pattern as Phase 1's
 * defects (see docs/roadmap.md Phase 4).
 */
export function widenNumeric(a: LogicalTypeBase, b: LogicalTypeBase): LogicalTypeBase {
    return a === 'DECIMAL' || b === 'DECIMAL' ? 'DECIMAL' : 'INTEGER';
}

/** Whether a value of this type may be `null` at runtime (base position — for an array-typed `ScalarType`, whether the array itself may be `null`, mirroring the grammar's independent `nullable`/`arrayNullable` flags). */
export function isNullable(type: MinabType): boolean {
    if (type.kind === 'null') return true;
    if (type.kind === 'scalar') return type.array ? type.arrayNullable : type.nullable;
    if (type.kind === 'record') return true; // a `ref`'s nullability is column-specific; callers needing precision should check the column directly rather than this generic helper
    return false;
}

/**
 * Structural equality, ignoring nullability — used for the "no implicit
 * coercion" checks (spec §5.5): two operands are compatible only when
 * this returns true (or one side is `{kind:'null'}`/`{kind:'error'}`).
 */
export function baseTypesEqual(a: MinabType, b: MinabType): boolean {
    if (a.kind === 'null' || b.kind === 'null') return true;
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case 'scalar':
            if (b.kind !== 'scalar' || a.array !== b.array) return false;
            return a.base === b.base || (NUMERIC_BASES.has(a.base) && NUMERIC_BASES.has(b.base));
        case 'tuple':
            return b.kind === 'tuple' && a.elements.length === b.elements.length
                && a.elements.every((e, i) => baseTypesEqual(e, b.elements[i]));
        case 'record':
            return b.kind === 'record' && a.table === b.table;
        case 'collection':
            return b.kind === 'collection' && a.table === b.table;
        default:
            return true;
    }
}

/**
 * Whether a value of type `value` may be assigned into a binding declared
 * as `target` — stricter than `baseTypesEqual` (used for operator
 * compatibility): a `null` value is only assignable into a *nullable*
 * target (spec §7.2's literal-initializer rule, extended here to any
 * value of static type `null`/nullable-scalar, not just a written
 * `NullLiteral`), and a nullable-scalar value can't flow into a
 * non-nullable target of the same base type either.
 */
export function isAssignableTo(value: MinabType, target: MinabType): boolean {
    // JSON accepts any shape by definition (spec §7.3: "a JSON-typed
    // variable can hold either a JSON object or a JSON list" — and, by the
    // same logic, any scalar) — a list literal like `["a","b"]` infers as
    // `TEXT[]`, not `JSON`, so without this a JSON-typed `let`/param/return
    // could only ever be initialized from an object literal, contradicting
    // §7.3's own list-literal example.
    if (target.kind === 'scalar' && target.base === 'JSON' && !target.array) {
        return value.kind === 'null' ? target.nullable : true;
    }
    if (value.kind === 'null') return isNullable(target);
    if (value.kind !== target.kind) return false;
    switch (value.kind) {
        case 'scalar': {
            if (target.kind !== 'scalar' || value.array !== target.array) return false;
            const baseOk = value.base === target.base || (NUMERIC_BASES.has(value.base) && NUMERIC_BASES.has(target.base));
            if (!baseOk) return false;
            return value.array ? !(value.arrayNullable && !target.arrayNullable) : !(value.nullable && !target.nullable);
        }
        case 'tuple':
            return target.kind === 'tuple' && value.elements.length === target.elements.length
                && value.elements.every((e, i) => isAssignableTo(e, target.elements[i]));
        case 'record':
            return target.kind === 'record' && value.table === target.table;
        case 'collection':
            return target.kind === 'collection' && value.table === target.table;
    }
}

/** Human-readable rendering for diagnostic messages. */
export function formatType(type: MinabType): string {
    switch (type.kind) {
        case 'scalar': {
            let s = type.base + (type.nullable ? '?' : '');
            if (type.array) s += '[]' + (type.arrayNullable ? '?' : '');
            return s;
        }
        case 'tuple':
            return `(${type.elements.map(formatType).join(', ')})`;
        case 'record':
            return `record<${type.table}>`;
        case 'collection':
            return `collection<${type.table}>`;
        case 'null':
            return 'null';
    }
}
