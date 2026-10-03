import type { DifferentialCase } from '../harness.js';
import type { TestClock } from '../../support/minab.js';

/**
 * L6, D21: dates, times and time zones. The clock is fixed, so both runtimes
 * see the same instant. Each case runs in the interpreter and in Postgres.
 */

const schema = {
    tables: [
        {
            name: 'Item',
            primaryKey: 'id',
            columns: {
                id: 'INTEGER',
                d: 'DATE',
                e: 'DATE',
                dn: 'DATE?',
                t: 'TIME',
                ts: 'DATETIME',
                ts2: 'DATETIME',
                tn: 'DATETIME?',
                n: 'INTEGER'
            }
        }
    ]
};

const at = (now: string, timeZone: string): TestClock => ({ now, timeZone });
const UTC = at('2026-03-20T21:00:00Z', 'UTC');
const TEHRAN = at('2026-03-20T21:00:00Z', 'Asia/Tehran');
const BERLIN = at('2026-03-20T21:00:00Z', 'Europe/Berlin');
const NEW_YORK = at('2026-03-20T21:00:00Z', 'America/New_York');
const ZONES: [string, TestClock][] = [
    ['UTC', UTC],
    ['Asia/Tehran', TEHRAN],
    ['Europe/Berlin', BERLIN],
    ['America/New_York', NEW_YORK]
];

function make(name: string, record: Record<string, unknown>, expr: string, expect: unknown, clock: TestClock = UTC): DifferentialCase {
    return { name, schema, record: { id: 1, ...record }, expr, expect, clock };
}

// ---- NOW and TODAY ---------------------------------------------------------

const clockCases: DifferentialCase[] = [
    make('TODAY at 21:00Z is 2026-03-20 in UTC', {}, 'TODAY()', '2026-03-20', UTC),
    make('TODAY at 21:00Z is 2026-03-21 in Asia/Tehran', {}, 'TODAY()', '2026-03-21', TEHRAN),
    make('TODAY in Berlin (before the spring change)', {}, 'TODAY()', '2026-03-20', BERLIN),
    make('TODAY in New York', {}, 'TODAY()', '2026-03-20', NEW_YORK),
    make('TODAY just after midnight in Berlin during summer time', {}, 'TODAY()', '2026-06-02', at('2026-06-01T22:00:00Z', 'Europe/Berlin')),
    make('NOW is the instant of the run', {}, 'NOW()', '2026-03-20T21:00:00.000Z', TEHRAN),
    make('NOW keeps milliseconds', {}, 'NOW()', '2026-03-20T21:00:00.123Z', at('2026-03-20T21:00:00.123Z', 'UTC')),
    make('NOW twice in one expression is the same instant', {}, 'DATE_DIFF(NOW(), NOW(), "second")', 0, UTC),
    make('a DATETIME column before NOW', { ts: '2026-03-20T20:59:59Z' }, '.ts < NOW()', true),
    make('a DATETIME column equal to NOW', { ts: '2026-03-20T21:00:00Z' }, '.ts == NOW()', true),
    make('a DATETIME column after NOW', { ts: '2026-03-20T21:00:01Z' }, '.ts < NOW()', false),
    make('a DATE column before TODAY', { d: '2026-03-19' }, '.d < TODAY()', true),
    make('a DATE column is TODAY in Tehran', { d: '2026-03-21' }, '.d == TODAY()', true, TEHRAN),
    make('a DATE column is not TODAY in UTC', { d: '2026-03-21' }, '.d == TODAY()', false, UTC),
    make('days since a payment', { d: '2026-02-01' }, 'DATE_DIFF(TODAY(), .d, "day") > 30', true)
];

// ---- parts -----------------------------------------------------------------

