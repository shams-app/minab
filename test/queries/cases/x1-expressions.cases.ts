import type { QueryCase } from '../harness.js';

const schema = {
    tables: [
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: {
                id: 'TEXT',
                name: 'TEXT',
                orders: { collection: 'Order', foreignKey: 'customer_id' }
            }
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: {
                id: 'TEXT',
                customer: { ref: 'Customer?', foreignKey: 'customer_id' },
                status: 'TEXT',
                note: 'TEXT?',
                total: 'INTEGER'
            }
        },
        {
            name: 'Event',
            primaryKey: 'id',
            columns: { id: 'TEXT', payload: 'JSON' }
        }
    ]
};

const rows = {
    Customer: [
        { id: 'ada', name: 'Ada' },
        { id: 'grace', name: 'Grace' }
    ],
    Order: [
        { id: 'o1', customer_id: 'ada', status: 'paid', note: 'a', total: 800 },
        {
            id: 'o2',
            customer_id: 'ada',
            status: 'cancelled',
            note: null,
            total: 900
        },
        { id: 'o3', customer_id: 'grace', status: 'paid', note: null, total: 50 },
        { id: 'o4', customer_id: null, status: 'open', note: 'b', total: 10 }
    ],
    Event: [
        { id: 'e1', payload: [1, 2] },
        { id: 'e2', payload: { a: 1 } },
        { id: 'e3', payload: 'text' }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'switch in SELECT',
        schema,
        rows,
        program: `FROM Order SELECT .id AS id, switch .status { "paid" => 1, "open", "cancelled" => 2, _ => 3 } AS s`,
        expectRows: [
            { id: 'o1', s: 1 },
            { id: 'o2', s: 2 },
            { id: 'o3', s: 1 },
            { id: 'o4', s: 2 }
        ]
    },
    {
        name: 'switch with a null case',
        schema,
        rows,
        program: `FROM Order SELECT .id AS id, switch .note { null => "none", "a" => "A", _ => "other" } AS s`,
        expectRows: [
            { id: 'o1', s: 'A' },
            { id: 'o2', s: 'none' },
            { id: 'o3', s: 'none' },
            { id: 'o4', s: 'other' }
        ]
    },
    {
        name: 'if and else if',
        schema,
        rows,
        program: `FROM Order SELECT .id AS id, if .total > 500 { "big" } else if .total > 20 { "mid" } else { "small" } AS size`,
        expectRows: [
            { id: 'o1', size: 'big' },
            { id: 'o2', size: 'big' },
            { id: 'o3', size: 'mid' },
            { id: 'o4', size: 'small' }
        ]
    },
    {
        name: 'if with no else is null',
        schema,
        rows,
        program: `FROM Order SELECT .id AS id, if .total > 500 { "big" } AS size`,
        expectRows: [
            { id: 'o1', size: 'big' },
            { id: 'o2', size: 'big' },
            { id: 'o3', size: null },
            { id: 'o4', size: null }
        ]
    },
    {
        name: 'is null on a ref',
        schema,
        rows,
        program: `FROM Order WHERE .customer is null SELECT .id AS id`,
        expectRows: [{ id: 'o4' }]
    },
    {
        name: 'isnot null',
        schema,
        rows,
        program: `FROM Order WHERE .note isnot null SELECT .id AS id`,
        expectRows: [{ id: 'o1' }, { id: 'o4' }]
    },
    {
        name: 'a JSON object literal',
        schema,
        rows,
        program: `FROM Order WHERE .id == "o1" SELECT { id: .id, t: .total, tags: ["x", "y"], meta: { ok: true } } AS o`,
        expectRows: [{ o: { id: 'o1', t: 800, tags: ['x', 'y'], meta: { ok: true } } }]
    },
    {
        name: 'is array on a JSON column',
        schema,
        rows,
        program: `FROM Event WHERE .payload is array SELECT .id AS id`,
        expectRows: [{ id: 'e1' }]
    },
    {
        name: 'isnot object on a JSON column',
        schema,
        rows,
        program: `FROM Event WHERE .payload isnot object SELECT .id AS id`,
        expectRows: [{ id: 'e1' }, { id: 'e3' }]
    },
    {
        name: 'is string on a JSON column',
        schema,
        rows,
        program: `FROM Event WHERE .payload is string SELECT .id AS id`,
        expectRows: [{ id: 'e3' }]
    },
    {
        name: 'FROM a filtered related collection, inside a customer rule',
        schema,
        rows,
        record: { table: 'Customer', row: { id: 'ada', name: 'Ada' } },
        program: `FROM .orders[.status == "paid"] SELECT .id AS id`,
        expectRows: [{ id: 'o1' }]
    },
    {
        name: 'FROM a related collection with a WHERE',
        schema,
        rows,
        record: { table: 'Customer', row: { id: 'ada', name: 'Ada' } },
        program: `FROM .orders WHERE .total > 850 SELECT .id AS id`,
        expectRows: [{ id: 'o2' }]
    }
];
