/**
 * The built-in functions (spec §5.3.1), called by name (`NAME(...)`) like user
 * functions. Each built-in is one entry in the table below. The type checker,
 * the interpreter and the SQL compiler all read this table. None of them has
 * a `switch` on a function name.
 *
 * An entry has:
 * - `kind`: `aggregate` and `predicate` read a collection; `scalar` reads values;
 * - `params`: the parameters (a type rule, optional, or rest) — they give the arity and the type checks;
 * - `returns`: the type of the answer, from the types of the arguments;
 * - `evaluate`: the interpreter's function;
 * - `sql`: the SQL form (a scalar), or `sqlAggregate` (an aggregate or predicate).
 *
 * Built-in names are ALL UPPERCASE; a user `fn` name must have a lowercase
 * letter (D10, spec §5.3) — see `minab-validator.ts`'s `checkFunctionDeclName`.
 */

import { coded, type CodedMessage } from './diagnostics/codes.js';
import { arithmetic, Big, checkInteger, decimalCompare, isDecimal, toNumeric, type Numeric } from './values.js';
import {
    baseTypesEqual,
    formatType,
    isNumeric,
    isOrderable,
    isScalar,
    isTextual,
    NUMERIC_BASES,
    NULL_TYPE,
    scalarType,
    widenNumeric,
    type MinabType,
    type ScalarType
} from './minab-types.js';

export type BuiltinCheckResult = { ok: true; type: MinabType } | ({ ok: false } & CodedMessage);

export type BuiltinKind = 'aggregate' | 'predicate' | 'scalar';

/**
 * What a parameter accepts. A `null` argument fits every kind of a scalar function.
 * - `collection`, `numericCollection`, `orderableCollection`, `booleanCollection`: a collection or an array (of those items);
 * - `text`: `TEXT` or `CITEXT`; `integer`: `INTEGER`; `number`: `INTEGER` or `DECIMAL`;
 * - `orderable`: a type with an order (not an array); `scalar`: any single value.
 */
export type ParamKind =
    | 'collection'
    | 'numericCollection'
    | 'orderableCollection'
    | 'booleanCollection'
    | 'text'
    | 'integer'
    | 'number'
    | 'orderable'
    | 'scalar';

export interface BuiltinParam {
    kind: ParamKind;
    /** The caller may leave it out (only after the required ones). */
    optional?: boolean;
    /** Takes any number of arguments from here on (must be the last parameter). */
    rest?: boolean;
}

/** What the interpreter and the compiler know about one argument, beyond its value or SQL. */
export interface BuiltinArgInfo {
    /** The argument has type `CITEXT`. */
    citext: boolean;
}

/** An argument as SQL text, with what the compiler knows about it. */
export interface SqlArg extends BuiltinArgInfo {
    sql: string;
}

/** How an aggregate or predicate looks in SQL. */
export type SqlAggregate = { shape: 'exists' } | { shape: 'count' } | { shape: 'column'; fn: string } | { shape: 'none' };

/** A runtime problem in a built-in (for example a negative length). The interpreter turns it into an evaluation error. */
export class BuiltinError extends Error {}

export interface BuiltinSignature {
    name: string;
    kind: BuiltinKind;
    params: BuiltinParam[];
    /** The type of the answer. The arguments already passed the checks. */
    returns(args: MinabType[]): MinabType;
    /**
     * Scalars: `false` (the default is `true`) means the function handles `null` itself.
     * With `true`, a `null` argument gives `null` without calling `evaluate`.
     */
    nullPropagates?: boolean;
    /** Aggregates and predicates get `[items]`; a scalar gets its argument values (an omitted optional one is `undefined`). */
    evaluate(args: unknown[], info: BuiltinArgInfo[]): unknown;
    /** A scalar's SQL form. */
    sql?(args: SqlArg[]): string;
    /** An aggregate's or predicate's SQL form. */
    sqlAggregate?: SqlAggregate;
    /** Extra checks across arguments (for example "all the same type"). */
    checkArgs?(args: MinabType[]): BuiltinCheckResult | undefined;
}

