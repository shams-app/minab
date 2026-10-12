import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

/**
 * Literal-only parts of an expression run in Postgres (C10). Before C10 the
 * compiler bound literals with no type, and Postgres refused `$1 + $2`
 * ("operator is not unique"), or compared `$1 < $2` as text.
 * Kind tests on a `JSON` value (D47) are here too. Kind tests on other
 * types are check errors: see `test/kind-tests.test.ts`.
 */
const item = { id: 1, a: 4, x: '2.50' };

const json = {
    tables: [{ name: 'Doc', primaryKey: 'id', columns: { id: 'INTEGER', j: 'JSON?' } }]
};

export const cases: DifferentialCase[] = [
    { name: 'two integer literals', expr: '1 + 2', expect: 3 },
    { name: 'a negative literal plus a literal', expr: '-1 + 2', expect: 1 },
    { name: 'an integer literal plus a decimal literal', expr: '1 + 2.5', expect: '3.5' },
    { name: 'two decimal literals are exact', expr: '0.1 + 0.2', expect: '0.3' },
    { name: 'a literal minus a literal', expr: '2 - 5', expect: -3 },
    { name: 'a literal times a literal', expr: '6 * 7', expect: 42 },
    { name: 'remainder of two literals', expr: '7 % 2', expect: 1 },
    { name: 'whole division of two literals', expr: '7 \\ 2', expect: 3 },
    { name: 'division of two literals', expr: '7 / 2', expect: '3.5' },
    { name: 'a large integer literal', expr: '3000000000 + 1', expect: 3000000001 },
    { name: 'a chain of literals', expr: '1 + 2 * 3 - 4', expect: 3 },
    { name: 'minus a literal sum', expr: '-(1 + 2)', expect: -3 },
    { name: 'a column times a literal sum', schema, record: item, expr: '.a * (1 + 2)', expect: 12 },
    { name: 'a column compared with a literal sum', schema, record: item, expr: '.a > 1 + 2', expect: true },
    { name: 'a decimal column times a mixed literal sum', schema, record: item, expr: '.x * (1 + 0.2)', expect: '3' },
    { name: 'a literal sum compared with a column', schema, record: item, expr: '1 + 2 < .a', expect: true },
    { name: 'literals compare as numbers, not text', expr: '10 < 9', expect: false },
    { name: 'an integer literal equals a decimal literal', expr: '1 == 1.0', expect: true },
    { name: 'a literal comparison', expr: '1 < 2', expect: true },
    { name: 'text literals joined', expr: '"a" + "b"', expect: 'ab' },
    { name: 'text literals compared', expr: '"a" == "a"', expect: true },
    { name: 'text literals ordered', expr: '"a" < "b"', expect: true },
    { name: 'a literal matches a pattern', expr: '"abc" LIKE "a%"', expect: true },
    { name: 'ABS of a negative literal', expr: 'ABS(-3)', expect: 3 },
    { name: 'ROUND of a decimal literal', expr: 'ROUND(2.5)', expect: '3' },
    { name: 'a JSON object literal is an object', expr: '{ a: 1 } is object', expect: true },
    { name: 'a JSON column holds an array', schema: json, record: { id: 1, j: [1, 2] }, expr: '.j is array', expect: true },
    { name: 'a JSON column holds no number', schema: json, record: { id: 1, j: 'x' }, expr: '.j is number', expect: false },
    { name: 'a null JSON column is no object', schema: json, record: { id: 1, j: null }, expr: '.j is object', expect: false }
];
