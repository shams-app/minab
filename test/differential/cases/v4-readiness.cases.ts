import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

/**
 * Production plan phase V4 (the 1.0 review). Each case failed before its fix.
 * - `CAST(… AS INTEGER)` is `bigint` in SQL: an `INTEGER` holds whole numbers up to the safe range
 *   (spec §7.2), and Postgres `integer` stops at 2,147,483,647.
 * - A bare literal before `is null` gets its type: Postgres cannot type `$1 IS NULL` alone.
 * - The value of an `if` or a `switch` that mixes `INTEGER` and `DECIMAL` is a `DECIMAL` (spec §7.2).
 * - `ALL` and `ANY` (spec §5.3.1) run in SQL; before, a rule over a table failed in both runtimes.
 * - `IN` and `switch` over only literals compared bare parameters as text in Postgres.
 * The checker side is in `test/branch-types.test.ts`, and queries with `ALL`/`ANY` in `test/queries/cases/v4-all-any.cases.ts`.
 */
const row = { id: 1, a: 4, b: 3000000000, n: null, x: '2.5', s: 'abc', yes: true, no: false };
const is = (expr: string, expect: unknown): DifferentialCase => ({ name: `${expr} is ${JSON.stringify(expect)}`, schema, record: row, expr, expect });

const shopSchema = {
    tables: [
        { name: 'Customer', primaryKey: 'id', columns: { id: 'INTEGER', orders: { collection: 'Order', foreignKey: 'customer_id' } } },
        { name: 'Order', primaryKey: 'id', columns: { id: 'INTEGER', customer_id: 'INTEGER?', paid: 'BOOLEAN?', total: 'DECIMAL' } }
    ]
};
const shop = (expr: string, expect: unknown): DifferentialCase => ({
    name: `${expr} is ${JSON.stringify(expect)}`,
    schema: shopSchema,
    table: 'Customer',
    record: { id: 1 },
    expr,
    expect
});

export const cases: DifferentialCase[] = [
    is('CAST(.b AS INTEGER)', 3000000000),
    is('CAST("3000000000" AS INTEGER)', 3000000000),
    is('CAST(" -3000000000 " AS INTEGER)', -3000000000),
    is('CAST(3000000000.4 AS INTEGER)', 3000000000),
    is('CAST(2.5 AS INTEGER)', 3),
    is('CAST(CAST(.b AS TEXT) AS INTEGER) == .b', true),
    is('"a" is null', false),
    is('"a" isnot null', true),
    is('1 is null', false),
    is('2.5 isnot null', true),
    is('true is null', false),
    is('if .a > 1 { 1 } else { .x }', '1'),
    is('if .a > 10 { 1 } else { .x }', '2.5'),
    is('switch .a { 4 => 7, _ => .x }', '7'),
    is('if .a > 10 { 1 } else { .n }', null),
    // Only literals: each bare parameter gets its type (C10 Later).
    is('1 IN [1.0, 2.0]', true),
    is('2.5 IN [1, 2]', false),
    is('"10" IN ["9", "10"]', true),
    is('switch 1.0 { 1 => "a", _ => "b" }', 'a'),
    is('switch 10 { 9 => "a", 10 => "b", _ => "c" }', 'b'),
    // The harness inserts only the record's row, so a customer has no orders: `ALL` is `true`, `ANY` is `false`.
    shop('ALL(.orders.paid)', true),
    shop('ANY(.orders.paid)', false),
    shop('ALL(.orders[.total > 1].paid)', true),
    shop('NOT ANY(#Order.paid)', true),
    shop('ALL(#Order[.paid].paid) AND NOT ANY(#Order[.paid].paid)', true)
];
