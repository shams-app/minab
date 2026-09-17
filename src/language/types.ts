/**
 * Minab's type representation (roadmap Phase 4). Maps spec §7.2's logical
 * types onto a representation rich enough to type every expression form in
 * the grammar, not just `let`/param/return-type declarations.
 *
 * Two layers:
 *  - `DeclaredType` — exactly what a grammar `Type` node (`TypeRef` |
 *    `TupleType`) can express: what a `let`, a `Param`, or a function's
 *    `returnType` can be declared as (spec §7.2, §7.6).
 *  - `MinabType` — the broader set any *expression* can infer to, adding
 *    `ref`/`collection` (spec §3's relational traversal), `null` (the
 *    literal, and anything else statically known to always be null), and
 *    `unknown` (silent error-recovery — assignable to/from anything, never
 *    itself the subject of a diagnostic, so one real problem doesn't
 *    cascade into a wall of downstream noise).
 */

import { isTupleType, type Type as TypeNode } from './generated/ast.js';

export type ScalarBase =
    | 'TEXT' | 'CITEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN'
    | 'DATE' | 'TIME' | 'DATETIME' | 'UUID' | 'JSON';

export interface ScalarType {
    kind: 'scalar';
    base: ScalarBase;
    nullable: boolean;
    /**
     * Set on an untyped numeric constant (a bare `NumberLiteral`) — per
     * Hamed's call (2026-09-17), a literal like `100`/`12.5` flexes between
     * an INTEGER and a DECIMAL context with no `CAST` needed. Only two
     * already-*typed* numeric values of different bases (e.g. an INTEGER
     * column vs. a DECIMAL column) require `CAST`. Never set on a
     * schema/variable-typed value.
     */
    literal?: boolean;
}

export interface ArrayType {
    kind: 'array';
    elementBase: ScalarBase;
    elementNullable: boolean;
    nullable: boolean;
}

export interface TupleType {
    kind: 'tuple';
    elements: MinabType[];
}

export interface RefType {
    kind: 'ref';
    table: string;
    nullable: boolean;
}

export interface CollectionType {
    kind: 'collection';
    /**
     * Present when this collection is still relationally backed by a real
     * table, so a further `.field` can chase another column (spec §3.1).
     * Absent once broadcasting has produced a collection of plain values,
     * e.g. `.orders.total` — a collection of DECIMAL, not of Order rows.
     */
    table?: string;
    element: MinabType;
}

export interface NullType {
    kind: 'null';
}

export interface UnknownType {
    kind: 'unknown';
}

export type DeclaredType = ScalarType | ArrayType | TupleType;
export type MinabType = DeclaredType | RefType | CollectionType | NullType | UnknownType;

