import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

/**
 * Exact `DECIMAL` numbers (C2, D17). The interpreter holds decimals as exact
 * values, like Postgres `numeric`. The values come as text, as `pg` sends them.
 * Cases that need an error are in `test/decimal.test.ts`: Postgres has no
 * integer range error, so the two runtimes cannot agree on them.
 */
const money = { id: 1, a: 3, b: 2, x: '8.30', y: '0.2', z: '0.3' };

export const cases: DifferentialCase[] = [
    { name: 'decimal addition is exact', schema, record: { x: 0.1, y: 0.2, z: 0.3 }, expr: '.x + .y == .z', expect: true },
    { name: 'decimal addition is exact, as text', schema, record: { x: '0.1', y: '0.2', z: '0.3' }, expr: '.x + .y == .z', expect: true },
    { name: 'decimal subtraction is exact', schema, record: { x: '0.3', y: '0.1', z: '0.2' }, expr: '.x - .y == .z', expect: true },
    { name: 'a price times a quantity', schema, record: money, expr: '.x * .a', expect: '24.9' },
    { name: 'a price times a decimal', schema, record: money, expr: '.x * .y', expect: '1.66' },
    { name: 'twenty digits and a cent', schema, record: { x: '12345678901234567890.12' }, expr: '.x + 0.01', expect: '12345678901234567890.13' },
    { name: 'twenty digits in a column pair', schema, record: { x: '12345678901234567890.12', y: '0.01' }, expr: '.x + .y', expect: '12345678901234567890.13' },
    {
        name: 'many digits after the point',
        schema,
        record: { x: '0.1234567890123456789', y: '0.0000000000000000001' },
        expr: '.x + .y',
        expect: '0.123456789012345679'
    },
    { name: 'a decimal literal keeps its digits', schema, record: { x: '0.1' }, expr: '.x + 0.20', expect: '0.3' },
    { name: 'a whole decimal result has no trailing zeros', schema, record: { x: '2.50', y: '0.50' }, expr: '.x + .y', expect: '3' },
    { name: 'negative decimals', schema, record: { x: '-8.30', a: 3 }, expr: '.x * .a', expect: '-24.9' },
    { name: 'unary minus on a decimal', schema, record: { x: '-8.30' }, expr: '-.x', expect: '8.3' },
    { name: 'integer plus decimal is a decimal', schema, record: { a: 3, x: '0.5' }, expr: '.a + .x', expect: '3.5' },
    { name: 'integer times decimal is a decimal', schema, record: { a: 3, x: '0.5' }, expr: '.a * .x', expect: '1.5' },
    { name: 'integer equals decimal', schema, record: { a: 3, x: '3.00' }, expr: '.a == .x', expect: true },
    { name: 'integer differs from decimal', schema, record: { a: 3, x: '3.01' }, expr: '.a != .x', expect: true },
    { name: 'integer less than decimal', schema, record: { a: 3, x: '3.01' }, expr: '.a < .x', expect: true },
    { name: 'decimal less or equal to integer', schema, record: { a: 3, x: '3.00' }, expr: '.x <= .a', expect: true },
    { name: 'decimal greater than integer', schema, record: { a: 3, x: '2.99' }, expr: '.x > .a', expect: false },
    { name: 'decimal greater or equal', schema, record: { x: '0.30000000000000004', z: '0.3' }, expr: '.x >= .z', expect: true },
    { name: 'close decimals are not equal', schema, record: { x: '0.30000000000000004', z: '0.3' }, expr: '.x == .z', expect: false },
    { name: 'decimal IN a list', schema, record: { x: '1.50' }, expr: '.x IN [1.5, 2.5]', expect: true },
    { name: 'decimal not IN a list', schema, record: { x: '1.51' }, expr: '.x IN [1.5, 2.5]', expect: false },
    { name: 'a decimal result inside a condition', schema, record: { x: '8.30', a: 3 }, expr: '.x * .a > 24.89', expect: true },
    { name: 'a decimal column alone is returned as text', schema, record: { x: '8.30' }, expr: '.x', expect: '8.3' },
    { name: 'null decimal stays null', schema, record: { x: '8.30', n: null }, expr: '.n == null', expect: true }
];
