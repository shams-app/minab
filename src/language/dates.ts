/**
 * Calendar and time zone helpers for the date built-ins (production plan L6,
 * decision D21, spec §5.3.1 and §7.2).
 *
 * How the interpreter holds the date types:
 * - `DATE` is a text `"YYYY-MM-DD"`. It has no time zone.
 * - `TIME` is a text `"HH:MM:SS"`, with an optional fraction.
 * - `DATETIME` is an instant. It is held as an ISO 8601 UTC text with
 *   milliseconds (`"2026-10-02T08:30:00.000Z"`), which sorts like time.
 *
 * Date-only math uses pure calendar functions (days from a civil date and back).
 * Nothing here calls `new Date(...)` with a local time, so the machine's time
 * zone never matters. A `DATETIME` is read in the run's time zone with
 * `Intl.DateTimeFormat`, which knows the offset of each instant, so
 * daylight-saving changes are handled.
 *
 * Every rule follows Postgres, so the interpreter and the compiled SQL agree:
 * month ends clamp (Jan 31 + 1 month is Feb 28 or 29), and a local time that does
 * not exist, or exists twice, is read as standard time.
 */

/** A problem in a date value or a date calculation. The built-in turns it into an evaluation error. */
export class DateError extends Error {}

export const DATE_UNITS = ['year', 'month', 'week', 'day'] as const;
export const DATETIME_UNITS = [...DATE_UNITS, 'hour', 'minute', 'second'] as const;
export type DateUnit = (typeof DATETIME_UNITS)[number];

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

export interface CivilDate {
    year: number;
    month: number;
    day: number;
}

/** A wall-clock reading: a civil date, and the time of day in milliseconds. */
export interface LocalDateTime extends CivilDate {
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

// ---- civil dates ---------------------------------------------------------

/** Days since 1970-01-01 of a civil date (proleptic Gregorian). */
export function daysFromCivil({ year, month, day }: CivilDate): number {
    const y = month <= 2 ? year - 1 : year;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146_097 + doe - 719_468;
}

/** The civil date of a day count since 1970-01-01. */
export function civilFromDays(days: number): CivilDate {
    const z = days + 719_468;
    const era = Math.floor(z / 146_097);
    const doe = z - era * 146_097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function checkYear(date: CivilDate): CivilDate {
    if (date.year < MIN_YEAR || date.year > MAX_YEAR) throw new DateError('date out of range');
    return date;
}

/** A date `months` months later. A day that does not exist in the new month moves to the month's last day. */
export function addMonths(date: CivilDate, months: number): CivilDate {
    const index = date.year * 12 + (date.month - 1) + months;
    const year = Math.floor(index / 12);
    const month = index - year * 12 + 1;
    return checkYear({
        year,
        month,
        day: Math.min(date.day, daysInMonth(year, month))
    });
}

export function addDays(date: CivilDate, days: number): CivilDate {
    return checkYear(civilFromDays(daysFromCivil(date) + days));
}

export function formatDate({ year, month, day }: CivilDate): string {
    return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reads a `DATE` value: a `"YYYY-MM-DD"` text, or a `Date` (read as its UTC date, for a driver that returns one). */
export function parseDate(value: unknown): CivilDate {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new DateError('invalid date');
        return {
            year: value.getUTCFullYear(),
            month: value.getUTCMonth() + 1,
            day: value.getUTCDate()
        };
    }
    const m = typeof value === 'string' ? DATE_TEXT.exec(value.trim()) : null;
    if (!m) throw new DateError(`invalid DATE value ${JSON.stringify(value)}`);
    const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
        throw new DateError(`invalid DATE value ${JSON.stringify(value)}`);
    }
    return date;
}

// ---- time of day ---------------------------------------------------------

const TIME_TEXT = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;

/** The hour and the minute of a `TIME` value. */
export function parseTime(value: unknown): { hour: number; minute: number } {
    const m = typeof value === 'string' ? TIME_TEXT.exec(value.trim()) : null;
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new DateError(`invalid TIME value ${JSON.stringify(value)}`);
    return { hour: Number(m[1]), minute: Number(m[2]) };
}

// ---- instants ------------------------------------------------------------

const DATETIME_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/**
 * Reads a `DATETIME` value as milliseconds since 1970 (UTC). It takes an ISO 8601
 * text or the text Postgres prints (`2026-03-20 21:00:00+00`), or a `Date`.
 * A text without a zone is read as UTC.
 */
export function parseInstant(value: unknown): number {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new DateError('invalid date');
        return value.getTime();
    }
    const m = typeof value === 'string' ? DATETIME_TEXT.exec(value.trim()) : null;
    const bad = () => new DateError(`invalid DATETIME value ${JSON.stringify(value)}`);
    if (!m) throw bad();
    const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) throw bad();
    const [hour, minute, second] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
    if (hour > 23 || minute > 59 || second > 59) throw bad();
    const millisecond = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
    let offset = 0;
    if (m[8] && m[8].toUpperCase() !== 'Z') {
        const sign = m[8][0] === '-' ? -1 : 1;
        const digits = m[8].slice(1).replace(':', '');
        offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || 0)) * 60_000;
    }
    return daysFromCivil(date) * MS_PER_DAY + ((hour * 60 + minute) * 60 + second) * MS_PER_SECOND + millisecond - offset;
}

