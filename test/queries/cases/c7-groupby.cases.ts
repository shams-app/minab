import type { QueryCase } from '../harness.js';

/** Orders, customers and regions: one and two hops, and an order with no customer. */
const schema = {
    tables: [
        {
            name: 'Region',
            primaryKey: 'id',
            columns: { id: 'TEXT', name: 'TEXT' }
        },
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: {
                id: 'TEXT',
                name: 'TEXT',
                country: 'TEXT?',
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
        { id: 'eu', name: 'Europe' },
        { id: 'na', name: 'North America' }
    ],
    Customer: [
        { id: 'ada', name: 'Ada', country: 'NL', region_id: 'eu' },
        { id: 'bob', name: 'Bob', country: 'NL', region_id: 'eu' },
        { id: 'grace', name: 'Grace', country: 'US', region_id: 'na' }
    ],
    Order: [
        { id: 'o1', customer_id: 'ada', total: 800 },
        { id: 'o2', customer_id: 'bob', total: 100 },
        { id: 'o3', customer_id: 'grace', total: 50 },
        { id: 'o4', customer_id: null, total: 7 }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'group by a field one hop away',
        schema,
        rows,
        program: `FROM Order GROUPBY .customer.country SELECT KEY AS country, SUM(.total) AS revenue ORDERBY revenue DESC`,
        expectRows: [
            { country: 'NL', revenue: 900 },
            { country: 'US', revenue: 50 },
            { country: null, revenue: 7 }
        ],
        ordered: true
    },
    {
        name: 'group by a field two hops away',
        schema,
        rows,
        program: `FROM Order GROUPBY .customer.region.name SELECT KEY AS region, COUNT(.) AS orders ORDERBY orders DESC, region ASC`,
        expectRows: [
            { region: 'Europe', orders: 2 },
            { region: 'North America', orders: 1 },
            { region: null, orders: 1 }
        ],
        ordered: true
    },
    {
        name: 'an order with no customer forms one null group',
        schema,
        rows,
        program: `FROM Order GROUPBY .customer.country SELECT KEY AS country, COUNT(.) AS orders`,
        expectRows: [
            { country: 'NL', orders: 2 },
            { country: 'US', orders: 1 },
            { country: null, orders: 1 }
        ]
    },
    {
        name: 'HAVING and ORDERBY use the key',
        schema,
        rows,
        program: `
            FROM Order
            GROUPBY .customer.country
            HAVING KEY != "US"
            SELECT KEY AS country, SUM(.total) AS revenue
            ORDERBY KEY ASC`,
        expectRows: [
            { country: 'NL', revenue: 900 },
            { country: null, revenue: 7 }
        ],
        ordered: true
    },
    {
        name: 'group by a relation still works',
        schema,
        rows,
        program: `FROM Order GROUPBY .customer SELECT KEY.name AS customer, SUM(.total) AS spent ORDERBY spent DESC`,
        expectRows: [
            { customer: 'Ada', spent: 800 },
            { customer: 'Bob', spent: 100 },
            { customer: 'Grace', spent: 50 },
            { customer: null, spent: 7 }
        ],
        ordered: true
    }
];
