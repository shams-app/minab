import type { QueryCase } from '../harness.js';

const schema = {
    tables: [
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: { id: 'TEXT', name: 'TEXT', country: 'TEXT' }
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: {
                id: 'TEXT',
                customer: { ref: 'Customer', foreignKey: 'customer_id' },
                status: 'TEXT',
                total: 'INTEGER'
            }
        }
    ]
};

const rows = {
    Customer: [
        { id: 'ada', name: 'Ada', country: 'UK' },
        { id: 'grace', name: 'Grace', country: 'US' }
    ],
    Order: [
        { id: 'o1', customer_id: 'ada', status: 'paid', total: 800 },
        { id: 'o2', customer_id: 'ada', status: 'paid', total: 100 },
        { id: 'o3', customer_id: 'grace', status: 'paid', total: 50 },
        { id: 'o4', customer_id: 'grace', status: 'open', total: 10 },
        { id: 'o5', customer_id: 'ada', status: 'open', total: 20 }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'KEY.name with two keys: a field and a relation field with AS',
        schema,
        rows,
        program: `FROM Order GROUPBY .status, .customer.country AS country SELECT KEY.status AS s, KEY.country AS c, COUNT(.) AS n`,
        expectRows: [
            { s: 'paid', c: 'UK', n: 2 },
            { s: 'paid', c: 'US', n: 1 },
            { s: 'open', c: 'US', n: 1 },
            { s: 'open', c: 'UK', n: 1 }
        ]
    },
    {
        name: 'KEY.name in HAVING and ORDERBY',
        schema,
        rows,
        program: `FROM Order GROUPBY .status, .customer.country AS country HAVING KEY.country == "UK" SELECT KEY.status AS s, SUM(.total) AS t ORDERBY KEY.status DESC`,
        ordered: true,
        expectRows: [
            { s: 'paid', t: 900 },
            { s: 'open', t: 20 }
        ]
    },
    {
        name: 'a computed key with AS can be read by its name',
        schema,
        rows,
        program: `FROM Order GROUPBY .status, .total / 100 AS bucket HAVING KEY.bucket >= 1 SELECT KEY.status AS s, KEY.bucket AS b, COUNT(.) AS n`,
        expectRows: [
            { s: 'paid', b: 8, n: 1 },
            { s: 'paid', b: 1, n: 1 }
        ]
    },
    {
        name: 'one key: KEY is unchanged',
        schema,
        rows,
        program: `FROM Order GROUPBY .status SELECT KEY AS s, COUNT(.) AS n`,
        expectRows: [
            { s: 'paid', n: 3 },
            { s: 'open', n: 2 }
        ]
    },
    {
        name: 'a simple user function in WHERE and SELECT is inlined',
        schema,
        rows,
        program: `fn net(t: INTEGER): INTEGER { t * 9 / 10 }\nFROM Order WHERE net(.total) > 40 SELECT .id AS id, net(.total) AS n`,
        expectRows: [
            { id: 'o1', n: 720 },
            { id: 'o2', n: 90 },
            { id: 'o3', n: 45 }
        ]
    },
    {
        name: 'an argument used twice, and a function that calls another',
        schema,
        rows,
        program: `fn twice(a: INTEGER): INTEGER { a + a }\nfn four(a: INTEGER): INTEGER { twice(twice(a)) }\nFROM Order WHERE four(.total + 1) == 84 SELECT .id AS id`,
        expectRows: [{ id: 'o5' }]
    },
    {
        name: 'a function with an if inside a query',
        schema,
        rows,
        program: `fn big(t: INTEGER): TEXT { if t >= 100 { "big" } else { "small" } }\nFROM Order SELECT .id AS id, big(.total) AS size`,
        expectRows: [
            { id: 'o1', size: 'big' },
            { id: 'o2', size: 'big' },
            { id: 'o3', size: 'small' },
            { id: 'o4', size: 'small' },
            { id: 'o5', size: 'small' }
        ]
    }
];
