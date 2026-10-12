import type { QueryCase } from '../harness.js';

/**
 * `IN` with a subquery, `NOT IN`, and a `WHERE` on a nullable column (C9, D46).
 * In a `WHERE` the compiler may keep a plain comparison (`NULL` and `FALSE` drop the same rows);
 * under `NOT` it must not.
 */

const schema = {
    tables: [
        {
            name: 'Item',
            primaryKey: 'id',
            columns: { id: 'INTEGER', n: 'INTEGER?', t: 'TEXT?', tag: 'TEXT?' }
        },
        {
            name: 'Tag',
            primaryKey: 'id',
            columns: { id: 'INTEGER', name: 'TEXT?', vip: 'BOOLEAN' }
        }
    ]
};

const rows = {
    Item: [
        { id: 1, n: 1, t: 'apple', tag: 'red' },
        { id: 2, n: 7, t: 'banana', tag: 'blue' },
        { id: 3, n: null, t: null, tag: null }
    ],
    Tag: [
        { id: 1, name: 'red', vip: true },
        { id: 2, name: 'blue', vip: false },
        { id: 3, name: null, vip: true }
    ]
};

const ids = (...list: number[]) => list.map(id => ({ id }));

export const cases: QueryCase[] = [
    { name: 'WHERE .n < 5 drops a null n', schema, rows, program: 'FROM Item WHERE .n < 5 SELECT .id', expectRows: ids(1) },
    { name: 'WHERE NOT (.n < 5) keeps a null n', schema, rows, program: 'FROM Item WHERE NOT (.n < 5) SELECT .id', expectRows: ids(2, 3) },
    { name: 'WHERE .n < 5 OR .n > 5 drops a null n', schema, rows, program: 'FROM Item WHERE .n < 5 OR .n > 5 SELECT .id', expectRows: ids(1, 2) },
    {
        name: 'WHERE NOT (.n < 5 AND .t LIKE "a%") keeps a null n',
        schema,
        rows,
        program: 'FROM Item WHERE NOT (.n < 5 AND .t LIKE "a%") SELECT .id',
        expectRows: ids(2, 3)
    },
    { name: 'WHERE (.n < 5) == false keeps a null n', schema, rows, program: 'FROM Item WHERE (.n < 5) == false SELECT .id', expectRows: ids(2, 3) },
    {
        name: 'SELECT .n >= 5 gives false for a null n',
        schema,
        rows,
        program: 'FROM Item SELECT .id, .n >= 5 AS big ORDERBY .id',
        ordered: true,
        expectRows: [
            { id: 1, big: false },
            { id: 2, big: true },
            { id: 3, big: false }
        ]
    },
    { name: 'WHERE .n IN a list with null finds a null n', schema, rows, program: 'FROM Item WHERE .n IN [1, null] SELECT .id', expectRows: ids(1, 3) },
    { name: 'WHERE NOT (.n IN a list) keeps a null n', schema, rows, program: 'FROM Item WHERE NOT (.n IN [1, 2]) SELECT .id', expectRows: ids(2, 3) },
    { name: 'WHERE IN a subquery', schema, rows, program: 'FROM Item WHERE .tag IN (FROM Tag WHERE .vip SELECT .name) SELECT .id', expectRows: ids(1, 3) },
    {
        name: 'WHERE NOT IN a subquery',
        schema,
        rows,
        program: 'FROM Item WHERE NOT (.tag IN (FROM Tag WHERE .vip SELECT .name)) SELECT .id',
        expectRows: ids(2)
    },
    {
        name: 'WHERE NOT IN a subquery with no null',
        schema,
        rows,
        program: 'FROM Item WHERE NOT (.tag IN (FROM Tag WHERE .name != null SELECT .name)) SELECT .id',
        expectRows: ids(3)
    },
    {
        name: 'SELECT IN a subquery is never null',
        schema,
        rows,
        program: 'FROM Item SELECT .id, .tag IN (FROM Tag WHERE .vip SELECT .name) AS hit ORDERBY .id',
        ordered: true,
        expectRows: [
            { id: 1, hit: true },
            { id: 2, hit: false },
            { id: 3, hit: true }
        ]
    },
    { name: 'ORDERBY a nullable column puts nulls last', schema, rows, program: 'FROM Item SELECT .id ORDERBY .n', ordered: true, expectRows: ids(1, 2, 3) }
];