// ---- type helpers -----------------------------------------------------

function elementType(argType: MinabType): ScalarType | undefined {
    if (argType.kind === 'scalar' && argType.array) {
        return scalarType(argType.base, { nullable: argType.nullable });
    }
    // The element of a relational collection is itself a record, not a scalar — SUM/AVG/MIN/MAX
    // look past this at the broadcast scalar case instead.
    return undefined;
}

function isCollectionLike(type: MinabType): boolean {
    return type.kind === 'collection' || (type.kind === 'scalar' && type.array);
}

function nullable(type: MinabType): boolean {
    return type.kind === 'null' || (type.kind === 'scalar' && type.nullable);
}

const anyNullable = (args: MinabType[]) => args.some(nullable);

const EXPECTED: Record<ParamKind, string> = {
    collection: 'a collection',
    numericCollection: 'a collection of INTEGER or DECIMAL',
    orderableCollection: 'a collection of an orderable type',
    booleanCollection: 'a collection of BOOLEAN',
    text: 'TEXT',
    integer: 'INTEGER',
    number: 'INTEGER or DECIMAL',
    orderable: 'an orderable type',
    scalar: 'a single value'
};

/** Whether `type` fits a parameter kind. */
function fits(kind: ParamKind, type: MinabType): boolean {
    if (kind === 'collection') return isCollectionLike(type);
    if (kind === 'numericCollection' || kind === 'orderableCollection' || kind === 'booleanCollection') {
        const el = elementType(type);
        if (!el) return false;
        if (kind === 'numericCollection') return isNumeric(el);
        if (kind === 'orderableCollection') return isOrderable(el);
        return el.base === 'BOOLEAN';
    }
    if (type.kind === 'null') return true;
    if (kind === 'text') return isTextual(type);
    if (kind === 'integer') return isScalar(type) && !type.array && type.base === 'INTEGER';
    if (kind === 'number') return isNumeric(type);
    if (kind === 'orderable') return isOrderable(type);
    return isScalar(type) && !type.array;
}

/** The parameter that takes argument number `index` (from 0), or `undefined` when there are too many arguments. */
function paramAt(params: BuiltinParam[], index: number): BuiltinParam | undefined {
    const last = params[params.length - 1];
    if (index < params.length) return params[index];
    return last?.rest ? last : undefined;
}

function arityText(params: BuiltinParam[]): string {
    const min = params.filter(p => !p.optional && !p.rest).length;
    const rest = params.some(p => p.rest);
    const max = params.length;
    if (rest) return `at least ${min + (params[params.length - 1].optional ? 0 : 1)}`;
    return min === max ? String(min) : `${min} to ${max}`;
}

function arityFits(params: BuiltinParam[], count: number): boolean {
    const min = params.filter(p => !p.optional).length;
    const rest = params.some(p => p.rest);
    return count >= min && (rest || count <= params.length);
}

function collectionCode(
    kind: ParamKind
):
    | 'call.builtinNeedsCollection'
    | 'call.builtinNeedsNumericCollection'
    | 'call.builtinNeedsOrderableCollection'
    | 'call.builtinNeedsBooleanCollection'
    | undefined {
    switch (kind) {
        case 'collection':
            return 'call.builtinNeedsCollection';
        case 'numericCollection':
            return 'call.builtinNeedsNumericCollection';
        case 'orderableCollection':
            return 'call.builtinNeedsOrderableCollection';
        case 'booleanCollection':
            return 'call.builtinNeedsBooleanCollection';
        default:
            return undefined;
    }
}

