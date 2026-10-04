/**
 * The guided tour: twelve short lessons, each a small task checked against
 * the real engine. Prose lives in `NN-slug/lesson.md`, programs in
 * `starter.minab` / `solution.minab` (so they get syntax highlighting in
 * an editor with the Minab extension), and the goal checks here.
 *
 * `test/content.test.ts` runs every lesson twice: the starter must *not*
 * meet its goal (otherwise there's nothing to do) and the solution must.
 */

import type { Row, RunReport } from '../../engine/protocol.js';
import type { Lesson } from '../types.js';

import helloBody from './01-hello/lesson.md?raw';
import helloStarter from './01-hello/starter.minab?raw';
import helloSolution from './01-hello/solution.minab?raw';
import relationsBody from './02-relations/lesson.md?raw';
import relationsStarter from './02-relations/starter.minab?raw';
import relationsSolution from './02-relations/solution.minab?raw';
import sortingBody from './03-sorting/lesson.md?raw';
import sortingStarter from './03-sorting/starter.minab?raw';
import sortingSolution from './03-sorting/solution.minab?raw';
import groupingBody from './04-grouping/lesson.md?raw';
import groupingStarter from './04-grouping/starter.minab?raw';
import groupingSolution from './04-grouping/solution.minab?raw';
import collectionsBody from './05-collections/lesson.md?raw';
import collectionsStarter from './05-collections/starter.minab?raw';
import collectionsSolution from './05-collections/solution.minab?raw';
import firstRuleBody from './06-first-rule/lesson.md?raw';
import firstRuleStarter from './06-first-rule/starter.minab?raw';
import firstRuleSolution from './06-first-rule/solution.minab?raw';
import crossTableBody from './07-cross-table/lesson.md?raw';
import crossTableStarter from './07-cross-table/starter.minab?raw';
import crossTableSolution from './07-cross-table/solution.minab?raw';
import fieldRulesBody from './08-field-rules/lesson.md?raw';
import fieldRulesStarter from './08-field-rules/starter.minab?raw';
import fieldRulesSolution from './08-field-rules/solution.minab?raw';
import strictTypesBody from './09-strict-types/lesson.md?raw';
import strictTypesStarter from './09-strict-types/starter.minab?raw';
import strictTypesSolution from './09-strict-types/solution.minab?raw';
import functionsBody from './10-functions/lesson.md?raw';
import functionsStarter from './10-functions/starter.minab?raw';
import functionsSolution from './10-functions/solution.minab?raw';
import switchBody from './11-switch/lesson.md?raw';
import switchStarter from './11-switch/starter.minab?raw';
import switchSolution from './11-switch/solution.minab?raw';
import nextBody from './12-whats-next/lesson.md?raw';
import nextStarter from './12-whats-next/starter.minab?raw';
import nextSolution from './12-whats-next/solution.minab?raw';

function rows(report: RunReport): Row[] | undefined {
    return report.stage === 'done' && report.result?.kind === 'rows' ? report.result.rows : undefined;
}

function verdict(report: RunReport): boolean | undefined {
    return report.stage === 'done' && report.result?.kind === 'verdict' ? report.result.value : undefined;
}

const BOOKING_BASE = { id: 'bkg-new', room_id: 'room-7', customer_id: 'cus-barbara', purpose: 'Board meeting' };