const partCases: DifferentialCase[] = [
    make('YEAR of a DATE', { d: '2026-10-02' }, 'YEAR(.d)', 2026),
    make('MONTH of a DATE', { d: '2026-10-02' }, 'MONTH(.d)', 10),
    make('DAY of a DATE', { d: '2026-10-02' }, 'DAY(.d)', 2),
    make('DAY of the last day of a leap February', { d: '2028-02-29' }, 'DAY(.d)', 29),
    make('HOUR of a TIME', { t: '08:30:15' }, 'HOUR(.t)', 8),
    make('MINUTE of a TIME', { t: '08:30:15' }, 'MINUTE(.t)', 30),
    make('HOUR of a TIME with a fraction', { t: '23:59:59.5' }, 'HOUR(.t)', 23),
    make('YEAR of null is null', { dn: null }, 'YEAR(.dn)', null),
    make('MONTH of null is null', { tn: null }, 'MONTH(.tn)', null),
    ...ZONES.flatMap(([zone, clock]) => {
        const expected: Record<string, [number, number, number, number, number]> = {
            // 2026-12-31T22:45:00Z in each zone: year, month, day, hour, minute
            UTC: [2026, 12, 31, 22, 45],
            'Asia/Tehran': [2027, 1, 1, 2, 15],
            'Europe/Berlin': [2026, 12, 31, 23, 45],
            'America/New_York': [2026, 12, 31, 17, 45]
        };
        const [y, m, d, h, mi] = expected[zone];
        const record = { ts: '2026-12-31T22:45:00Z' };
        return [
            make(`YEAR of a DATETIME in ${zone}`, record, 'YEAR(.ts)', y, clock),
            make(`MONTH of a DATETIME in ${zone}`, record, 'MONTH(.ts)', m, clock),
            make(`DAY of a DATETIME in ${zone}`, record, 'DAY(.ts)', d, clock),
            make(`HOUR of a DATETIME in ${zone}`, record, 'HOUR(.ts)', h, clock),
            make(`MINUTE of a DATETIME in ${zone}`, record, 'MINUTE(.ts)', mi, clock)
        ];
    })
];

// ---- DATE_ADD on a DATE ----------------------------------------------------

const addDateCases: DifferentialCase[] = [
    make('Jan 31 + 1 month is Feb 28', { d: '2026-01-31' }, 'DATE_ADD(.d, 1, "month")', '2026-02-28'),
    make('Jan 31 + 1 month in a leap year is Feb 29', { d: '2028-01-31' }, 'DATE_ADD(.d, 1, "month")', '2028-02-29'),
    make('Jan 31 + 2 months is Mar 31', { d: '2026-01-31' }, 'DATE_ADD(.d, 2, "month")', '2026-03-31'),
    make('Mar 31 - 1 month is Feb 28', { d: '2026-03-31' }, 'DATE_ADD(.d, -1, "month")', '2026-02-28'),
    make('Dec 31 + 2 months crosses the year', { d: '2026-12-31' }, 'DATE_ADD(.d, 2, "month")', '2027-02-28'),
    make('Jan 15 - 2 months crosses the year', { d: '2026-01-15' }, 'DATE_ADD(.d, -2, "month")', '2025-11-15'),
    make('Feb 29 + 1 year is Feb 28', { d: '2028-02-29' }, 'DATE_ADD(.d, 1, "year")', '2029-02-28'),
    make('Feb 29 + 4 years is Feb 29', { d: '2028-02-29' }, 'DATE_ADD(.d, 4, "year")', '2032-02-29'),
    make('Feb 29 - 1 year is Feb 28', { d: '2028-02-29' }, 'DATE_ADD(.d, -1, "year")', '2027-02-28'),
    make('+ 1 week', { d: '2026-02-26' }, 'DATE_ADD(.d, 1, "week")', '2026-03-05'),
    make('- 2 weeks', { d: '2026-03-05' }, 'DATE_ADD(.d, -2, "week")', '2026-02-19'),
    make('+ 1 day over a month end', { d: '2026-02-28' }, 'DATE_ADD(.d, 1, "day")', '2026-03-01'),
    make('+ 1 day over a leap day', { d: '2028-02-28' }, 'DATE_ADD(.d, 1, "day")', '2028-02-29'),
    make('- 1 day over a year start', { d: '2026-01-01' }, 'DATE_ADD(.d, -1, "day")', '2025-12-31'),
    make('+ 0 days', { d: '2026-05-05' }, 'DATE_ADD(.d, 0, "day")', '2026-05-05'),
    make('+ 365 days', { d: '2026-01-01' }, 'DATE_ADD(.d, 365, "day")', '2027-01-01'),
    make('the amount can be a column', { d: '2026-01-01', n: 10 }, 'DATE_ADD(.d, .n, "day")', '2026-01-11'),
    make('null date gives null', { dn: null }, 'DATE_ADD(.dn, 1, "day")', null),
    make('a DATE_ADD result can be compared', { d: '2026-01-31', e: '2026-02-28' }, 'DATE_ADD(.d, 1, "month") == .e', true)
];

