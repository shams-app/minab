import type { QueryCase } from '../harness.js';

/**
 * Production plan phase V4 (the 1.0 review): `GROUPBY` on a path through a relation. Each case
 * passed `check` before and then Postgres refused the SQL (42803, "must appear in the GROUP BY
 * clause" or "subquery uses ungrouped column").
 * - The path of a key written again in `SELECT` is the key.
 * - A key whose value is a record (`GROUPBY .customer.region`) is read with `KEY.<field>`.
 */
const schema = {
    tables: [
        { name: 'Region', primaryKey: 'id', columns: { id: 'TEXT', name: 'TEXT', label: { type: 'TEXT', sqlName: 'region_label' } } },
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: {
                id: 'TEXT',
                name: 'TEXT',
                country: { type: 'TEXT?', sqlName: 'country_code' },
                region: { ref: 'Region', foreignKey: 'region_id' }
            }
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: { id: 'TEXT', customer: { ref: 'Customer', foreignKey: 'customer_id' }, total: 'DECIMAL' }
        }
    ]
};

const rows = {
    Region: [
        { id: 'eu', name: 'Europe', label: 'EU' },
        { id: 'as', name: 'Asia', label: 'AS' }
    ],
    Customer: [
        { id: 'ada', name: 'Ada', country: 'NL', region_id: 'eu' },
        { id: 'bob', name: 'Bob', country: 'DE', region_id: 'eu' },
        { id: 'cem', name: 'Cem', country: 'TR', region_id: 'as' }
    ],
    Order: [
        { id: 'o1', customer_id: 'ada', total: 10 },
        { id: 'o2', customer_id: 'ada', total: 5 },
        { id: 'o3', customer_id: 'bob', total: 7 },
        { id: 'o4', customer_id: 'cem', total: 1 }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'the path of the key again in SELECT is the key',
        schema,
        rows,
        program: 'FROM Order GROUPBY .customer.country SELECT .customer.country AS c, SUM(.total) AS t ORDERBY c',
        ordered: true,
        expectRows: [
            { c: 'DE', t: '7' },
            { c: 'NL', t: '15' },
            { c: 'TR', t: '1' }
        ]
    },
    {
        name: 'a key that is a record: KEY.name reads it',
        schema,
        rows,
        program: 'FROM Order GROUPBY .customer.region SELECT KEY.name AS r, SUM(.total) AS t ORDERBY r',
        ordered: true,
        expectRows: [
            { r: 'Asia', t: '1' },
            { r: 'Europe', t: '22' }
        ]
    },
    {
        name: 'a key that is a record: a column with a sqlName',
        schema,
        rows,
        program: 'FROM Order GROUPBY .customer.region SELECT KEY.label AS l, COUNT(.) AS n ORDERBY l',
        ordered: true,
        expectRows: [
            { l: 'AS', n: 1 },
            { l: 'EU', n: 3 }
        ]
    },
    {
        name: 'a key that is a record, in HAVING',
        schema,
        rows,
        program: 'FROM Order GROUPBY .customer.region HAVING SUM(.total) > 5 SELECT KEY.name AS r',
        expectRows: [{ r: 'Europe' }]
    }
];
