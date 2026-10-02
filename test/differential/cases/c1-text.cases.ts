import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

const record = { id: 1, s: 'hello world' };

export const cases: DifferentialCase[] = [
    { name: 'text equality', schema, record, expr: '.s == "hello world"', expect: true },
    { name: 'text equality is case sensitive', schema, record, expr: '.s == "Hello World"', expect: false },
    { name: 'text ordering', schema, record, expr: '.s < "world"', expect: true },
    { name: 'LIKE with % at the end', schema, record, expr: '.s LIKE "hello%"', expect: true },
    { name: 'LIKE with % at the start', schema, record, expr: '.s LIKE "%world"', expect: true },
    { name: 'LIKE with % in the middle', schema, record, expr: '.s LIKE "h%d"', expect: true },
    { name: 'LIKE with _ for one character', schema, record, expr: '.s LIKE "hell_ world"', expect: true },
    { name: 'LIKE with _ needs exactly one character', schema, record, expr: '.s LIKE "hell__ world"', expect: false },
    { name: 'LIKE without a wildcard is exact', schema, record, expr: '.s LIKE "hello"', expect: false },
    { name: 'LIKE is case sensitive', schema, record, expr: '.s LIKE "HELLO%"', expect: false },
    { name: 'IN on text', schema, record, expr: '.s IN ["a", "hello world"]', expect: true }
];