// ---- DATE_DIFF on DATE values ----------------------------------------------

const diffDateCases: DifferentialCase[] = [
    make('2026-10-02 - 2026-09-01 in months is 1', { d: '2026-10-02', e: '2026-09-01' }, 'DATE_DIFF(.d, .e, "month")', 1),
    make('the other way is -1', { d: '2026-09-01', e: '2026-10-02' }, 'DATE_DIFF(.d, .e, "month")', -1),
    make('a month is not whole before the same day', { d: '2026-10-01', e: '2026-09-02' }, 'DATE_DIFF(.d, .e, "month")', 0),
    make('Jan 31 to Feb 28 is less than a month', { d: '2026-02-28', e: '2026-01-31' }, 'DATE_DIFF(.d, .e, "month")', 0),
    make('Feb 28 back to Jan 31 is less than a month', { d: '2026-01-31', e: '2026-02-28' }, 'DATE_DIFF(.d, .e, "month")', 0),
    make('two years and a day', { d: '2028-03-01', e: '2026-02-28' }, 'DATE_DIFF(.d, .e, "year")', 2),
    make('one year less a day', { d: '2027-02-27', e: '2026-02-28' }, 'DATE_DIFF(.d, .e, "year")', 0),
    make('minus two years', { d: '2026-02-28', e: '2028-03-01' }, 'DATE_DIFF(.d, .e, "year")', -2),
    make('25 months in months', { d: '2028-03-01', e: '2026-02-01' }, 'DATE_DIFF(.d, .e, "month")', 25),
    make('13 days in weeks is 1', { d: '2026-03-14', e: '2026-03-01' }, 'DATE_DIFF(.d, .e, "week")', 1),
    make('-13 days in weeks is -1', { d: '2026-03-01', e: '2026-03-14' }, 'DATE_DIFF(.d, .e, "week")', -1),
    make('6 days in weeks is 0', { d: '2026-03-07', e: '2026-03-01' }, 'DATE_DIFF(.d, .e, "week")', 0),
    make('days over a leap day', { d: '2028-03-01', e: '2028-02-28' }, 'DATE_DIFF(.d, .e, "day")', 2),
    make('days over a year', { d: '2027-01-01', e: '2026-01-01' }, 'DATE_DIFF(.d, .e, "day")', 365),
    make('days of equal dates', { d: '2026-01-01', e: '2026-01-01' }, 'DATE_DIFF(.d, .e, "day")', 0),
    make('negative days', { d: '2026-01-01', e: '2026-01-31' }, 'DATE_DIFF(.d, .e, "day")', -30),
    make('null gives null', { d: '2026-01-01', dn: null }, 'DATE_DIFF(.d, .dn, "day")', null)
];

// ---- DATETIME arithmetic and daylight saving -------------------------------

