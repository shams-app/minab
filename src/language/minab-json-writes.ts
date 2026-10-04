/**
 * `INSERT`, `UPDATE` and `DELETE` on a `JSON` array (X6, ADR 0001, spec §10).
 *
 * A `JSON` array is one value in one column, not a table. The interpreter reads the value,
 * the functions here change it in memory, and the interpreter writes the whole new value
 * back with one `UPDATE` of that column. The array has an order, so `.$index` and a
 * position (`DELETE .tags[2]`) make sense here and not on a table (spec §3.5).
 *
 * The functions do not touch the database or the scope stack. The interpreter gives them
 * an `ElementEvaluator`, which evaluates an expression with `.` set to one element.
 */

import { isFilterAccess, isTupleAccess, type Expression, type OrderByClause, type LimitClause, type SetAssignment } from './generated/ast.js';
import Big from 'big.js';

type MinabValue = unknown;

/** Evaluates expressions for the elements of an array. The interpreter implements it. */
export interface ElementEvaluator {
    /** `expr` with `.` set to `element` and `.$index` set to `index`. */
    at(expr: Expression, element: MinabValue, index: number): Promise<MinabValue>;
    truthy(value: MinabValue): boolean;
    /** `current op value` for `+`, `-`, `*`, `/` (text joins with `+`). */
    arithmetic(operator: '+' | '-' | '*' | '/', current: MinabValue, value: MinabValue): MinabValue;
    /** `{ ...current, ...value }` for `:|`. */
    merge(current: MinabValue, value: MinabValue): MinabValue;
}

export interface ArrayClauses {
    whereClause?: { condition: Expression };
    orderByClause?: OrderByClause;
    limitClause?: LimitClause;
}

/** A write target such as `.tags[2]`, split into the column and the `[...]` after it, in the order they apply. */
export function splitSelectors(target: Expression): { base: Expression; selectors: Expression[] } {
    const selectors: Expression[] = [];
    let base = target;
    while (isFilterAccess(base) || isTupleAccess(base)) {
        selectors.unshift(base);
        base = base.receiver;
    }
    return { base, selectors };
}

/**
 * The positions an `UPDATE` or `DELETE` touches: first the `[...]` selectors in order (a position
 * counts inside the elements kept so far), then `WHERE`, then `ORDERBY` with `LIMIT` and `OFFSET`.
 */
export async function selectIndices(array: MinabValue[], selectors: Expression[], clauses: ArrayClauses, ev: ElementEvaluator): Promise<number[]> {
    let indices = array.map((_, i) => i);
    for (const selector of selectors) {
        if (isTupleAccess(selector)) {
            const at = indices[selector.index];
            indices = at === undefined ? [] : [at];
        } else if (isFilterAccess(selector)) {
            indices = await narrow(array, indices, selector.filter, ev);
        }
    }
    if (clauses.whereClause) indices = await filter(array, indices, clauses.whereClause.condition, ev);
    if (clauses.orderByClause) {
        const keyed: { index: number; keys: MinabValue[] }[] = [];
        for (const index of indices) {
            const keys: MinabValue[] = [];
            for (const item of clauses.orderByClause.items) keys.push(await ev.at(item.expression, array[index], index));
            keyed.push({ index, keys });
        }
        const items = clauses.orderByClause.items;
        keyed.sort((a, b) => {
            for (let k = 0; k < items.length; k++) {
                const order = compare(a.keys[k], b.keys[k]);
                if (order !== 0) return items[k].direction === 'DESC' ? -order : order;
            }
            return a.index - b.index;
        });
        indices = keyed.map(k => k.index);
    }
    if (clauses.limitClause) {
        const offset = clauses.limitClause.offset ?? 0;
        indices = indices.slice(offset, offset + clauses.limitClause.limit);
    }
    return indices;
}

/** `[x]`: a whole number is a position (`.tags[i]`), a boolean is a filter (spec §3.5). */
async function narrow(array: MinabValue[], indices: number[], expr: Expression, ev: ElementEvaluator): Promise<number[]> {
    if (indices.length === 0) return indices;
    const probe = await ev.at(expr, array[indices[0]], indices[0]);
    if (typeof probe === 'number') {
        const at = indices[probe];
        return Number.isInteger(probe) && at !== undefined ? [at] : [];
    }
    return await filter(array, indices, expr, ev);
}

async function filter(array: MinabValue[], indices: number[], condition: Expression, ev: ElementEvaluator): Promise<number[]> {
    const kept: number[] = [];
    for (const index of indices) {
        if (ev.truthy(await ev.at(condition, array[index], index))) kept.push(index);
    }
    return kept;
}

/** Order for `ORDERBY`: numbers by value, text by code unit, `false` before `true`, `null` last (as in Postgres). */
function compare(a: MinabValue, b: MinabValue): number {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
    if (b === null || b === undefined) return -1;
    if (a instanceof Big || b instanceof Big) return new Big(a as Big.BigSource).cmp(new Big(b as Big.BigSource));
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
    const [x, y] = [String(a), String(b)];
    return x < y ? -1 : x > y ? 1 : 0;
}

/** The array without the elements at `indices`. */
export function removeAt(array: MinabValue[], indices: number[]): MinabValue[] {
    const gone = new Set(indices);
    return array.filter((_, i) => !gone.has(i));
}

/**
 * The array with `SET { key op value }` applied to the elements at `indices`. An element must be an
 * object. A value is evaluated once for each element, with `.` set to that element.
 */
export async function updateAt(array: MinabValue[], indices: number[], assignments: readonly SetAssignment[], ev: ElementEvaluator): Promise<MinabValue[]> {
    const next = [...array];
    for (const index of indices) {
        const element = array[index];
        if (typeof element !== 'object' || element === null || Array.isArray(element) || element instanceof Big) {
            throw new JsonArrayError('UPDATE on a JSON array needs elements that are objects');
        }
        const copy: Record<string, MinabValue> = { ...(element as Record<string, MinabValue>) };
        for (const assignment of assignments) {
            const value = await ev.at(assignment.value, element, index);
            const current = copy[assignment.key] ?? null;
            switch (assignment.operator) {
                case ':':
                    copy[assignment.key] = value;
                    break;
                case ':|':
                    copy[assignment.key] = ev.merge(current, value);
                    break;
                default:
                    copy[assignment.key] = ev.arithmetic(assignment.operator.slice(0, 1) as '+' | '-' | '*' | '/', current, value);
            }
        }
        next[index] = copy;
    }
    return next;
}

/** A refusal of the interpreter: the array cannot be changed this way. */
export class JsonArrayError extends Error {}
