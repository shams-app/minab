import type { QueryCase } from '../harness.js';

/** The shop used by the first query cases: customers, their orders, and orders with no customer. */
const schema = {
    tables: [
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: { id: 'TEXT', name: 'TEXT', country: 'TEXT?', orders: { collection: 'Order', foreignKey: 'customer_id' } }
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: { id: 'TEXT', customer: { ref: 'Customer', foreignKey: 'customer_id' }, status: 'TEXT', total: 'DECIMAL' }
        }
    ]
};

const rows = {
    Customer: [
        { id: 'ada', name: 'Ada', country: 'NL' },
        { id: 'grace', name: 'Grace', country: 'US' },
        { id: 'linus', name: 'Linus', country: null }
    ],
    Order: [
        { id: 'o1', customer_id: 'ada', status: 'paid', total: 800 },
        { id: 'o2', customer_id: 'ada', status: 'paid', total: 900 },
        { id: 'o3', customer_id: 'grace', status: 'cancelled', total: 300 },
        { id: 'o4', customer_id: 'grace', status: 'paid', total: 50 }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'filter',
        schema,
        rows,
        program: `FROM Order WHERE .status == "paid" SELECT .id AS id`,
        expectRows: [{ id: 'o1' }, { id: 'o2' }, { id: 'o4' }]
    },
    {
        name: 'project and order',
        schema,
        rows,
        program: `FROM Order SELECT .id AS id, .total AS total ORDERBY total DESC LIMIT 2`,
        expectRows: [
            { id: 'o2', total: 900 },
            { id: 'o1', total: 800 }
        ],
        ordered: true
    },
    {
        name: 'filter through a ref',
        schema,
        rows,
        program: `FROM Order WHERE .customer.country == "NL" SELECT .id AS id ORDERBY id ASC`,
        expectRows: [{ id: 'o1' }, { id: 'o2' }],
        ordered: true
    },
    {
        name: 'group by a relation',
        schema,
        rows,
        program: `
            FROM Order
            GROUPBY .customer
            HAVING SUM(.total) > 500
            SELECT KEY.name AS customer, SUM(.total) AS spent, COUNT(.) AS orders
            ORDERBY spent DESC`,
        expectRows: [{ customer: 'Ada', spent: 1700, orders: 2 }],
        ordered: true
    },
    {
        name: 'aggregate over a relation',
        schema,
        rows,
        program: `FROM Customer SELECT .name AS name, COUNT(.orders) AS orders, SUM(.orders.total) AS spent ORDERBY name ASC`,
        expectRows: [
            { name: 'Ada', orders: 2, spent: 1700 },
            { name: 'Grace', orders: 2, spent: 350 },
            { name: 'Linus', orders: 0, spent: null }
        ],
        ordered: true
    },
    {
        name: 'EXISTS over a filtered relation',
        schema,
        rows,
        program: `FROM Customer WHERE EXISTS(.orders[.status == "cancelled"]) SELECT .name AS name`,
        expectRows: [{ name: 'Grace' }]
    },
    {
        name: 'NOT EXISTS finds customers with no orders',
        schema,
        rows,
        program: `FROM Customer WHERE NOT EXISTS(.orders) SELECT .name AS name`,
        expectRows: [{ name: 'Linus' }]
    },
    {
        name: 'LEFTJOIN keeps the customer with no orders',
        schema,
        rows,
        program: `
            FROM Customer AS c
            LEFTJOIN Order AS o ON o.customer.id == c.id
            SELECT c.name AS name, o.id AS order_id
            ORDERBY name ASC, order_id ASC`,
        expectRows: [
            { name: 'Ada', order_id: 'o1' },
            { name: 'Ada', order_id: 'o2' },
            { name: 'Grace', order_id: 'o3' },
            { name: 'Grace', order_id: 'o4' },
            { name: 'Linus', order_id: null }
        ],
        ordered: true
    }
];