/** The canonical text of an instant: ISO 8601, UTC, with milliseconds. */
export function formatInstant(ms: number): string {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < MIN_YEAR || date.getUTCFullYear() > MAX_YEAR) throw new DateError('date out of range');
    return date.toISOString();
}

/** A `DATETIME` value (any form it can arrive in) as the canonical text. A value that is not a date time is returned as it is. */
export function normalizeDateTime(value: unknown): unknown {
    try {
        return formatInstant(parseInstant(value));
    } catch {
        return value;
    }
}

// ---- time zones ----------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
    let format = formatters.get(zone);
    if (!format) {
        format = new Intl.DateTimeFormat('en-US', {
            timeZone: zone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        });
        formatters.set(zone, format);
    }
    return format;
}

const isUtc = (zone: string) => zone === 'UTC' || zone === 'Etc/UTC';

/** The wall-clock reading of an instant in a time zone (an IANA name such as `Asia/Tehran`). */
export function localFields(ms: number, zone: string): LocalDateTime {
    const millisecond = ((ms % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND;
    if (isUtc(zone)) {
        const d = new Date(ms);
        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            hour: d.getUTCHours(),
            minute: d.getUTCMinutes(),
            second: d.getUTCSeconds(),
            millisecond
        };
    }
    const parts: Record<string, number> = {};
    for (const part of formatterFor(zone).formatToParts(new Date(ms))) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
        millisecond
    };
}

/** The wall-clock reading as milliseconds, as if it were UTC. Differences of these are wall-clock differences. */
export function wallMs(local: LocalDateTime): number {
    return daysFromCivil(local) * MS_PER_DAY + ((local.hour * 60 + local.minute) * 60 + local.second) * MS_PER_SECOND + local.millisecond;
}

const offsetMs = (ms: number, zone: string): number => wallMs(localFields(ms, zone)) - ms;

/**
 * The instant of a wall-clock reading in a time zone. Like Postgres: a time that
 * exists twice (clocks go back) is read as the later one, standard time; a time
 * that does not exist (clocks go forward) is read with the offset from before the
 * change, so it lands after the gap.
 */
export function instantFromLocal(wall: number, zone: string): number {
    if (isUtc(zone)) return wall;
    const before = offsetMs(wall - MS_PER_DAY, zone);
    const after = offsetMs(wall + MS_PER_DAY, zone);
    const valid = [before, after].filter((offset, i, all) => all.indexOf(offset) === i && offsetMs(wall - offset, zone) === offset);
    if (valid.length === 0) return wall - before;
    return wall - Math.min(...valid);
}

// ---- the functions -------------------------------------------------------

/** The date of an instant in a time zone. */
export function dateOf(ms: number, zone: string): string {
    return formatDate(localFields(ms, zone));
}

