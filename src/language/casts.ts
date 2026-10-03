/**
 * `CAST` in the interpreter (production plan C3, decision D16, spec §5.5).
 *
 * Every rule here follows Postgres, so a cast gives the same answer in the
 * interpreter and in the compiled SQL. A value that cannot convert throws a
 * `NumberError` with the code `eval.castFailed`.
 *
 * Values: `INTEGER` is a number, `DECIMAL` is a `Big`, `TEXT`/`CITEXT`/`UUID` and the
 * date types are strings (as the database driver sends them), `BOOLEAN` is a boolean,
 * `JSON` is any JSON value.
 *
 * Date text forms, as Postgres prints them:
 *  - `DATE`: `2026-10-02`
 *  - `TIME`: `08:30:00` (a fraction has no trailing zeros: `08:30:00.5`)
 *  - `DATETIME`: `2026-10-02 08:30:00` (no time zone)
 */

import { DateError, dateOf, formatInstant, instantFromLocal, parseInstant, timeOf } from './dates.js';
import { coded } from './diagnostics/codes.js';
import type { LogicalTypeBase } from './minab-types.js';
import { Big, NumberError, checkInteger, decimalText, toBig } from './values.js';

export interface CastTarget {
    base: LogicalTypeBase;
    array?: boolean;
}

type Kind = LogicalTypeBase;

/** The words Postgres reads as a boolean (any case, and the short forms it accepts). */
const TRUE_WORDS = new Set(['t', 'tr', 'tru', 'true', 'y', 'ye', 'yes', 'on', '1']);
const FALSE_WORDS = new Set(['f', 'fa', 'fal', 'fals', 'false', 'n', 'no', 'of', 'off', '0']);

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER_TEXT = /^[+-]?\d+$/;
const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const DATE_PART = '(\\d{4})-(\\d{2})-(\\d{2})';
const TIME_PART = '(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,6}))?)?';
const ZONE_PART = '(?:Z|[+-]\\d{2}(?::?\\d{2})?)?';
const DATE_TEXT = new RegExp(`^${DATE_PART}$`);
const TIME_TEXT = new RegExp(`^${TIME_PART}${ZONE_PART}$`, 'i');
const DATETIME_TEXT = new RegExp(`^${DATE_PART}(?:[T ]${TIME_PART}${ZONE_PART})?$`, 'i');