const addDateTimeCases: DifferentialCase[] = [
    make('+ 1 hour', { ts: '2026-03-20T10:00:00Z' }, 'DATE_ADD(.ts, 1, "hour")', '2026-03-20T11:00:00.000Z'),
    make('- 90 minutes', { ts: '2026-03-20T10:00:00Z' }, 'DATE_ADD(.ts, -90, "minute")', '2026-03-20T08:30:00.000Z'),
    make('+ 45 seconds', { ts: '2026-03-20T10:00:30Z' }, 'DATE_ADD(.ts, 45, "second")', '2026-03-20T10:01:15.000Z'),
    make('+ 1 month on Jan 31 in UTC', { ts: '2026-01-31T10:00:00Z' }, 'DATE_ADD(.ts, 1, "month")', '2026-02-28T10:00:00.000Z'),
    make('+ 1 year on a leap day in UTC', { ts: '2028-02-29T10:00:00Z' }, 'DATE_ADD(.ts, 1, "year")', '2029-02-28T10:00:00.000Z'),
    make('+ 1 week in UTC', { ts: '2026-03-20T10:00:00Z' }, 'DATE_ADD(.ts, 1, "week")', '2026-03-27T10:00:00.000Z'),
    make('+ 1 day in Tehran moves the Tehran date', { ts: '2026-03-20T21:00:00Z' }, 'DATE_ADD(.ts, 1, "day")', '2026-03-21T21:00:00.000Z', TEHRAN),
    make(
        '+ 1 month on Jan 31 in Tehran uses the Tehran date',
        { ts: '2026-01-31T21:00:00Z' }, // 2026-02-01 00:30 in Tehran
        'DATE_ADD(.ts, 1, "month")',
        '2026-02-28T21:00:00.000Z',
        TEHRAN
    ),
    make(
        '+ 1 day across the Berlin spring change keeps the wall-clock time',
        { ts: '2026-03-28T11:00:00Z' }, // 12:00 CET
        'DATE_ADD(.ts, 1, "day")',
        '2026-03-29T10:00:00.000Z', // 12:00 CEST
        BERLIN
    ),
    make(
        '+ 24 hours across the Berlin spring change does not',
        { ts: '2026-03-28T11:00:00Z' },
        'DATE_ADD(.ts, 24, "hour")',
        '2026-03-29T11:00:00.000Z', // 13:00 CEST
        BERLIN
    ),
    make(
        '+ 1 week across the Berlin spring change keeps the wall-clock time',
        { ts: '2026-03-25T11:00:00Z' },
        'DATE_ADD(.ts, 1, "week")',
        '2026-04-01T10:00:00.000Z',
        BERLIN
    ),
    make(
        '+ 1 day across the Berlin autumn change keeps the wall-clock time',
        { ts: '2026-10-24T10:00:00Z' }, // 12:00 CEST
        'DATE_ADD(.ts, 1, "day")',
        '2026-10-25T11:00:00.000Z', // 12:00 CET
        BERLIN
    ),
    make(
        '+ 1 day to a time that does not exist (Berlin spring) lands after the gap',
        { ts: '2026-03-28T01:30:00Z' }, // 02:30 CET
        'DATE_ADD(.ts, 1, "day")',
        '2026-03-29T01:30:00.000Z', // 03:30 CEST
        BERLIN
    ),
    make(
        '+ 1 day to a time that exists twice (Berlin autumn) is the standard time',
        { ts: '2026-10-24T00:30:00Z' }, // 02:30 CEST
        'DATE_ADD(.ts, 1, "day")',
        '2026-10-25T01:30:00.000Z', // 02:30 CET
        BERLIN
    ),
    make(
        '+ 1 day across the New York spring change keeps the wall-clock time',
        { ts: '2026-03-07T17:00:00Z' }, // 12:00 EST
        'DATE_ADD(.ts, 1, "day")',
        '2026-03-08T16:00:00.000Z', // 12:00 EDT
        NEW_YORK
    ),
    make(
        '+ 24 hours across the New York spring change does not',
        { ts: '2026-03-07T17:00:00Z' },
        'DATE_ADD(.ts, 24, "hour")',
        '2026-03-08T17:00:00.000Z',
        NEW_YORK
    ),
    make(
        '+ 1 day across the New York autumn change keeps the wall-clock time',
        { ts: '2026-10-31T16:00:00Z' }, // 12:00 EDT
        'DATE_ADD(.ts, 1, "day")',
        '2026-11-01T17:00:00.000Z', // 12:00 EST
        NEW_YORK
    ),
    make(
        '+ 24 hours across the New York autumn change does not',
        { ts: '2026-10-31T16:00:00Z' },
        'DATE_ADD(.ts, 24, "hour")',
        '2026-11-01T16:00:00.000Z',
        NEW_YORK
    ),
    make(
        '- 1 day to a time that exists twice (New York autumn) is the standard time',
        { ts: '2026-11-02T06:30:00Z' }, // 01:30 EST on Nov 2
        'DATE_ADD(.ts, -1, "day")',
        '2026-11-01T06:30:00.000Z', // 01:30 EST on Nov 1
        NEW_YORK
    ),
    make('null gives null', { tn: null }, 'DATE_ADD(.tn, 1, "hour")', null)
];

