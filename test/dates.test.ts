/**
 * Production plan phase L6 — dates, times and time zones (decision D21).
 *
 * `test/differential/cases/l6-dates.cases.ts` proves that the interpreter and
 * Postgres give the same answers. This file checks the pieces on their own:
 * the calendar functions, the unit rule of the checker, the clock of a run,
 * and the SQL text (the clock is bound, never the database's `now()`).
 */

import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/host/config.js';
import {
    addDays,
    addMonths,
    civilFromDays,
    daysFromCivil,
    formatInstant,
    instantFromLocal,
    localFields,
    normalizeDateTime,
    parseInstant,
    wallMs
} from '../src/language/dates.js';
import { createMinab, type DataPort } from '../src/runtime/index.js';

const schema = parseConfig({
    schema: {
        tables: [
            {
                name: 'Invoice',
                primaryKey: 'id',
                columns: {
                    id: 'INTEGER',
                    due_date: 'DATE',
                    paid_at: 'DATETIME?',
                    opens: 'TIME',
                    day: 'DATE'
                }
            }
        ]
    }
}).schema;

const minab = createMinab({
    schema,
    ruleContext: { recordTable: 'Invoice', isFieldRule: false }
});
const clock = (now: string, timeZone: string) => ({
    now: () => new Date(now),
    timeZone
});
const AT = '2026-03-20T21:00:00Z';

async function value(source: string, now = AT, timeZone = 'UTC', record?: Record<string, unknown>): Promise<unknown> {
    const program = await minab.prepare(source);
    expect(program.diagnostics, source).toEqual([]);
    const result = await program.run({ record }, { clock: clock(now, timeZone) });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
}

