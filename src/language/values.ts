/**
 * Number values inside the interpreter (production plan C2, decision D17).
 *
 * - An `INTEGER` is a JavaScript number in the safe range (±9,007,199,254,740,991).
 * - A `DECIMAL` is a `Big` (from big.js), so its arithmetic is exact, as in Postgres.
 * - A value leaves the interpreter with `externalize`: a `Big` becomes a string in its
 *   shortest exact form ("0.3", "170"). An `INTEGER` stays a number.
 *
 * Functions here throw `NumberError`. The interpreter turns it into an evaluation error.
 */

import Big from 'big.js';
import { normalizeDateTime } from './dates.js';
import { coded } from './diagnostics/codes.js';
import type { LogicalTypeBase } from './minab-types.js';

export { Big };

/** A number problem. `code` is the stable code, when the problem has one. */
export class NumberError extends Error {
    readonly params: Record<string, string | number> = {};

    constructor(
        message: string,
        readonly code?: string
    ) {
        super(message);
    }
}

export const MAX_INTEGER = Number.MAX_SAFE_INTEGER;

export type Numeric = number | Big;

export function integerOutOfRange(): NumberError {
    const { code, reason } = coded('eval.integerOutOfRange');
    return new NumberError(reason, code);
}

/** An `INTEGER` result must be a whole number in the safe range. */
export function checkInteger(value: number): number {
    if (!Number.isSafeInteger(value)) throw integerOutOfRange();
    return value;
}

/** A number literal: text with a fraction is a `DECIMAL`, text without one is an `INTEGER`. */
export function literal(text: string): Numeric {
    if (text.includes('.')) return new Big(text);
    return checkInteger(Number(text));
}

const NUMBER_TEXT = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/**
 * Reads a value as a number: a number, a `Big`, a `bigint`, or text that is a number
 * (Postgres sends `numeric` as text). Text and numbers with a fraction become a `Big`;
 * a whole number stays an `INTEGER`. Anything else gives `undefined`.
 */
export function toNumeric(value: unknown): Numeric | undefined {
    if (value instanceof Big) return value;
    if (typeof value === 'number') {
        if (Number.isNaN(value) || !Number.isFinite(value)) return undefined;
        return Number.isInteger(value) ? checkInteger(value) : new Big(value);
    }
    if (typeof value === 'bigint') return fromBigint(value);
    if (typeof value === 'string' && NUMBER_TEXT.test(value)) {
        const text = value.trim();
        return /^[+-]?\d+$/.test(text) ? checkInteger(Number(text)) : new Big(text);
    }
    return undefined;
}

function fromBigint(value: bigint): number {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw integerOutOfRange();
    return n;
}

/** Reads a value as a `Big`, whatever its kind. `undefined` when it is not a number. */
export function toBig(value: unknown): Big | undefined {
    const n = toNumeric(value);
    return n === undefined ? undefined : new Big(n);
}

/** True when the value is a `Big`. */
export function isDecimal(value: unknown): value is Big {
    return value instanceof Big;
}

/** True when the value is a `Big`, or a number or text that must be compared as one. */
function exactPair(a: unknown, b: unknown): [Big, Big] | undefined {
    if (!(a instanceof Big) && !(b instanceof Big)) return undefined;
    const x = toBig(a);
    const y = toBig(b);
    return x && y ? [x, y] : undefined;
}

/** Exact equality when either side is a `Big`. `undefined` means "not a decimal comparison". */
export function decimalEqual(a: unknown, b: unknown): boolean | undefined {
    const pair = exactPair(a, b);
    return pair ? pair[0].eq(pair[1]) : undefined;
}

/** Exact ordering when either side is a `Big`: -1, 0 or 1. `undefined` means "not a decimal comparison". */
export function decimalCompare(a: unknown, b: unknown): number | undefined {
    const pair = exactPair(a, b);
    return pair ? pair[0].cmp(pair[1]) : undefined;
}

/** The error of `/` and `%` by zero. */
export function divisionByZero(): NumberError {
    const { code, reason } = coded('eval.divisionByZero');
    return new NumberError(reason, code);
}

/** `/` gives 16 digits after the point, rounded half away from zero (D14). Same digits as the SQL form. */
const Quotient = Big();
Quotient.DP = 16;
Quotient.RM = 1;