const NUMERIC = new Set<ScalarBase>(['INTEGER', 'DECIMAL']);
const STRINGISH = new Set<ScalarBase>(['TEXT', 'CITEXT']);
const ORDERABLE = new Set<ScalarBase>(['TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'DATE', 'TIME', 'DATETIME']);

/**
 * Whether two scalar bases can be compared/combined without an explicit
 * `CAST` (spec §5.5's no-implicit-coercion rule), given the two
 * interchangeability rules Hamed confirmed for this phase:
 *  - two numeric bases (INTEGER/DECIMAL) are compatible when at least one
 *    side is an untyped numeric literal;
 *  - TEXT and CITEXT are always interchangeable (unlike every other pair).
 */
export function basesCompatible(a: ScalarBase, b: ScalarBase, literalA = false, literalB = false): boolean {
    if (a === b) {
        return true;
    }
    if (NUMERIC.has(a) && NUMERIC.has(b) && (literalA || literalB)) {
        return true;
    }
    return STRINGISH.has(a) && STRINGISH.has(b);
}

/** Converts a grammar `Type` node (`TypeRef` | `TupleType`) into a `DeclaredType`. */
export function typeFromTypeNode(node: TypeNode): DeclaredType {
    if (isTupleType(node)) {
        return { kind: 'tuple', elements: node.elementTypes.map(typeFromTypeNode) };
    }
    if (node.array) {
        return {
            kind: 'array',
            elementBase: node.base as ScalarBase,
            elementNullable: node.nullable,
            nullable: node.arrayNullable
        };
    }
    return { kind: 'scalar', base: node.base as ScalarBase, nullable: node.nullable };
}

/**
 * Whether a value of type `value` can be assigned to (or passed/compared
 * against) something declared as `target`, with no implicit coercion.
 * Used for `let`/`Param` initializers, assignment targets, and function
 * call arguments alike.
 */
export function isAssignable(value: MinabType, target: MinabType): boolean {
    if (target.kind === 'unknown' || value.kind === 'unknown') {
        return true;
    }
    if (value.kind === 'null') {
        if (target.kind === 'scalar' || target.kind === 'array' || target.kind === 'ref') {
            return target.nullable;
        }
        return target.kind === 'null';
    }
    switch (target.kind) {
        case 'scalar':
            if (target.base === 'JSON') {
                return true; // JSON is "structured data of unknown shape" (§7.2) — anything can be represented as JSON, so this is always a widening, never a coercion
            }
            return (
                value.kind === 'scalar' &&
                (!value.nullable || target.nullable) &&
                basesCompatible(value.base, target.base, value.literal, target.literal)
            );
        case 'array':
            return (
                value.kind === 'array' &&
                (!value.nullable || target.nullable) &&
                (!value.elementNullable || target.elementNullable) &&
                basesCompatible(value.elementBase, target.elementBase)
            );
        case 'tuple':
            return (
                value.kind === 'tuple' &&
                value.elements.length === target.elements.length &&
                value.elements.every((v, i) => isAssignable(v, target.elements[i]))
            );
        case 'ref':
            return value.kind === 'ref' && value.table === target.table && (!value.nullable || target.nullable);
        case 'collection':
            return value.kind === 'collection' && value.table === target.table;
        case 'null':
            return false; // `null` is never itself a legal declared/target type
    }
}

/** Whether `a`/`b` can be compared with `==`/`!=` (or, transitively, `IN`) without an explicit `CAST`. */
export function equalityCompatible(a: MinabType, b: MinabType): boolean {
    if (a.kind === 'unknown' || b.kind === 'unknown') {
        return true;
    }
    if (a.kind === 'null' || b.kind === 'null') {
        return true; // §7.7 — null is always a valid == / != operand
    }
    if (a.kind === 'collection' || b.kind === 'collection') {
        return false; // caught with a dedicated §3.4 message by the caller
    }
    if (a.kind !== b.kind) {
        return false;
    }
    switch (a.kind) {
        case 'scalar':
            return basesCompatible(a.base, (b as ScalarType).base, a.literal, (b as ScalarType).literal);
        case 'array':
            return basesCompatible(a.elementBase, (b as ArrayType).elementBase);
        case 'ref':
            return a.table === (b as RefType).table;
        case 'tuple': {
            const bt = b as TupleType;
            return a.elements.length === bt.elements.length && a.elements.every((e, i) => equalityCompatible(e, bt.elements[i]));
        }
    }
}

/**
 * Whether `a`/`b` can be compared with `<`/`<=`/`>`/`>=`. Does *not* reject
 * a literal/definite `null` operand on its own — that's a separate,
 * dedicated §7.7 rule-3 check the caller applies before reaching here,
 * since it's a different diagnostic ("null isn't a valid operand" vs. "no
 * implicit coercion").
 */
export function orderingCompatible(a: MinabType, b: MinabType): boolean {
    if (a.kind === 'unknown' || b.kind === 'unknown') {
        return true;
    }
    if (a.kind !== 'scalar' || b.kind !== 'scalar') {
        return false;
    }
    if (!ORDERABLE.has(a.base) || !ORDERABLE.has(b.base)) {
        return false;
    }
    return basesCompatible(a.base, b.base, a.literal, b.literal);
}

export function describeType(t: MinabType): string {
    switch (t.kind) {
        case 'scalar':
            return t.base + (t.nullable ? '?' : '');
        case 'array':
            return t.elementBase + (t.elementNullable ? '?' : '') + '[]' + (t.nullable ? '?' : '');
        case 'tuple':
            return '(' + t.elements.map(describeType).join(', ') + ')';
        case 'ref':
            return `ref(${t.table})` + (t.nullable ? '?' : '');
        case 'collection':
            return `collection(${t.table ?? describeType(t.element)})`;
        case 'null':
            return 'null';
        case 'unknown':
            return 'unknown';
    }
}