export const lessons: Lesson[] = [
    {
        id: 'hello',
        number: 1,
        title: 'Hello, Minab',
        summary: 'FROM, WHERE, SELECT — and `.` as the current row.',
        body: helloBody,
        starter: helloStarter,
        solution: helloSolution,
        host: { dataset: 'demo' },
        task: 'Keep only the orders whose status is "shipped".',
        goal: ({ report }) => {
            const r = rows(report);
            return !!r && r.length === 6 && r.every(row => !('status' in row) || row.status === 'shipped');
        },
        hints: ['Filtering goes between FROM and SELECT: `WHERE <condition>`.', 'The condition is `.status == "shipped"`.'],
        focus: 'result'
    },
    {
        id: 'relations',
        number: 2,
        title: 'Walk relations with dots',
        summary: '`.customer.name` follows a ref — no JOIN needed.',
        body: relationsBody,
        starter: relationsStarter,
        solution: relationsSolution,
        host: { dataset: 'demo' },
        task: 'Show the customer’s name as `customer`, for shipped orders from US customers.',
        goal: ({ report }) => {
            const r = rows(report);
            return !!r && r.length === 4 && r.every(row => typeof row.customer === 'string');
        },
        hints: [
            'Combine conditions with `AND`: `.status == "shipped" AND .customer.country == "US"`.',
            'Name an output column with `AS`: `.customer.name AS customer`.'
        ],
        focus: 'sql'
    },
    {
        id: 'sorting',
        number: 3,
        title: 'Sort and limit',
        summary: '`ORDERBY … DESC` and `LIMIT`.',
        body: sortingBody,
        starter: sortingStarter,
        solution: sortingSolution,
        host: { dataset: 'demo' },
        task: 'Show the three biggest non-cancelled orders, biggest first.',
        goal: ({ report }) => {
            const r = rows(report);
            return !!r && r.length === 3 && r[0].total === 1302.5 && r[1].total === 1279 && r[2].total === 1010;
        },
        hints: ['`ORDERBY .total DESC` sorts biggest first.', '`LIMIT 3` goes last.'],
        focus: 'result'
    },
    {
        id: 'grouping',
        number: 4,
        title: 'Group and aggregate',
        summary: '`GROUPBY`, `HAVING`, `KEY` and the aggregates.',
        body: groupingBody,
        starter: groupingStarter,
        solution: groupingSolution,
        host: { dataset: 'demo' },
        task: 'Add `spent` (each customer’s total) and keep only customers who spent more than 1000.',
        goal: ({ report }) => {
            const r = rows(report);
            return !!r && r.length === 5 && r.every(row => typeof row.spent === 'number' && row.spent > 1000);
        },
        hints: ['`SUM(.total) AS spent` in the SELECT.', 'Filter groups with `HAVING SUM(.total) > 1000`, between GROUPBY and SELECT.'],
        focus: 'result'
    },
    {
        id: 'collections',
        number: 5,
        title: 'Collections and filters',
        summary: 'Filter a relation inline, reduce it with `COUNT`.',
        body: collectionsBody,
        starter: collectionsStarter,
        solution: collectionsSolution,
        host: { dataset: 'demo' },
        task: 'Add a `cancelled` count and keep only customers with at least one cancelled order.',
        goal: ({ report }) => {
            const r = rows(report);
            return !!r && r.length === 3 && r.every(row => typeof row.cancelled === 'number' && row.cancelled >= 1);
        },
        hints: [
            'The cancelled orders are `.orders[.status == "cancelled"]`.',
            'Count them in both places: `WHERE COUNT(…) > 0` and `SELECT …, COUNT(…) AS cancelled`.'
        ],
        focus: 'result'
    },
    {
        id: 'first-rule',
        number: 6,
        title: 'Your first rule',
        summary: 'A condition over `.` validates a record.',
        body: firstRuleBody,
        starter: firstRuleStarter,
        solution: firstRuleSolution,
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Booking' },
            record: { ...BOOKING_BASE, start_date: '2026-10-10', end_date: '2026-10-08' }
        },
        solutionHost: { record: { ...BOOKING_BASE, start_date: '2026-10-08', end_date: '2026-10-10' } },
        presets: [
            {
                id: 'backwards',
                label: 'Backwards dates',
                expect: false,
                note: 'Ends two days before it starts.',
                record: { ...BOOKING_BASE, start_date: '2026-10-10', end_date: '2026-10-08' }
            },
            {
                id: 'fixed',
                label: 'Fixed dates',
                expect: true,
                note: 'Oct 8 to Oct 10.',
                record: { ...BOOKING_BASE, start_date: '2026-10-08', end_date: '2026-10-10' }
            }
        ],
        task: 'Make the rule pass by fixing the record — not the rule.',
        goal: ({ report, source }) => verdict(report) === true && /\.end_date\s*>\s*\.start_date/.test(source),
        hints: ['Open the **Record** tab under the editor.', 'Swap `start_date` and `end_date`, or click the *Fixed dates* preset.'],
        focus: 'result'
    },
    {
        id: 'cross-table',
        number: 7,
        title: 'Cross-table rules',
        summary: '`#Table` inside a rule, `^` for the record — one pushed-down lookup.',
        body: crossTableBody,
        starter: crossTableStarter,
        solution: crossTableSolution,
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Booking' },
            record: { ...BOOKING_BASE, start_date: '2026-10-01', end_date: '2026-10-05' }
        },
        presets: [
            {
                id: 'free',
                label: 'Free slot',
                expect: true,
                note: 'Nothing else in room 7 from Oct 1 to 5.',
                record: { ...BOOKING_BASE, start_date: '2026-10-01', end_date: '2026-10-05' }
            },
            {
                id: 'overlap',
                label: 'Overlaps bkg-12',
                expect: false,
                note: 'Oct 4–8 collides with Oct 6–9.',
                record: { ...BOOKING_BASE, start_date: '2026-10-04', end_date: '2026-10-08' }
            }
        ],
        task: 'Also fail when another booking of the same room overlaps this one.',
        goal: ({ report, source }) => verdict(report) !== undefined && report.trace.length === 1 && source.includes('#Booking') && source.includes('^'),
        hints: [
            '`NOT EXISTS(#Booking[ … ])` is true when no booking matches the filter.',
            'Inside the filter: `. != ^` (not itself), `.room_id == ^.room_id` (same room).',
            'Overlap: `.start_date < ^.end_date AND .end_date > ^.start_date`.'
        ],
        focus: 'execution'
    },
    {
        id: 'field-rules',
        number: 8,
        title: 'Field rules with `$`',
        summary: 'Validate one value; reach the rest of the record through `.`.',
        body: fieldRulesBody,
        starter: fieldRulesStarter,
        solution: fieldRulesSolution,
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Order', fieldType: 'DECIMAL' },
            record: { id: 'ord-200', customer_id: 'cus-ken', status: 'pending', total: 950 },
            fieldValue: 950
        },
        presets: [
            { id: 'over', label: '950', expect: false, note: 'Over Ken’s 800 limit.', fieldValue: 950 },
            { id: 'ok', label: '500', expect: true, note: 'Within the limit.', fieldValue: 500 },
            { id: 'negative', label: '−5', expect: false, note: 'Fails locally; nothing is sent.', fieldValue: -5 }
        ],
        task: 'Also require `$` to be within `.customer.credit_limit`, so 950 fails.',
        goal: ({ report }) => verdict(report) === false && report.trace.length === 1,
        hints: ['Add `AND $ <= .customer.credit_limit`.'],
        focus: 'execution'
    },
    {
        id: 'strict-types',
        number: 9,
        title: 'Strict types',
        summary: 'No implicit coercion — `CAST` says what you mean.',
        body: strictTypesBody,
        starter: strictTypesStarter,
        solution: strictTypesSolution,
        host: { dataset: 'demo' },
        task: 'Fix the type error so the orders from September 1st, 2026 on are listed.',
        goal: ({ report }) => {
            const r = rows(report);
            return !!r && r.length === 10;
        },
        hints: ['Wrap the string: `CAST("2026-09-01" AS DATE)`.'],
        focus: 'problems'
    },
    {
        id: 'functions',
        number: 10,
        title: 'Variables and functions',
        summary: '`let`, `fn`, and calls by name.',
        body: functionsBody,
        starter: functionsStarter,
        solution: functionsSolution,
        host: { dataset: 'demo' },
        task: 'Use a `rate` variable of 20 to discount a 1302.5 order.',
        goal: ({ report, source }) =>
            report.stage === 'done' && report.result?.kind === 'value' && report.result.value === '1042' && /\blet\s+rate\b/.test(source),
        hints: ['Declarations come before the final expression: `let rate: DECIMAL = 20;`.', 'Then call `discounted(1302.5, rate)`.'],
        focus: 'result'
    },
    {
        id: 'switch',
        number: 11,
        title: '`if` and `switch` are expressions',
        summary: 'Compute a value from the record, then rule on it.',
        body: switchBody,
        starter: switchStarter,
        solution: switchSolution,
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Order' },
            record: { id: 'ord-new', customer_id: 'cus-grace', status: 'high', total: 750 }
        },
        presets: [
            {
                id: 'high',
                label: 'high · 750',
                expect: true,
                note: 'Needs more than 500.',
                record: { id: 'ord-new', customer_id: 'cus-grace', status: 'high', total: 750 }
            },
            {
                id: 'normal',
                label: 'normal · 750',
                expect: false,
                note: 'Needs more than 5000.',
                record: { id: 'ord-new', customer_id: 'cus-grace', status: 'normal', total: 750 }
            }
        ],
        task: 'Rewrite `minimum` as a `switch` over `.status`.',
        goal: ({ report, source }) =>
            verdict(report) !== undefined && /\bswitch\s+\.status\b/.test(source) && /"normal"\s*,\s*"low"|"low"\s*,\s*"normal"/.test(source),
        hints: ['`switch .status { "urgent" => 0, … , _ => 100000 }`', 'Arms are separated by commas; `_` must come last.'],
        focus: 'result'
    },
    {
        id: 'whats-next',
        number: 12,
        title: 'What’s next',
        summary: 'Loops run. Writes are checked today, executed later.',
        body: nextBody,
        starter: nextStarter,
        solution: nextSolution,
        host: { dataset: 'demo' },
        task: 'Run the loop and read the answer.',
        goal: ({ report }) => report.stage === 'done' && (report.result?.kind === 'verdict' || report.result?.kind === 'value') && report.diagnostics.length === 0,
        hints: ['Just press Run.'],
        focus: 'result'
    }
];

export function lessonById(id: string): Lesson | undefined {
    return lessons.find(l => l.id === id);
}