/** Checks the arguments of a call against a built-in: the count, each type, then the rules across arguments. */
export function checkBuiltin(builtin: BuiltinSignature, args: MinabType[]): BuiltinCheckResult {
    const { name, params } = builtin;
    if (!arityFits(params, args.length)) {
        // The aggregates keep their own code (they take one collection); scalars use the general one.
        if (builtin.kind !== 'scalar') return { ok: false, ...coded('call.builtinArity', { name, actual: args.length }) };
        return { ok: false, ...coded('call.wrongArgumentCount', { name, expected: arityText(params), actual: args.length }) };
    }
    for (let i = 0; i < args.length; i++) {
        const param = paramAt(params, i)!;
        if (fits(param.kind, args[i])) continue;
        const code = collectionCode(param.kind);
        if (code) return { ok: false, ...coded(code, { name, actual: formatType(args[i]) }) };
        return { ok: false, ...coded('call.argumentType', { name, position: i + 1, expected: EXPECTED[param.kind], actual: formatType(args[i]) }) };
    }
    const across = builtin.checkArgs?.(args);
    if (across) return across;
    return { ok: true, type: builtin.returns(args) };
}

// ---- the table: aggregates and predicates -----------------------------

const COLLECTION: BuiltinParam[] = [{ kind: 'collection' }];

/** `SUM` is exact: `INTEGER` items give an `INTEGER`, any `DECIMAL` item gives a `DECIMAL`. */
const sum = (items: unknown[]): Numeric => items.reduce<Numeric>((total, item) => arithmetic('+', total, number(item)), 0);

function number(value: unknown): Numeric {
    const n = toNumeric(value);
    if (n === undefined) throw new BuiltinError('expected a number');
    return n;
}

const compareNumbers = (a: Numeric, b: Numeric): number => decimalCompare(a, b) ?? (a as number) - (b as number);

function truthy(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return false;
    throw new BuiltinError('expected a boolean');
}

const items = (args: unknown[]): unknown[] => args[0] as unknown[];

const AGGREGATES: BuiltinSignature[] = [
    {
        name: 'COUNT',
        kind: 'aggregate',
        params: COLLECTION,
        returns: () => scalarType('INTEGER'),
        evaluate: args => items(args).length,
        sqlAggregate: { shape: 'count' }
    },
    {
        name: 'SUM',
        kind: 'aggregate',
        params: [{ kind: 'numericCollection' }],
        returns: ([arg]) => elementType(arg)!,
        evaluate: args => sum(items(args)),
        sqlAggregate: { shape: 'column', fn: 'SUM' }
    },
    {
        name: 'AVG',
        kind: 'aggregate',
        params: [{ kind: 'numericCollection' }],
        returns: () => scalarType('DECIMAL'),
        evaluate: args => (items(args).length === 0 ? null : arithmetic('/', sum(items(args)), items(args).length)),
        sqlAggregate: { shape: 'column', fn: 'AVG' }
    },
    {
        name: 'MIN',
        kind: 'aggregate',
        params: [{ kind: 'orderableCollection' }],
        returns: ([arg]) => elementType(arg)!,
        evaluate: args =>
            items(args).length === 0
                ? null
                : items(args)
                      .map(number)
                      .reduce((a, b) => (compareNumbers(b, a) < 0 ? b : a)),
        sqlAggregate: { shape: 'column', fn: 'MIN' }
    },
    {
        name: 'MAX',
        kind: 'aggregate',
        params: [{ kind: 'orderableCollection' }],
        returns: ([arg]) => elementType(arg)!,
        evaluate: args =>
            items(args).length === 0
                ? null
                : items(args)
                      .map(number)
                      .reduce((a, b) => (compareNumbers(b, a) > 0 ? b : a)),
        sqlAggregate: { shape: 'column', fn: 'MAX' }
    },
    {
        name: 'EXISTS',
        kind: 'predicate',
        params: COLLECTION,
        returns: () => scalarType('BOOLEAN'),
        evaluate: args => items(args).length > 0,
        sqlAggregate: { shape: 'exists' }
    },
    {
        name: 'ALL',
        kind: 'predicate',
        params: [{ kind: 'booleanCollection' }],
        returns: () => scalarType('BOOLEAN'),
        evaluate: args => items(args).every(truthy),
        sqlAggregate: { shape: 'none' }
    },
    {
        name: 'ANY',
        kind: 'predicate',
        params: [{ kind: 'booleanCollection' }],
        returns: () => scalarType('BOOLEAN'),
        evaluate: args => items(args).some(truthy),
        sqlAggregate: { shape: 'none' }
    }
];

