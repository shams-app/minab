import type { QueryCase } from '../harness.js';

/**
 * Keys of a `JSON` value inside real queries (Shamsine card M.1b, spec §7.3.1). A key is read per row;
 * a row with no object gives `null`. In a grouped query `COUNT(.meta)` is still the count of the group.
 */
const schema = {
    tables: [{ name: 'Doc', primaryKey: 'id', columns: { id: 'INTEGER', label: 'TEXT', meta: 'JSON?' } }]
};

const rows = {
    Doc: [
        { id: 1, label: 'x', meta: { lat: 10, name: 'a', tags: [1, 2, 3] } },
        { id: 2, label: 'x', meta: { lat: 20, name: 'b', tags: [] } },
        { id: 3, label: 'x', meta: null },
        { id: 4, label: 'y', meta: [1] }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'WHERE on a cast key',
        schema,
        rows,
        program: 'FROM Doc WHERE CAST(.meta.lat AS DECIMAL) > 15 SELECT .id',
        expectRows: [{ id: 2 }]
    },
    {
        name: 'SELECT a key: a row with no object gives null',
        schema,
        rows,
        program: 'FROM Doc SELECT .id, .meta.name AS name',
        expectRows: [
            { id: 1, name: 'a' },
            { id: 2, name: 'b' },
            { id: 3, name: null },
            { id: 4, name: null }
        ]
    },
    {
        name: 'a text key per row',
        schema,
        rows,
        program: 'FROM Doc WHERE CAST(.meta["name"] AS TEXT) == "b" SELECT .id',
        expectRows: [{ id: 2 }]
    },
    {
        name: 'a position per row: an array and a missing array give null',
        schema,
        rows,
        program: 'FROM Doc SELECT .id, CAST(.meta.tags[1] AS INTEGER) AS second',
        expectRows: [
            { id: 1, second: 2 },
            { id: 2, second: null },
            { id: 3, second: null },
            { id: 4, second: null }
        ]
    },
    {
        name: 'COUNT of an array per row',
        schema,
        rows,
        program: 'FROM Doc SELECT .id, COUNT(.meta.tags) AS n',
        expectRows: [
            { id: 1, n: 3 },
            { id: 2, n: 0 },
            { id: 3, n: 0 },
            { id: 4, n: 0 }
        ]
    },
    {
        name: 'a kind test of a key in WHERE',
        schema,
        rows,
        program: 'FROM Doc WHERE .meta.tags is array SELECT .id',
        expectRows: [{ id: 1 }, { id: 2 }]
    },
    {
        name: 'ORDERBY a cast key',
        schema,
        rows,
        program: 'FROM Doc WHERE .meta.lat is number SELECT .id ORDERBY CAST(.meta.lat AS DECIMAL) DESC',
        expectRows: [{ id: 2 }, { id: 1 }],
        ordered: true
    },
    {
        name: 'in a grouped query COUNT(.meta) is still the count of the group',
        schema,
        rows,
        program: 'FROM Doc GROUPBY .label SELECT .label, COUNT(.meta) AS n',
        expectRows: [
            { label: 'x', n: 2 },
            { label: 'y', n: 1 }
        ]
    }
];
