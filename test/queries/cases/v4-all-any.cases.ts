import type { QueryCase } from '../harness.js';

/**
 * Production plan phase V4 (the 1.0 review): `ALL` and `ANY` (spec §5.3.1) had no SQL form, so a
 * query that `check` accepted failed at run time ("ALL has no SQL form yet"). A `null` is not true,
 * as in the interpreter: `ALL` of a collection with a `null` is `false`, and an empty collection is
 * `true` for `ALL` and `false` for `ANY`.
 */
const schema = {
    tables: [
        { name: 'Customer', primaryKey: 'id', columns: { id: 'TEXT', name: 'TEXT', orders: { collection: 'Order', foreignKey: 'customer_id' } } },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: { id: 'TEXT', customer: { ref: 'Customer', foreignKey: 'customer_id' }, paid: 'BOOLEAN?', total: 'DECIMAL' }
        }
    ]
};

const rows = {
    Customer: [
        { id: 'ada', name: 'Ada' },
        { id: 'bob', name: 'Bob' },
        { id: 'cem', name: 'Cem' },
        { id: 'dan', name: 'Dan' }
    ],
    Order: [
        { id: 'o1', customer_id: 'ada', paid: true, total: 10 },
        { id: 'o2', customer_id: 'ada', paid: true, total: 20 },
        { id: 'o3', customer_id: 'bob', paid: false, total: 30 },
        { id: 'o4', customer_id: 'bob', paid: true, total: 40 },
        { id: 'o5', customer_id: 'dan', paid: null, total: 50 },
        { id: 'o6', customer_id: 'dan', paid: true, total: 60 }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'ALL of a relation column: no order that is not paid (Cem has none; a null is not paid)',
        schema,
        rows,
        program: 'FROM Customer WHERE ALL(.orders.paid) SELECT .name',
        expectRows: [{ name: 'Ada' }, { name: 'Cem' }]
    },
    {
        name: 'ANY of a relation column: at least one paid order',
        schema,
        rows,
        program: 'FROM Customer WHERE ANY(.orders.paid) SELECT .name',
        expectRows: [{ name: 'Ada' }, { name: 'Bob' }, { name: 'Dan' }]
    },
    {
        name: 'ALL and ANY over a filtered relation',
        schema,
        rows,
        program: 'FROM Customer WHERE ANY(.orders[.total > 25].paid) AND NOT ALL(.orders[.total > 25].paid) SELECT .name',
        expectRows: [{ name: 'Bob' }, { name: 'Dan' }]
    },
    {
        name: 'ALL and ANY as values in SELECT',
        schema,
        rows,
        program: 'FROM Customer SELECT .name, ALL(.orders.paid) AS allPaid, ANY(.orders.paid) AS anyPaid ORDERBY .name',
        ordered: true,
        expectRows: [
            { name: 'Ada', allPaid: true, anyPaid: true },
            { name: 'Bob', allPaid: false, anyPaid: true },
            { name: 'Cem', allPaid: true, anyPaid: false },
            { name: 'Dan', allPaid: false, anyPaid: true }
        ]
    }
];
