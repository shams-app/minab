import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

/**
 * A `null` value at run time (D46, spec §7.7): arithmetic gives `null`, ordering and `LIKE`
 * give `false`, and `IN` is repeated `==`, so it is never `null`.
 */

const record = { id: 1, n: null, m: null, t: null, a: 4, b: 0 };
const values = { id: 1, n: 3, m: null, t: 'abc', a: 4, b: 0 };

const is = (expr: string, expect: unknown, row: Record<string, unknown> = record): DifferentialCase => ({
    name: `${expr} is ${JSON.stringify(expect)}`,
    schema,
    record: row,
    expr,
    expect
});

export const cases: DifferentialCase[] = [
    // Arithmetic with a null operand gives null, before any other check.
    is('.n + .a', null),
    is('.n - .m', null),
    is('-.n', null),
    is('.n * 2', null),
    is('.n / 2', null),
    is('.n / .b', null),
    is('.a / .n', null),
    is('.n % 2', null),
    is('.n \\ 2', null),
    is('.n \\ .b', null),
    is('.a + .n * 2', null),
    is('COALESCE(.n, 0) + .a', 4),

    // Ordering and LIKE with a null operand give false.
    is('.n < 5', false),
    is('.n >= 5', false),
    is('.n > .a', false),
    is('.a <= .n', false),
    is('.t LIKE "a%"', false),
    is('NOT (.n < 5)', true),
    is('NOT (.t LIKE "a%")', true),
    is('(.n < 5) == false', true),
    is('.n < 5 OR .a == 4', true),
    is('NOT (.n < 5 OR .n > 5)', true),
    is('if .n < 5 { 1 } else { 2 }', 2),
    // A value keeps the usual answer.
    is('.n < 5', true, values),
    is('.t LIKE "a%"', true, values),
    is('NOT (.n < 5)', false, values),

    // IN is repeated ==.
    is('.n IN [1, 2]', false),
    is('.n IN [1, null]', true),
    is('.a IN [1, null]', false),
    is('.a IN [4, null]', true),
    is('.n IN [.m]', true),
    is('NOT (.n IN [1, 2])', true),
    is('NOT (.a IN [1, null])', true),
    is('.n + 1 IN [1, null]', true),
    is('.n IN [3, 4]', true, values),
    is('.m IN [.n, 4]', false, values),

    // IN with a subquery.
    is('.a IN (FROM Item SELECT .a)', true),
    is('.a IN (FROM Item SELECT .b)', false),
    is('.n IN (FROM Item SELECT .m)', true),
    is('.a IN (FROM Item SELECT .m)', false),
    is('.n IN (FROM Item SELECT .a)', false),
    is('NOT (.n IN (FROM Item SELECT .a))', true),
    is('.a IN (FROM Item WHERE .a > 10 SELECT .a)', false),

    // A JSON null is null (spec §5.6).
    is('CAST("null" AS JSON) is null', true),
    is('CAST("null" AS JSON) isnot null', false),
    is('CAST("null" AS JSON) == null', true),
    is('CAST("null" AS JSON) != null', false),
    is('CAST("1" AS JSON) is null', false),
    is('CAST("1" AS JSON) != null', true),

    // The sweep: other places where a null meets an operator.
    is('switch .n { null => 1, _ => 2 }', 1),
    is('switch .n { 1 => 1, _ => 2 }', 2),
    is('if .n == null { 1 } else { 2 }', 1),
    is('COALESCE(.n, .m, .a)', 4),
    is('COALESCE(.n, .m)', null),
    is('MIN(#Item.n)', null),
    is('MAX(#Item.n)', null),
    is('SUM(#Item.n)', null),
    is('AVG(#Item.n)', null)
];