function show(value: unknown): string {
    const text = value instanceof Big ? decimalText(value) : JSON.stringify(value);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function castFailed(value: unknown, from: Kind, to: Kind): NumberError {
    const { code, reason, params } = coded('eval.castFailed', {
        value: show(value),
        from,
        to
    });
    const error = new NumberError(reason, code);
    Object.assign(error.params, params);
    return error;
}

/** The kind a value has, for choosing the rule. `staticBase` is the type the checker inferred. */
function kindOf(value: unknown, staticBase: LogicalTypeBase | undefined): Kind {
    if (staticBase === 'JSON') return 'JSON';
    if (value instanceof Big) return 'DECIMAL';
    if (typeof value === 'number') return 'INTEGER';
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (value instanceof Date) return staticBase === 'DATE' || staticBase === 'TIME' ? staticBase : 'DATETIME';
    if (typeof value === 'string') {
        if (staticBase === 'DATE' || staticBase === 'TIME' || staticBase === 'DATETIME' || staticBase === 'UUID') return staticBase;
        return 'TEXT';
    }
    return 'JSON';
}

function validDate(year: number, month: number, day: number): boolean {
    const d = new Date(Date.UTC(year, month - 1, day));
    return year >= 1 && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const pad = (n: string | number) => String(n).padStart(2, '0');

function timeText(h: string, m: string, s: string | undefined, fraction: string | undefined): string | undefined {
    if (Number(h) > 23 || Number(m) > 59 || Number(s ?? 0) > 59) return undefined;
    const base = `${pad(h)}:${pad(m)}:${pad(s ?? '0')}`;
    const f = fraction?.replace(/0+$/, '');
    return f ? `${base}.${f}` : base;
}

function parseDate(text: string): string | undefined {
    const m = DATE_TEXT.exec(text);
    return m && validDate(Number(m[1]), Number(m[2]), Number(m[3])) ? text : undefined;
}

function parseTime(text: string): string | undefined {
    const m = TIME_TEXT.exec(text);
    return m ? timeText(m[1], m[2], m[3], m[4]) : undefined;
}

/** `[date, time]`, both as normalized text. A date alone is midnight. */
function parseDateTime(text: string): [string, string] | undefined {
    const m = DATETIME_TEXT.exec(text);
    if (!m || !validDate(Number(m[1]), Number(m[2]), Number(m[3]))) return undefined;
    const time = m[4] === undefined ? '00:00:00' : timeText(m[4], m[5], m[6], m[7]);
    return time === undefined ? undefined : [`${m[1]}-${m[2]}-${m[3]}`, time];
}

/** A host `Date` is read as the UTC date and time it holds. */
function dateText(value: unknown): unknown {
    return value instanceof Date ? value.toISOString() : value;
}

const HAS_ZONE = /\d:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

const failWith = (fail: () => Error): never => {
    throw fail();
};

/**
 * A `DATETIME` from text or from a `DATE` (D21): an instant, as ISO 8601 UTC text. A zone in the text
 * is used. Without one, the text is a wall-clock time in the run's time zone, and a date alone is
 * midnight there. A `DATETIME` is already an instant.
 */
function toInstant(text: string, from: Kind, zone: string): string | undefined {
    if (from === 'DATETIME') return normalizedInstant(text);
    const parts = parseDateTime(text);
    if (!parts) return undefined;
    if (from === 'TEXT' && HAS_ZONE.test(text)) return normalizedInstant(text);
    const wall = parseInstant(`${parts[0]}T${parts[1]}Z`); // the wall-clock reading, as if UTC
    try {
        return formatInstant(instantFromLocal(wall, zone));
    } catch (e) {
        if (e instanceof DateError) return undefined;
        throw e;
    }
}

function normalizedInstant(text: string): string | undefined {
    try {
        return formatInstant(parseInstant(text));
    } catch (e) {
        if (e instanceof DateError) return undefined;
        throw e;
    }
}

/** The date or the time of a `DATETIME` text, read in the run's time zone (D21). `undefined` when the text is not a date time. */
function inZone(text: string, zone: string, part: (ms: number, zone: string) => string): string | undefined {
    try {
        return part(parseInstant(text), zone);
    } catch (e) {
        if (e instanceof DateError) return undefined;
        throw e;
    }
}

function toInteger(value: Big, from: Kind, original: unknown): number {
    try {
        return checkInteger(Number(value.round(0, Big.roundHalfUp).toFixed()));
    } catch {
        throw castFailed(original, from, 'INTEGER');
    }
}

function castOne(value: unknown, from: Kind, to: Kind, zone: string): unknown {
    const fail = () => castFailed(value, from, to);
    const text = typeof dateText(value) === 'string' ? (dateText(value) as string) : undefined;
    switch (to) {
        case 'TEXT':
        case 'CITEXT':
            if (from === 'DECIMAL') return decimalText(value as Big);
            if (from === 'INTEGER') return String(value);
            if (from === 'BOOLEAN') return String(value);
            if (from === 'JSON') throw fail();
            if (from === 'DATETIME') {
                const parts = text === undefined ? undefined : parseDateTime(text);
                if (!parts) throw fail();
                return parts.join(' ');
            }
            if (text === undefined) throw fail();
            return text;
        case 'INTEGER': {
            if (from === 'INTEGER') return value;
            if (from === 'DECIMAL') return toInteger(value as Big, from, value);
            if (from === 'BOOLEAN') return value ? 1 : 0;
            if (from === 'JSON' && (typeof value === 'number' || value instanceof Big)) return toInteger(new Big(value), from, value);
            if (from === 'TEXT' && text !== undefined) {
                const trimmed = text.trim();
                if (INTEGER_TEXT.test(trimmed)) {
                    try {
                        return checkInteger(Number(trimmed));
                    } catch {
                        throw fail();
                    }
                }
            }
            throw fail();
        }
        case 'DECIMAL': {
            if (from === 'DECIMAL') return value;
            if (from === 'INTEGER') return new Big(value as number);
            if (from === 'JSON' && typeof value === 'number') return toBig(value);
            if (from === 'TEXT' && text !== undefined && DECIMAL_TEXT.test(text.trim())) return new Big(text.trim());
            throw fail();
        }
        case 'BOOLEAN': {
            if (from === 'BOOLEAN') return value;
            if (from === 'JSON' && typeof value === 'boolean') return value;
            if (from === 'TEXT' && text !== undefined) {
                const word = text.trim().toLowerCase();
                if (TRUE_WORDS.has(word)) return true;
                if (FALSE_WORDS.has(word)) return false;
            }
            throw fail();
        }
        case 'UUID': {
            if ((from === 'TEXT' || from === 'UUID') && text !== undefined && UUID_TEXT.test(text.trim())) return text.trim().toLowerCase();
            throw fail();
        }
        case 'DATE': {
            if (text === undefined) throw fail();
            const date =
                from === 'DATE' || from === 'TEXT'
                    ? parseDate(from === 'TEXT' ? text.trim() : text)
                    : from === 'DATETIME'
                      ? inZone(text, zone, dateOf)
                      : undefined;
            if (date === undefined) throw fail();
            return date;
        }
        case 'TIME': {
            if (text === undefined) throw fail();
            const time = from === 'TIME' || from === 'TEXT' ? parseTime(text.trim()) : from === 'DATETIME' ? inZone(text, zone, timeOf) : undefined;
            if (time === undefined) throw fail();
            return time;
        }
        case 'DATETIME': {
            if (text === undefined || (from !== 'TEXT' && from !== 'DATE' && from !== 'DATETIME')) throw fail();
            return toInstant(text.trim(), from, zone) ?? failWith(fail);
        }
        case 'JSON': {
            if (from === 'JSON') return value;
            if (from === 'TEXT' && text !== undefined) {
                try {
                    return JSON.parse(text);
                } catch {
                    throw fail();
                }
            }
            throw fail();
        }
    }
}

/**
 * Converts a value to the target type. `null` stays `null`. `staticBase` is the type the
 * checker inferred for the operand (it tells a `JSON` string from a `TEXT` value).
 * `zone` is the run's time zone: a `DATETIME` is read in it when it becomes a `DATE` or a `TIME`.
 * Throws `NumberError` (`eval.castFailed`) when the value cannot convert.
 */
export function castValue(value: unknown, target: CastTarget, staticBase?: LogicalTypeBase, staticArray = false, zone = 'UTC'): unknown {
    if (value === null || value === undefined) return null;
    if (staticBase === 'JSON' && target.base === 'JSON' && !!target.array === staticArray) return value;
    if (Array.isArray(value) && staticBase !== 'JSON') {
        if (!target.array) throw castFailed(value, kindOf(value[0], staticBase), target.base);
        return value.map(item => (item === null ? null : castOne(item, kindOf(item, staticBase), target.base, zone)));
    }
    if (target.array) {
        if (staticBase === 'JSON' && Array.isArray(value)) throw castFailed(value, 'JSON', target.base);
        throw castFailed(value, kindOf(value, staticBase), target.base);
    }
    return castOne(value, kindOf(value, staticBase), target.base, zone);
}