describe('calendar functions', () => {
    test('days and civil dates convert both ways', () => {
        expect(daysFromCivil({ year: 1970, month: 1, day: 1 })).toBe(0);
        expect(daysFromCivil({ year: 2000, month: 3, day: 1 })).toBe(11017);
        for (const days of [-800000, -1, 0, 1, 59, 60, 11016, 11017, 20000, 2000000]) {
            expect(daysFromCivil(civilFromDays(days))).toBe(days);
        }
        expect(civilFromDays(11016)).toEqual({ year: 2000, month: 2, day: 29 });
    });

    test('month ends clamp, in both directions', () => {
        expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
            year: 2026,
            month: 2,
            day: 28
        });
        expect(addMonths({ year: 2028, month: 1, day: 31 }, 1)).toEqual({
            year: 2028,
            month: 2,
            day: 29
        });
        expect(addMonths({ year: 2026, month: 3, day: 31 }, -1)).toEqual({
            year: 2026,
            month: 2,
            day: 28
        });
        expect(addMonths({ year: 2026, month: 12, day: 15 }, 2)).toEqual({
            year: 2027,
            month: 2,
            day: 15
        });
        expect(addMonths({ year: 2026, month: 1, day: 15 }, -2)).toEqual({
            year: 2025,
            month: 11,
            day: 15
        });
        expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
            year: 2028,
            month: 2,
            day: 29
        });
    });

    test('a date time is read from ISO text, Postgres text and a Date', () => {
        const ms = Date.UTC(2026, 2, 20, 21, 0, 0);
        expect(parseInstant('2026-03-20T21:00:00Z')).toBe(ms);
        expect(parseInstant('2026-03-20 21:00:00+00')).toBe(ms);
        expect(parseInstant('2026-03-20 22:30:00+01:30')).toBe(ms);
        expect(parseInstant('2026-03-20T21:00:00')).toBe(ms); // no zone: UTC
        expect(parseInstant(new Date(ms))).toBe(ms);
        expect(parseInstant('2026-03-20T21:00:00.123456Z')).toBe(ms + 123);
        expect(normalizeDateTime('2026-03-20 21:00:00+00')).toBe('2026-03-20T21:00:00.000Z');
        expect(normalizeDateTime('not a date')).toBe('not a date');
        expect(() => parseInstant('2026-02-30T00:00:00Z')).toThrow();
    });

    test('a zone gives the wall-clock reading of an instant', () => {
        const ms = parseInstant('2026-03-20T21:00:00Z');
        expect(localFields(ms, 'Asia/Tehran')).toMatchObject({
            year: 2026,
            month: 3,
            day: 21,
            hour: 0,
            minute: 30
        });
        expect(localFields(ms, 'America/New_York')).toMatchObject({
            day: 20,
            hour: 17
        });
        expect(localFields(ms, 'UTC')).toMatchObject({ day: 20, hour: 21 });
        // Tehran has had no daylight saving since 2022: the offset is +03:30 in summer too.
        expect(localFields(parseInstant('2026-07-01T00:00:00Z'), 'Asia/Tehran')).toMatchObject({ hour: 3, minute: 30 });
    });

    test('a local time that does not exist, or exists twice, is read as standard time (like Postgres)', () => {
        const wall = (text: string) => wallMs({ ...localFields(parseInstant(`${text}Z`), 'UTC') });
        expect(formatInstant(instantFromLocal(wall('2026-03-29T02:30:00'), 'Europe/Berlin'))).toBe('2026-03-29T01:30:00.000Z');
        expect(formatInstant(instantFromLocal(wall('2026-10-25T02:30:00'), 'Europe/Berlin'))).toBe('2026-10-25T01:30:00.000Z');
        expect(formatInstant(instantFromLocal(wall('2026-03-08T02:30:00'), 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z');
        expect(formatInstant(instantFromLocal(wall('2026-11-01T01:30:00'), 'America/New_York'))).toBe('2026-11-01T06:30:00.000Z');
        expect(formatInstant(instantFromLocal(wall('2026-06-01T12:00:00'), 'Europe/Berlin'))).toBe('2026-06-01T10:00:00.000Z');
    });
});

describe('the clock of a run', () => {
    test('TODAY depends on the time zone', async () => {
        expect(await value('TODAY()', '2026-03-20T21:00:00Z', 'Asia/Tehran')).toBe('2026-03-21');
        expect(await value('TODAY()', '2026-03-20T21:00:00Z', 'UTC')).toBe('2026-03-20');
    });

    test('NOW is an ISO text in UTC, whatever the zone', async () => {
        expect(await value('NOW()', AT, 'Asia/Tehran')).toBe('2026-03-20T21:00:00.000Z');
    });

    test('NOW twice in one run is the same instant, though the clock moves', async () => {
        let reads = 0;
        const moving = {
            timeZone: 'UTC',
            now: () => new Date(Date.parse(AT) + 1000 * reads++)
        };
        const program = await minab.prepare('NOW() == NOW()');
        expect(await program.run({}, { clock: moving })).toMatchObject({ ok: true, value: true });
        expect(reads).toBe(1);
    });

    test('the examples of D21', async () => {
        const record = {
            due_date: '2026-03-01',
            paid_at: '2026-02-01T00:00:00Z',
            day: '2026-01-31'
        };
        expect(await value('.due_date < TODAY()', AT, 'UTC', record)).toBe(true);
        expect(await value('DATE_DIFF(TODAY(), .day, "day") > 30', AT, 'UTC', record)).toBe(true);
        expect(await value('DATE_ADD(.day, 1, "month")', AT, 'UTC', record)).toBe('2026-02-28');
        expect(await value('YEAR(.paid_at) == 2026', AT, 'UTC', record)).toBe(true);
    });

    test('a DATETIME from the database is compared as an instant', async () => {
        // Postgres prints a space and "+00"; NOW() is ISO text. Both are one kind of value after reading.
        const record = { paid_at: '2026-03-20 20:59:59+00' };
        expect(await value('.paid_at < NOW()', AT, 'UTC', record)).toBe(true);
        expect(await value('.paid_at < NOW()', '2026-03-20T20:59:59Z', 'UTC', record)).toBe(false);
    });

    test('TIME parts, and null', async () => {
        expect(
            await value('HOUR(.opens) * 100 + MINUTE(.opens)', AT, 'UTC', {
                opens: '08:30:00'
            })
        ).toBe(830);
        expect(await value('YEAR(.paid_at)', AT, 'UTC', { paid_at: null })).toBe(null);
    });

    test('CAST of a DATETIME to DATE uses the time zone of the run', async () => {
        const record = { paid_at: '2026-12-31T22:45:00Z' };
        expect(await value('CAST(.paid_at AS DATE)', AT, 'UTC', record)).toBe('2026-12-31');
        expect(await value('CAST(.paid_at AS DATE)', AT, 'Asia/Tehran', record)).toBe('2027-01-01');
        expect(await value('CAST(.paid_at AS TIME)', AT, 'Asia/Tehran', record)).toBe('02:15:00');
    });
});

describe('the SQL', () => {
    const sink = () => {
        const calls: { text: string; params: unknown[] }[] = [];
        const port: DataPort = {
            execute: query => {
                calls.push({ text: query.text, params: query.params });
                return Promise.resolve([{ id: 1 }]);
            }
        };
        return { port, calls };
    };

    test('NOW and TODAY are bound parameters: the text has no now()', async () => {
        const program = await minab.prepare('FROM Invoice WHERE .due_date < TODAY() AND .paid_at < NOW() SELECT .id AS id');
        expect(program.diagnostics).toEqual([]);
        const { port, calls } = sink();
        await program.run({}, { data: port, clock: clock(AT, 'Asia/Tehran') });
        expect(calls).toHaveLength(1);
        expect(calls[0].text).not.toMatch(/\bnow\s*\(/i);
        expect(calls[0].text).not.toMatch(/current_(date|timestamp)/i);
        expect(calls[0].params).toEqual(['2026-03-20T21:00:00.000Z', 'Asia/Tehran', '2026-03-20T21:00:00.000Z']);
        expect(calls[0].text).toContain('::timestamptz');
    });

    test('compile() without a run also binds the clock', async () => {
        const program = await minab.prepare('FROM Invoice SELECT TODAY() AS today');
        const compiled = program.compile();
        expect(compiled.ok).toBe(true);
        if (compiled.ok) {
            expect(compiled.sql.text).not.toMatch(/\bnow\s*\(/i);
            expect(compiled.sql.params).toHaveLength(2);
            expect(compiled.sql.params[1]).toBe('UTC');
        }
    });

    test('the unit is written into the SQL, not bound', async () => {
        const program = await minab.prepare('FROM Invoice SELECT DATE_ADD(.due_date, 3, "week") AS d');
        const compiled = program.compile();
        expect(compiled.ok).toBe(true);
        if (compiled.ok) {
            expect(compiled.sql.text).toContain('weeks =>');
            expect(compiled.sql.params).toEqual([3]);
        }
    });
});

describe('checks', () => {
    async function codes(source: string): Promise<string[]> {
        return (await minab.prepare(source)).diagnostics.map(d => d.code);
    }

    test('an unknown unit is call.unknownDateUnit', async () => {
        expect(await codes('DATE_ADD(.due_date, 1, "fortnight")')).toEqual(['call.unknownDateUnit']);
        expect(await codes('DATE_DIFF(.due_date, .due_date, "quarter")')).toEqual(['call.unknownDateUnit']);
    });

    test('hour, minute and second are for a DATETIME only', async () => {
        expect(await codes('DATE_ADD(.due_date, 1, "hour")')).toEqual(['call.unknownDateUnit']);
        expect(await codes('DATE_ADD(.paid_at, 1, "hour")')).toEqual([]);
    });

    test('the unit must be a text literal', async () => {
        expect(await codes('DATE_ADD(.due_date, 1, CAST("day" AS TEXT))')).toEqual(['call.unknownDateUnit']);
        expect(await codes('FROM Invoice SELECT DATE_ADD(.due_date, 1, "day") AS d')).toEqual([]);
    });

    test('types: a DATE and a DATETIME do not mix, there is no implicit coercion', async () => {
        expect(await codes('DATE_DIFF(.due_date, .paid_at, "day")')).toEqual(['call.argumentType']);
        expect(await codes('YEAR(.opens)')).toEqual(['call.argumentType']);
        expect(await codes('HOUR(.due_date)')).toEqual(['call.argumentType']);
        expect(await codes('DATE_ADD(.due_date, "1", "day")')).toEqual(['call.argumentType']);
        expect(await codes('NOW(1)')).toEqual(['call.wrongArgumentCount']);
    });

    test('result types', async () => {
        expect((await minab.prepare('NOW()')).resultType).toBe('DATETIME');
        expect((await minab.prepare('TODAY()')).resultType).toBe('DATE');
        expect((await minab.prepare('DATE_ADD(.due_date, 1, "day")')).resultType).toBe('DATE');
        expect((await minab.prepare('DATE_ADD(.paid_at, 1, "day")')).resultType).toBe('DATETIME?');
        expect((await minab.prepare('DATE_DIFF(.due_date, .due_date, "day")')).resultType).toBe('INTEGER');
        expect((await minab.prepare('YEAR(.paid_at)')).resultType).toBe('INTEGER?');
    });
});
