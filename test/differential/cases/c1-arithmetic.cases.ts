import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

const record = { id: 1, a: 7, b: 3, x: 1.5, y: 2.25 };

export const cases: DifferentialCase[] = [
    { name: 'integer addition', schema, record, expr: '.a + .b', expect: 10 },
    { name: 'integer subtraction below zero', schema, record, expr: '.b - .a', expect: -4 },
    { name: 'integer multiplication', schema, record, expr: '.a * .b', expect: 21 },
    { name: 'decimal addition', schema, record, expr: '.x + .y', expect: 3.75 },
    { name: 'decimal multiplication', schema, record, expr: '.x * .y', expect: 3.375 },
    { name: 'decimal division', schema, record, expr: '.y / .x', expect: 1.5 },
    { name: 'integer remainder', schema, record, expr: '.a % .b', expect: 1 },
    { name: 'operator precedence', schema, record, expr: '.a + .b * .a', expect: 28 },
    { name: 'comparison <', schema, record, expr: '.b < .a', expect: true },
    { name: 'comparison <=', schema, record, expr: '.a <= .a', expect: true },
    { name: 'comparison >', schema, record, expr: '.b > .a', expect: false },
    { name: 'comparison >=', schema, record, expr: '.b >= .a', expect: false },
    { name: 'comparison == on integers', schema, record, expr: '.a == .a', expect: true },
    { name: 'comparison != on integers', schema, record, expr: '.a != .b', expect: true },
    { name: 'integer and decimal compare', schema, record, expr: '.x < .a', expect: true }
];
