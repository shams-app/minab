import type { DifferentialCase } from '../harness.js';

const schema = {
    tables: [
        {
            name: 'Row',
            primaryKey: 'id',
            columns: {
                id: 'INTEGER',
                s: 'TEXT',
                t: 'TEXT?',
                n: 'INTEGER?',
                a: 'INTEGER',
                j: 'JSON?'
            }
        }
    ]
};

const at = (record: Record<string, unknown>) => ({ id: 1, ...record });

export const cases: DifferentialCase[] = [
    {
        name: 'switch picks an arm',
        schema,
        record: at({ s: 'b' }),
        expr: 'switch .s { "a" => 1, "b" => 2, _ => 3 }',
        expect: 2
    },
    {
        name: 'switch falls to the default',
        schema,
        record: at({ s: 'z' }),
        expr: 'switch .s { "a" => 1, "b" => 2, _ => 3 }',
        expect: 3
    },
    {
        name: 'switch with several values in an arm',
        schema,
        record: at({ s: 'c' }),
        expr: 'switch .s { "a", "c" => "x", _ => "y" }',
        expect: 'x'
    },
    {
        name: 'switch on a null subject goes to the null arm',
        schema,
        record: at({ t: null }),
        expr: 'switch .t { null => "none", _ => "some" }',
        expect: 'none'
    },
    {
        name: 'switch on a null subject with no null arm goes to the default',
        schema,
        record: at({ t: null }),
        expr: 'switch .t { "a" => 1, _ => 2 }',
        expect: 2
    },
    {
        name: 'switch on a value skips the null arm',
        schema,
        record: at({ t: 'a' }),
        expr: 'switch .t { null => "none", "a" => "A", _ => "other" }',
        expect: 'A'
    },
    {
        name: 'switch arm that is a block with only a tail',
        schema,
        record: at({ s: 'a' }),
        expr: 'switch .s { "a" => { "tail" }, _ => "d" }',
        expect: 'tail'
    },
    {
        name: 'if takes the then branch',
        schema,
        record: at({ a: 9 }),
        expr: 'if .a > 5 { "big" } else { "small" }',
        expect: 'big'
    },
    {
        name: 'if takes the else branch',
        schema,
        record: at({ a: 1 }),
        expr: 'if .a > 5 { "big" } else { "small" }',
        expect: 'small'
    },
    {
        name: 'else if chain',
        schema,
        record: at({ a: 3 }),
        expr: 'if .a > 5 { "big" } else if .a > 2 { "mid" } else { "small" }',
        expect: 'mid'
    },
    {
        name: 'if with no else is null',
        schema,
        record: at({ a: 1 }),
        expr: 'if .a > 5 { "big" }',
        expect: null
    },
    {
        name: 'if on a null value compared with == takes the else branch',
        schema,
        record: at({ n: null }),
        expr: 'if .n == 4 { 1 } else { 2 }',
        expect: 2
    },
    {
        name: 'is null on a null',
        schema,
        record: at({ n: null }),
        expr: '.n is null',
        expect: true
    },
    {
        name: 'is null on a value',
        schema,
        record: at({ n: 4 }),
        expr: '.n is null',
        expect: false
    },
    {
        name: 'isnot null on a value',
        schema,
        record: at({ n: 4 }),
        expr: '.n isnot null',
        expect: true
    },
    {
        name: 'isnot null on a null',
        schema,
        record: at({ n: null }),
        expr: '.n isnot null',
        expect: false
    },
    {
        name: 'is object',
        schema,
        record: at({ j: { a: 1 } }),
        expr: '.j is object',
        expect: true
    },
    {
        name: 'is array on an object',
        schema,
        record: at({ j: { a: 1 } }),
        expr: '.j is array',
        expect: false
    },
    {
        name: 'is array on an array',
        schema,
        record: at({ j: [1] }),
        expr: '.j is array',
        expect: true
    },
    {
        name: 'is string',
        schema,
        record: at({ j: 'x' }),
        expr: '.j is string',
        expect: true
    },
    {
        name: 'is number',
        schema,
        record: at({ j: 4 }),
        expr: '.j is number',
        expect: true
    },
    {
        name: 'is boolean',
        schema,
        record: at({ j: true }),
        expr: '.j is boolean',
        expect: true
    },
    {
        name: 'isnot object on an array',
        schema,
        record: at({ j: [1] }),
        expr: '.j isnot object',
        expect: true
    },
    {
        name: 'a JSON object literal',
        schema,
        record: at({ a: 7, s: 'x' }),
        expr: '{ a: .a, s: .s, n: 2, ok: true, list: ["p", "q"] }',
        expect: { a: 7, s: 'x', n: 2, ok: true, list: ['p', 'q'] }
    },
    {
        name: 'a JSON list literal',
        schema,
        record: at({ a: 7 }),
        expr: '[.a, 2, 3]',
        expect: [7, 2, 3]
    }
];
