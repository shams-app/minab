import type { QueryCase } from '../harness.js';

/** Orders with a `created` column that the SELECT does not list. */
const schema = {
    tables: [
        {
            name: 'Order',
            primaryKey: 'id',
            columns: { id: 'TEXT', total: 'DECIMAL', created: 'INTEGER' }
        }
    ]
};

const rows = {
    Order: [
        { id: 'o1', total: 50, created: 2 },
        { id: 'o2', total: 900, created: 3 },
        { id: 'o3', total: 300, created: 1 }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'ORDERBY a column that SELECT does not list (D18)',
        schema,
        rows,
        program: `FROM Order SELECT .id AS id ORDERBY .created DESC`,
        expectRows: [{ id: 'o2' }, { id: 'o1' }, { id: 'o3' }],
        ordered: true
    },
    {
        name: 'ORDERBY a SELECT alias (D18)',
        schema,
        rows,
        program: `FROM Order SELECT .id AS id, .total AS amount ORDERBY amount DESC`,
        expectRows: [
            { id: 'o2', amount: 900 },
            { id: 'o3', amount: 300 },
            { id: 'o1', amount: 50 }
        ],
        ordered: true
    }
];