// ---- the table: scalar functions (D20) --------------------------------

const TEXT: BuiltinParam = { kind: 'text' };
const INTEGER: BuiltinParam = { kind: 'integer' };

/** The type of the first argument when it is text (so `CITEXT` stays `CITEXT`), else `TEXT`; null when any argument may be null. */
function sameText(args: MinabType[]): MinabType {
    const first = args[0];
    const base = first.kind === 'scalar' ? first.base : 'TEXT';
    return scalarType(base, { nullable: anyNullable(args) });
}

/** `INTEGER` stays `INTEGER`; `DECIMAL` (and a `null` argument) gives `DECIMAL`. */
const numberBase = (type: MinabType): 'INTEGER' | 'DECIMAL' => (type.kind === 'scalar' && type.base === 'INTEGER' ? 'INTEGER' : 'DECIMAL');

const text = (value: unknown): string => String(value);
const chars = (value: unknown): string[] => Array.from(text(value));
const ciText = (info: BuiltinArgInfo[]): boolean => info.some(i => i.citext);

/** SQL text of an argument, as `text` (a parameter has no type until it is cast). */
const asText = (a: SqlArg): string => `(${a.sql})::text`;
const asNumeric = (a: SqlArg): string => `(${a.sql})::numeric`;
const asInteger = (a: SqlArg): string => `(${a.sql})::integer`;

/** Case-insensitive comparison (a `CITEXT` side) lowers both sides. */
function textPair(args: SqlArg[]): [string, string] {
    const ci = args.some(a => a.citext);
    const [a, b] = [asText(args[0]), asText(args[1])];
    return ci ? [`lower(${a})`, `lower(${b})`] : [a, b];
}

function pair(args: unknown[], info: BuiltinArgInfo[]): [string, string] {
    const [a, b] = [text(args[0]), text(args[1])];
    return ciText(info) ? [a.toLowerCase(), b.toLowerCase()] : [a, b];
}

/** Both `ROUND` and the other number functions read a number as an exact value. */
function big(value: unknown): Big {
    return new Big(number(value));
}

const ROUND_HALF_UP = 1; // big.js: ties go away from zero

function toInteger(value: Big): number {
    return checkInteger(Number(value.toFixed(0)));
}

function floor(value: Big): Big {
    const down = value.round(0, 0);
    return value.lt(0) && !down.eq(value) ? down.minus(1) : down;
}

function ceil(value: Big): Big {
    const down = value.round(0, 0);
    return value.gt(0) && !down.eq(value) ? down.plus(1) : down;
}

function compare(a: unknown, b: unknown): number {
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    return compareNumbers(number(a), number(b));
}

function extreme(values: unknown[], sign: 1 | -1): unknown {
    let best: unknown = null;
    for (const value of values) {
        if (value === null || value === undefined) continue;
        if (best === null || compare(value, best) * sign > 0) best = value;
    }
    return best;
}

/** The one type of the arguments of `COALESCE`, `GREATEST`, `LEAST`: numbers may mix, `null` fits all. */
function commonType(name: string, args: MinabType[]): { ok: true; base: ScalarType | undefined } | ({ ok: false } & CodedMessage) {
    let common: ScalarType | undefined;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.kind !== 'scalar') continue;
        if (!common) {
            common = arg;
        } else if (baseTypesEqual(common, arg)) {
            common = scalarType(NUMERIC_BASES.has(common.base) ? widenNumeric(common.base, arg.base) : common.base);
        } else {
            return { ok: false, ...coded('call.argumentType', { name, position: i + 1, expected: formatType(common), actual: formatType(arg) }) };
        }
    }
    return { ok: true, base: common };
}

