import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

const record = {
    id: 1,
    a: 7,
    b: 2,
    n: null,
    s: 'Ada',
    t: 'Lovelace',
    ci: 'Grace',
    x: 7.5,
    y: 2
};
const byZero = { error: 'division-by-zero' };

export const cases: DifferentialCase[] = [
    {
        name: 'text + text',
        schema,
        record,
        expr: '.s + " " + .t',
        expect: 'Ada Lovelace'
    },
    {
        name: 'text + CITEXT',
        schema,
        record,
        expr: '.s + .ci',
        expect: 'AdaGrace'
    },
    {
        name: 'text + null literal',
        schema,
        record,
        expr: '.s + null',
        expect: null
    },
    {
        name: 'null text column + text',
        schema,
        record: { ...record, t: null },
        expr: '.s + .t',
        expect: null
    },

    { name: 'divide literals', schema, record, expr: '7 / 2', expect: '3.5' },
    {
        name: 'divide two INTEGER columns',
        schema,
        record,
        expr: '.a / .b',
        expect: '3.5'
    },
    {
        name: 'one third',
        schema,
        record: { ...record, a: 1, b: 3 },
        expr: '.a / .b',
        expect: '0.3333333333333333'
    },
    {
        name: 'two thirds rounds half away from zero',
        schema,
        record: { ...record, a: 2, b: 3 },
        expr: '.a / .b',
        expect: '0.6666666666666667'
    },
    {
        name: 'negative two thirds',
        schema,
        record: { ...record, a: -2, b: 3 },
        expr: '.a / .b',
        expect: '-0.6666666666666667'
    },
    {
        name: 'large quotient keeps 16 digits',
        schema,
        record: { ...record, a: 10000000000, b: 3 },
        expr: '.a / .b',
        expect: '3333333333.3333333333333333'
    },
    {
        name: 'tiny quotient',
        schema,
        record: { ...record, a: 1, b: 9000000000000000 },
        expr: '.a / .b',
        expect: '0.0000000000000001'
    },
    {
        name: 'tiny quotient rounds to zero',
        schema,
        record: { ...record, a: 1, x: '100000000000000000000' },
        expr: '.a / .x',
        expect: '0'
    },
    {
        name: 'half rounds away from zero',
        schema,
        record: { ...record, x: 0.00000000000000005 },
        expr: '.x / 1',
        expect: '0.0000000000000001'
    },
    {
        name: 'negative half rounds away from zero',
        schema,
        record: { ...record, x: -0.00000000000000005 },
        expr: '.x / 1',
        expect: '-0.0000000000000001'
    },
    {
        name: 'DECIMAL by DECIMAL',
        schema,
        record,
        expr: '.x / .y',
        expect: '3.75'
    },

    {
        name: 'remainder takes the sign of the left side',
        schema,
        record: { ...record, a: -7, b: 3 },
        expr: '.a % .b',
        expect: -1
    },
    {
        name: 'remainder, positive left, negative right',
        schema,
        record: { ...record, a: 7, b: -3 },
        expr: '.a % .b',
        expect: 1
    },
    { name: 'DECIMAL remainder', schema, record, expr: '.x % .y', expect: '1.5' },
    {
        name: 'negative DECIMAL remainder',
        schema,
        record: { ...record, x: -7.5 },
        expr: '.x % .y',
        expect: '-1.5'
    },

    {
        name: 'division by zero',
        schema,
        record: { ...record, b: 0 },
        expr: '.a / .b',
        expect: byZero
    },
    {
        name: 'division of DECIMAL by zero',
        schema,
        record: { ...record, y: 0 },
        expr: '.x / .y',
        expect: byZero
    },
    {
        name: 'remainder by zero',
        schema,
        record: { ...record, b: 0 },
        expr: '.a % .b',
        expect: byZero
    },
    {
        name: 'DECIMAL remainder by zero',
        schema,
        record: { ...record, y: 0 },
        expr: '.x % .y',
        expect: byZero
    }
];