export type Arithmetic = '+' | '-' | '*' | '/' | '%';

/**
 * One arithmetic step. `INTEGER` with `INTEGER` stays an `INTEGER` (range checked for
 * `+`, `-`, `*`). Any `DECIMAL` makes the result a `DECIMAL`.
 * `/` is always a `DECIMAL` (16 digits after the point, half away from zero). `%` has the
 * sign of its left side. Both throw `eval.divisionByZero` when the right side is zero.
 */
export function arithmetic(operator: Arithmetic, a: Numeric, b: Numeric): Numeric {
    if (typeof a === 'number' && typeof b === 'number') {
        switch (operator) {
            case '+':
                return checkInteger(a + b);
            case '-':
                return checkInteger(a - b);
            case '*':
                return checkInteger(a * b);
            case '/':
                if (b === 0) throw divisionByZero();
                return new Quotient(a).div(b);
            case '%':
                if (b === 0) throw divisionByZero();
                return a % b;
        }
    }
    const x = new Big(a);
    const y = new Big(b);
    switch (operator) {
        case '+':
            return x.plus(y);
        case '-':
            return x.minus(y);
        case '*':
            return x.times(y);
        case '/':
            if (y.eq(0)) throw divisionByZero();
            return new Quotient(x).div(y);
        case '%':
            if (y.eq(0)) throw divisionByZero();
            return x.mod(y);
    }
}

export function negate(value: Numeric): Numeric {
    return typeof value === 'number' ? checkInteger(-value) : value.times(-1);
}

/** The shortest exact text of a `Big`: no exponent, no trailing zeros. */
export function decimalText(value: Big): string {
    const text = value.toFixed();
    return text === '-0' ? '0' : text;
}

/**
 * What a result looks like outside the interpreter: every `Big` becomes its text.
 * Lists and records are walked. A value with no `Big` inside is returned as it is (same object).
 */
export function externalize(value: unknown): unknown {
    if (value instanceof Big) return decimalText(value);
    if (Array.isArray(value)) {
        const items = value.map(externalize);
        return items.some((item, i) => item !== value[i]) ? items : value;
    }
    if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
        const entries = Object.entries(value);
        const mapped = entries.map(([key, item]) => [key, externalize(item)] as const);
        return mapped.some(([, item], i) => item !== entries[i][1]) ? Object.fromEntries(mapped) : value;
    }
    return value;
}

/** A value as a SQL parameter: a `Big` is bound as text, which Postgres reads exactly. */
export function sqlParameter(value: unknown): unknown {
    return value instanceof Big ? decimalText(value) : value;
}

/** A value that goes into a `JSON` value: decimals become JSON numbers (normal JSON behavior). */
export function jsonNumber(value: unknown): unknown {
    return value instanceof Big ? Number(value.toString()) : value;
}

/**
 * Normalizes a value that came in from the outside (a row of the data port, the record
 * under validation) by the type of its column. `DECIMAL` becomes a `Big`;
 * `INTEGER` given as text or `bigint` becomes a number (or the range error).
 * `null` and other types are left alone.
 */
export function normalizeIn(value: unknown, base: LogicalTypeBase, array = false): unknown {
    if (value === null || value === undefined) return value;
    if (array) return Array.isArray(value) ? value.map(item => normalizeIn(item, base)) : value;
    if (base === 'DECIMAL') {
        const parsed = typeof value === 'bigint' ? new Big(value.toString()) : toBigStrict(value);
        return parsed ?? value;
    }
    // A `DATETIME` is an instant. It is held as an ISO 8601 UTC text, which sorts like time (D21).
    if (base === 'DATETIME') return normalizeDateTime(value);
    if (base === 'INTEGER') {
        if (typeof value === 'bigint') return fromBigint(value);
        if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) return checkInteger(Number(value));
        if (typeof value === 'number' && Number.isInteger(value)) return checkInteger(value);
    }
    return value;
}

function toBigStrict(value: unknown): Big | undefined {
    if (value instanceof Big) return value;
    if (typeof value === 'number') return Number.isFinite(value) ? new Big(value) : undefined;
    if (typeof value === 'string' && NUMBER_TEXT.test(value)) return new Big(value.trim());
    return undefined;
}