const diffDateTimeCases: DifferentialCase[] = [
    make('seconds', { ts: '2026-03-20T10:01:30Z', ts2: '2026-03-20T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "second")', 90),
    make('minutes truncate toward zero', { ts: '2026-03-20T10:01:59Z', ts2: '2026-03-20T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "minute")', 1),
    make('negative minutes truncate toward zero', { ts: '2026-03-20T10:00:00Z', ts2: '2026-03-20T10:01:59Z' }, 'DATE_DIFF(.ts, .ts2, "minute")', -1),
    make('hours', { ts: '2026-03-21T10:00:00Z', ts2: '2026-03-20T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "hour")', 24),
    make('a part of an hour is zero hours', { ts: '2026-03-20T10:59:59Z', ts2: '2026-03-20T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "hour")', 0),
    make('days truncate toward zero', { ts: '2026-03-21T09:00:00Z', ts2: '2026-03-20T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "day")', 0),
    make('negative days truncate toward zero', { ts: '2026-03-20T10:00:00Z', ts2: '2026-03-22T09:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "day")', -1),
    make('weeks', { ts: '2026-04-03T10:00:00Z', ts2: '2026-03-20T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "week")', 2),
    make('months', { ts: '2026-10-02T10:00:00Z', ts2: '2026-09-01T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "month")', 1),
    make('a month is not whole before the same time of day', { ts: '2026-10-01T09:00:00Z', ts2: '2026-09-01T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "month")', 0),
    make('negative months', { ts: '2026-09-01T10:00:00Z', ts2: '2026-10-02T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "month")', -1),
    make('years', { ts: '2028-03-01T10:00:00Z', ts2: '2026-03-01T10:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "year")', 2),
    make(
        'a day across the Berlin spring change is one day and 23 hours',
        { ts: '2026-03-29T10:00:00Z', ts2: '2026-03-28T11:00:00Z' },
        'DATE_DIFF(.ts, .ts2, "day")',
        1,
        BERLIN
    ),
    make('the same two instants are 23 hours', { ts: '2026-03-29T10:00:00Z', ts2: '2026-03-28T11:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "hour")', 23, BERLIN),
    make(
        'a day across the New York autumn change is one day and 25 hours',
        { ts: '2026-11-01T17:00:00Z', ts2: '2026-10-31T16:00:00Z' },
        'DATE_DIFF(.ts, .ts2, "day")',
        1,
        NEW_YORK
    ),
    make('the same two instants are 25 hours', { ts: '2026-11-01T17:00:00Z', ts2: '2026-10-31T16:00:00Z' }, 'DATE_DIFF(.ts, .ts2, "hour")', 25, NEW_YORK),
    make(
        'months are counted on the Tehran dates',
        { ts: '2026-02-28T21:00:00Z', ts2: '2026-01-31T10:00:00Z' }, // Tehran: Mar 1 00:30 and Jan 31 13:30
        'DATE_DIFF(.ts, .ts2, "month")',
        1,
        TEHRAN
    ),
    make('null gives null', { ts: '2026-03-20T10:00:00Z', tn: null }, 'DATE_DIFF(.ts, .tn, "hour")', null)
];

// ---- CAST(datetime AS DATE) ------------------------------------------------

const castCases: DifferentialCase[] = [
    ...ZONES.map(([zone, clock]) =>
        make(
            `CAST(DATETIME AS DATE) in ${zone}`,
            { ts: '2026-12-31T22:45:00Z' },
            'CAST(.ts AS DATE)',
            {
                UTC: '2026-12-31',
                'Asia/Tehran': '2027-01-01',
                'Europe/Berlin': '2026-12-31',
                'America/New_York': '2026-12-31'
            }[zone],
            clock
        )
    ),
    make('CAST(DATETIME AS TIME) in Tehran', { ts: '2026-12-31T22:45:10Z' }, 'CAST(.ts AS TIME)', '02:15:10', TEHRAN),
    make('CAST(DATETIME AS TIME) in New York', { ts: '2026-12-31T22:45:10Z' }, 'CAST(.ts AS TIME)', '17:45:10', NEW_YORK),
    make('CAST(null AS DATE) is null', { tn: null }, 'CAST(.tn AS DATE)', null),
    make('the cast date can be compared with TODAY', { ts: '2026-03-20T21:00:00Z' }, 'CAST(.ts AS DATE) == TODAY()', true, TEHRAN)
];

// ---- CAST(text AS DATETIME) and CAST(date AS DATETIME) are instants ---------

const textSchema = { tables: [{ name: 'Item', primaryKey: 'id', columns: { id: 'INTEGER', s: 'TEXT', d: 'DATE' } }] };

function castCase(name: string, record: Record<string, unknown>, expr: string, expect: unknown, clock: TestClock = UTC): DifferentialCase {
    return { name, schema: textSchema, record: { id: 1, ...record }, expr, expect, clock };
}

const instantCastCases: DifferentialCase[] = [
    castCase('text without a zone is a wall-clock time in UTC', { s: '2026-10-02T08:30:00' }, 'CAST(.s AS DATETIME)', '2026-10-02T08:30:00.000Z', UTC),
    castCase('text without a zone is a wall-clock time in Tehran', { s: '2026-10-02 08:30:00' }, 'CAST(.s AS DATETIME)', '2026-10-02T05:00:00.000Z', TEHRAN),
    castCase('text without a zone in New York (summer time)', { s: '2026-07-01 08:30:00' }, 'CAST(.s AS DATETIME)', '2026-07-01T12:30:00.000Z', NEW_YORK),
    castCase('text without a zone in New York (winter time)', { s: '2026-12-01 08:30:00' }, 'CAST(.s AS DATETIME)', '2026-12-01T13:30:00.000Z', NEW_YORK),
    castCase('text with Z ignores the run zone', { s: '2026-10-02T08:30:00Z' }, 'CAST(.s AS DATETIME)', '2026-10-02T08:30:00.000Z', TEHRAN),
    castCase('text with an offset is that instant', { s: '2026-10-02T08:30:00+02:00' }, 'CAST(.s AS DATETIME)', '2026-10-02T06:30:00.000Z', NEW_YORK),
    castCase('text with a short offset', { s: '2026-10-02 08:30:00-05' }, 'CAST(.s AS DATETIME)', '2026-10-02T13:30:00.000Z', TEHRAN),
    castCase('a date alone is midnight in the run zone', { s: '2026-10-02' }, 'CAST(.s AS DATETIME)', '2026-10-01T20:30:00.000Z', TEHRAN),
    castCase(
        'a time that does not exist in Berlin is read as standard time',
        { s: '2026-03-29 02:30:00' },
        'CAST(.s AS DATETIME)',
        '2026-03-29T01:30:00.000Z',
        BERLIN
    ),
    castCase(
        'a DATE is midnight in the run zone',
        { d: '2026-10-02' },
        'CAST(.d AS DATETIME)',
        '2026-10-01T22:00:00.000Z',
        at('2026-03-20T21:00:00Z', 'Europe/Berlin')
    ),
    castCase('a DATE round trip keeps the date', { d: '2026-10-02' }, 'CAST(CAST(.d AS DATETIME) AS DATE)', '2026-10-02', TEHRAN),
    castCase('text that is not a date time fails', { s: '2026-10-02 later' }, 'CAST(.s AS DATETIME)', { error: 'cast-failed' }),
    castCase('a day that does not exist fails', { s: '2026-02-30 10:00:00' }, 'CAST(.s AS DATETIME)', { error: 'cast-failed' })
];

export const cases: DifferentialCase[] = [
    ...clockCases,
    ...partCases,
    ...addDateCases,
    ...diffDateCases,
    ...addDateTimeCases,
    ...diffDateTimeCases,
    ...castCases,
    ...instantCastCases
];