/** `TIME` text of a `DATETIME` in a zone (a fraction has no trailing zeros, as Postgres prints it). */
export function timeOf(ms: number, zone: string): string {
    const local = localFields(ms, zone);
    const base = `${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}`;
    const fraction = pad(local.millisecond, 3).replace(/0+$/, '');
    return fraction ? `${base}.${fraction}` : base;
}

/** `DATE_ADD` for a `DATE`. */
export function addToDate(value: unknown, amount: number, unit: DateUnit): string {
    const date = parseDate(value);
    switch (unit) {
        case 'year':
            return formatDate(addMonths(date, amount * 12));
        case 'month':
            return formatDate(addMonths(date, amount));
        case 'week':
            return formatDate(addDays(date, amount * 7));
        case 'day':
            return formatDate(addDays(date, amount));
        default:
            throw new DateError(`unit "${unit}" does not apply to a DATE`);
    }
}

/**
 * `DATE_ADD` for a `DATETIME`. Years, months, weeks and days move the wall-clock date
 * and keep the wall-clock time (so one day across a daylight-saving change is still the
 * same time of day). Hours, minutes and seconds move the instant.
 */
export function addToDateTime(value: unknown, amount: number, unit: DateUnit, zone: string): string {
    const ms = parseInstant(value);
    const clock = unit === 'hour' ? 3_600_000 : unit === 'minute' ? 60_000 : unit === 'second' ? MS_PER_SECOND : 0;
    if (clock) return formatInstant(ms + amount * clock);
    const local = localFields(ms, zone);
    const moved: CivilDate =
        unit === 'year' ? addMonths(local, amount * 12) : unit === 'month' ? addMonths(local, amount) : addDays(local, unit === 'week' ? amount * 7 : amount);
    return formatInstant(instantFromLocal(wallMs({ ...local, ...moved }), zone));
}

/** Whole months from `b` to `a`, truncated toward zero. `rest` is the part of the month already passed. */
function wholeMonths(a: LocalDateTime, b: LocalDateTime): number {
    const months = a.year * 12 + a.month - (b.year * 12 + b.month);
    const restOf = (x: LocalDateTime) => wallMs(x) - wallMs({ ...x, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 });
    if (months > 0 && restOf(a) < restOf(b)) return months - 1;
    if (months < 0 && restOf(a) > restOf(b)) return months + 1;
    return months;
}

/** Whole `unit`s from `b` to `a`, truncated toward zero. Never returns -0. */
function truncate(value: number): number {
    return Math.trunc(value) || 0;
}

/** `DATE_DIFF` for two `DATE` values. */
export function diffDates(a: unknown, b: unknown, unit: DateUnit): number {
    const [x, y] = [parseDate(a), parseDate(b)];
    const days = daysFromCivil(x) - daysFromCivil(y);
    switch (unit) {
        case 'day':
            return days;
        case 'week':
            return truncate(days / 7);
        case 'month':
        case 'year': {
            const at = (d: CivilDate): LocalDateTime => ({
                ...d,
                hour: 0,
                minute: 0,
                second: 0,
                millisecond: 0
            });
            const months = wholeMonths(at(x), at(y));
            return unit === 'month' ? months : truncate(months / 12);
        }
        default:
            throw new DateError(`unit "${unit}" does not apply to a DATE`);
    }
}

/**
 * `DATE_DIFF` for two `DATETIME` values. Hours, minutes and seconds count real time.
 * Days, weeks, months and years count wall-clock time in the run's zone.
 */
export function diffDateTimes(a: unknown, b: unknown, unit: DateUnit, zone: string): number {
    const [x, y] = [parseInstant(a), parseInstant(b)];
    switch (unit) {
        case 'second':
            return truncate((x - y) / MS_PER_SECOND);
        case 'minute':
            return truncate((x - y) / 60_000);
        case 'hour':
            return truncate((x - y) / 3_600_000);
        case 'day':
        case 'week': {
            const wall = wallMs(localFields(x, zone)) - wallMs(localFields(y, zone));
            return truncate(wall / (unit === 'week' ? 7 * MS_PER_DAY : MS_PER_DAY));
        }
        case 'month':
        case 'year': {
            const months = wholeMonths(localFields(x, zone), localFields(y, zone));
            return unit === 'month' ? months : truncate(months / 12);
        }
    }
}
