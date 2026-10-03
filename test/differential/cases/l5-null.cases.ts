import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

export const cases: DifferentialCase[] = [
    { name: 'COALESCE takes the first value that is not null', schema, record: { id: 1, t: null, s: 'name' }, expr: 'COALESCE(.t, .s)', expect: 'name' },
    { name: 'COALESCE keeps a first value that is not null', schema, record: { id: 1, t: 'nick', s: 'name' }, expr: 'COALESCE(.t, .s)', expect: 'nick' },
    { name: 'COALESCE with an empty text keeps the empty text', schema, record: { id: 1, t: '', s: 'name' }, expr: 'COALESCE(.t, .s)', expect: '' },
    { name: 'COALESCE with three arguments', schema, record: { id: 1, n: null, m: null, a: 7 }, expr: 'COALESCE(.n, .m, .a)', expect: 7 },
    { name: 'COALESCE of only nulls is null', schema, record: { id: 1, n: null, m: null }, expr: 'COALESCE(.n, .m)', expect: null },
    { name: 'COALESCE of numbers', schema, record: { id: 1, n: null, a: -3 }, expr: 'COALESCE(.n, .a)', expect: -3 },
    { name: 'COALESCE lets INTEGER and DECIMAL mix', schema, record: { id: 1, n: null, x: '2.50' }, expr: 'COALESCE(.n, .x)', expect: '2.5' },
    { name: 'COALESCE of Persian text', schema, record: { id: 1, t: null, s: 'سلام' }, expr: 'COALESCE(.t, .s)', expect: 'سلام' },
    { name: 'COALESCE of a CITEXT column', schema, record: { id: 1, t: null, ci: 'Mix' }, expr: 'COALESCE(.t, .ci)', expect: 'Mix' },
    { name: 'GREATEST of numbers', schema, record: { id: 1, a: 3, b: 9 }, expr: 'GREATEST(.a, .b)', expect: 9 },
    { name: 'GREATEST ignores null', schema, record: { id: 1, a: 3, n: null }, expr: 'GREATEST(.n, .a)', expect: 3 },
    { name: 'GREATEST of only nulls is null', schema, record: { id: 1, n: null, m: null }, expr: 'GREATEST(.n, .m)', expect: null },
    { name: 'GREATEST of negative numbers', schema, record: { id: 1, a: -3, b: -9 }, expr: 'GREATEST(.a, .b)', expect: -3 },
    { name: 'GREATEST of three decimals', schema, record: { id: 1, x: '1.5', y: '2.25', z: '-3' }, expr: 'GREATEST(.x, .y, .z)', expect: '2.25' },
    { name: 'GREATEST lets INTEGER and DECIMAL mix', schema, record: { id: 1, a: 2, x: '1.5' }, expr: 'GREATEST(.a, .x)', expect: 2 },
    { name: 'GREATEST of text', schema, record: { id: 1, s: 'apple', t: 'banana' }, expr: 'GREATEST(.s, .t)', expect: 'banana' },
    { name: 'LEAST of numbers', schema, record: { id: 1, a: 3, b: 9 }, expr: 'LEAST(.a, .b)', expect: 3 },
    { name: 'LEAST ignores null', schema, record: { id: 1, a: 3, n: null }, expr: 'LEAST(.n, .a)', expect: 3 },
    { name: 'LEAST of only nulls is null', schema, record: { id: 1, n: null, m: null }, expr: 'LEAST(.n, .m)', expect: null },
    { name: 'LEAST of negative numbers', schema, record: { id: 1, a: -3, b: -9 }, expr: 'LEAST(.a, .b)', expect: -9 },
    { name: 'LEAST of three decimals', schema, record: { id: 1, x: '1.5', y: '2.25', z: '-3' }, expr: 'LEAST(.x, .y, .z)', expect: '-3' },
    { name: 'LEAST of text', schema, record: { id: 1, s: 'apple', t: 'banana' }, expr: 'LEAST(.s, .t)', expect: 'apple' }
];