function common(name: string, nullableWhen: (args: MinabType[]) => boolean): Pick<BuiltinSignature, 'checkArgs' | 'returns'> {
    return {
        checkArgs: args => {
            const result = commonType(name, args);
            return result.ok ? undefined : result;
        },
        returns: args => {
            const result = commonType(name, args);
            if (!result.ok || !result.base) return NULL_TYPE;
            return scalarType(result.base.base, { nullable: nullableWhen(args) });
        }
    };
}

const SCALARS: BuiltinSignature[] = [
    {
        name: 'LOWER',
        kind: 'scalar',
        params: [TEXT],
        returns: sameText,
        evaluate: args => text(args[0]).toLowerCase(),
        sql: args => `lower(${asText(args[0])})`
    },
    {
        name: 'UPPER',
        kind: 'scalar',
        params: [TEXT],
        returns: sameText,
        evaluate: args => text(args[0]).toUpperCase(),
        sql: args => `upper(${asText(args[0])})`
    },
    {
        name: 'TRIM',
        kind: 'scalar',
        params: [TEXT],
        returns: sameText,
        evaluate: args => text(args[0]).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''),
        sql: args => `btrim(${asText(args[0])}, E' \\t\\r\\n')`
    },
    {
        name: 'LENGTH',
        kind: 'scalar',
        params: [TEXT],
        returns: args => scalarType('INTEGER', { nullable: anyNullable(args) }),
        evaluate: args => chars(args[0]).length,
        sql: args => `char_length(${asText(args[0])})`
    },
    {
        name: 'SUBSTRING',
        kind: 'scalar',
        params: [TEXT, INTEGER, { kind: 'integer', optional: true }],
        returns: sameText,
        // A `null` start or length gives `null` (the default rule); an omitted length reads to the end.
        evaluate: args => {
            const letters = chars(args[0]);
            const start = args[1] as number;
            if (args[2] === undefined) return letters.slice(Math.max(start, 1) - 1).join('');
            const length = args[2] as number;
            if (length < 0) throw new BuiltinError('negative substring length not allowed');
            return letters.slice(Math.max(start, 1) - 1, Math.max(start + length - 1, 0)).join('');
        },
        sql: args =>
            args[2]
                ? `substring(${asText(args[0])} from ${asInteger(args[1])} for ${asInteger(args[2])})`
                : `substring(${asText(args[0])} from ${asInteger(args[1])})`
    },
    {
        name: 'REPLACE',
        kind: 'scalar',
        params: [TEXT, TEXT, TEXT],
        returns: sameText,
        // Like Postgres, an empty search text changes nothing.
        evaluate: args => (text(args[1]) === '' ? text(args[0]) : text(args[0]).replaceAll(text(args[1]), text(args[2]))),
        sql: args => `replace(${asText(args[0])}, ${asText(args[1])}, ${asText(args[2])})`
    },
    {
        name: 'STARTS_WITH',
        kind: 'scalar',
        params: [TEXT, TEXT],
        returns: args => scalarType('BOOLEAN', { nullable: anyNullable(args) }),
        evaluate: (args, info) => {
            const [s, part] = pair(args, info);
            return s.startsWith(part);
        },
        sql: args => {
            const [s, part] = textPair(args);
            return `starts_with(${s}, ${part})`;
        }
    },
    {
        name: 'ENDS_WITH',
        kind: 'scalar',
        params: [TEXT, TEXT],
        returns: args => scalarType('BOOLEAN', { nullable: anyNullable(args) }),
        evaluate: (args, info) => {
            const [s, part] = pair(args, info);
            return s.endsWith(part);
        },
        // `starts_with` of the reversed texts: no `%` or `_` wildcard, and each text is written once.
        sql: args => {
            const [s, part] = textPair(args);
            return `starts_with(reverse(${s}), reverse(${part}))`;
        }
    },
    {
        name: 'CONTAINS',
        kind: 'scalar',
        params: [TEXT, TEXT],
        returns: args => scalarType('BOOLEAN', { nullable: anyNullable(args) }),
        evaluate: (args, info) => {
            const [s, part] = pair(args, info);
            return s.includes(part);
        },
        sql: args => {
            const [s, part] = textPair(args);
            return `(strpos(${s}, ${part}) > 0)`;
        }
    },
    {
        name: 'COALESCE',
        kind: 'scalar',
        params: [{ kind: 'scalar' }, { kind: 'scalar', rest: true }],
        nullPropagates: false,
        // Not null when any argument is not null-able: that one is the last resort.
        ...common('COALESCE', args => args.every(nullable)),
        evaluate: args => args.find(a => a !== null && a !== undefined) ?? null,
        sql: args => `COALESCE(${args.map(a => a.sql).join(', ')})`
    },
    {
        name: 'ROUND',
        kind: 'scalar',
        params: [{ kind: 'number' }, { kind: 'integer', optional: true }],
        returns: args => scalarType(numberBase(args[0]), { nullable: anyNullable(args) }),
        evaluate: args => {
            const rounded = big(args[0]).round(args[1] === undefined ? 0 : (args[1] as number), ROUND_HALF_UP);
            return isDecimal(args[0]) ? rounded : toInteger(rounded);
        },
        sql: args => (args[1] ? `round(${asNumeric(args[0])}, ${asInteger(args[1])})` : `round(${asNumeric(args[0])})`)
    },
    {
        name: 'ABS',
        kind: 'scalar',
        params: [{ kind: 'number' }],
        returns: args => scalarType(numberBase(args[0]), { nullable: anyNullable(args) }),
        evaluate: args => (isDecimal(args[0]) ? args[0].abs() : checkInteger(Math.abs(number(args[0]) as number))),
        sql: args => `abs(${asNumeric(args[0])})`
    },
    {
        name: 'FLOOR',
        kind: 'scalar',
        params: [{ kind: 'number' }],
        returns: args => scalarType('INTEGER', { nullable: anyNullable(args) }),
        evaluate: args => toInteger(floor(big(args[0]))),
        sql: args => `floor(${asNumeric(args[0])})::integer`
    },
    {
        name: 'CEIL',
        kind: 'scalar',
        params: [{ kind: 'number' }],
        returns: args => scalarType('INTEGER', { nullable: anyNullable(args) }),
        evaluate: args => toInteger(ceil(big(args[0]))),
        sql: args => `ceil(${asNumeric(args[0])})::integer`
    },
    {
        name: 'GREATEST',
        kind: 'scalar',
        params: [{ kind: 'orderable' }, { kind: 'orderable', rest: true }],
        nullPropagates: false,
        // Like Postgres, `null` arguments are ignored: the answer is `null` only when all are.
        ...common('GREATEST', args => args.every(nullable)),
        evaluate: args => extreme(args, 1),
        sql: args => `GREATEST(${args.map(a => a.sql).join(', ')})`
    },
    {
        name: 'LEAST',
        kind: 'scalar',
        params: [{ kind: 'orderable' }, { kind: 'orderable', rest: true }],
        nullPropagates: false,
        ...common('LEAST', args => args.every(nullable)),
        evaluate: args => extreme(args, -1),
        sql: args => `LEAST(${args.map(a => a.sql).join(', ')})`
    }
];

const BUILTINS: BuiltinSignature[] = [...AGGREGATES, ...SCALARS];

const BUILTINS_BY_NAME = new Map(BUILTINS.map(b => [b.name, b]));

export function getBuiltin(name: string): BuiltinSignature | undefined {
    return BUILTINS_BY_NAME.get(name);
}

export function isBuiltinName(name: string): boolean {
    return BUILTINS_BY_NAME.has(name);
}

export function builtinNames(): string[] {
    return BUILTINS.map(b => b.name);
}
