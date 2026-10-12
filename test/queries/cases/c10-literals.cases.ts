import type { QueryCase } from '../harness.js';

/**
 * Literal-only parts inside real queries (C10). Before C10, Postgres refused
 * `$1 + $2` with "operator is not unique", so each of these failed to run.
 */
const schema = {
    tables: [
        {
            name: 'Item',
            primaryKey: 'id',
            columns: { id: 'INTEGER', a: 'INTEGER', price: 'DECIMAL', meta: 'JSON?' }
        }
    ]
};

const rows = {
    Item: [
        { id: 1, a: 2, price: '10.00', meta: { tags: ['x'] } },
        { id: 2, a: 4, price: '2.50', meta: ['x'] },
        { id: 3, a: 9, price: '1.25', meta: null }
    ]
};

export const cases: QueryCase[] = [
    {
        name: 'WHERE with a literal sum',
        schema,
        rows,
        program: 'FROM Item WHERE .a > 1 + 2 SELECT .id',
        expectRows: [{ id: 2 }, { id: 3 }]
    },
    {
        name: 'WHERE with a literal sum on the left',
        schema,
        rows,
        program: 'FROM Item WHERE 50 + 50 > .a * 20 SELECT .id',
        expectRows: [{ id: 1 }, { id: 2 }]
    },
    {
        name: 'SELECT with a literal factor',
        schema,
        rows,
        program: 'FROM Item WHERE .id == 2 SELECT .price * (1 + 0.2) AS gross',
        expectRows: [{ gross: '3' }]
    },
    {
        name: 'SELECT a literal-only value',
        schema,
        rows,
        program: 'FROM Item WHERE .id == 1 SELECT .id, 1 + 2 AS three',
        expectRows: [{ id: 1, three: 3 }]
    },
    {
        name: 'ORDERBY with a literal part',
        schema,
        rows,
        program: 'FROM Item SELECT .id ORDERBY .a * (0 - 1)',
        ordered: true,
        expectRows: [{ id: 3 }, { id: 2 }, { id: 1 }]
    },
    {
        // `LIMIT` takes a number only (spec §11), so the literal part is in `WHERE` and `ORDERBY`.
        name: 'LIMIT after literal parts',
        schema,
        rows,
        program: 'FROM Item WHERE .a < 2 * 5 SELECT .id ORDERBY .id + (0 - 0) LIMIT 2',
        ordered: true,
        expectRows: [{ id: 1 }, { id: 2 }]
    },
    {
        name: 'a JSON local in WHERE is bound as jsonb',
        schema,
        rows,
        program: 'let config: JSON = { theme: "dark" };\nFROM Item WHERE config is object AND .id < 3 SELECT .id',
        expectRows: [{ id: 1 }, { id: 2 }]
    },
    {
        // A JSON string the caller holds must reach Postgres as JSON text ("dark" with quotes), not as plain text.
        name: 'a JSON string from a local is bound as jsonb',
        schema,
        rows,
        program: 'let theme: JSON = CAST("\\"dark\\"" AS JSON);\nFROM Item WHERE theme is string AND .id == 1 SELECT .id',
        expectRows: [{ id: 1 }]
    },
    {
        // The same for a null test: C9 reads a JSON `null` as SQL `NULL` with `NULLIF(x, 'null'::jsonb)`.
        name: 'a JSON string from a local in a null test is bound as jsonb',
        schema,
        rows,
        program: 'let theme: JSON = CAST("\\"dark\\"" AS JSON);\nFROM Item WHERE theme isnot null AND .id == 1 SELECT .id',
        expectRows: [{ id: 1 }]
    },
    {
        name: 'a JSON column kind test in WHERE',
        schema,
        rows,
        program: 'FROM Item WHERE .meta is array SELECT .id',
        expectRows: [{ id: 2 }]
    },
    {
        name: 'a JSON column kind test with isnot',
        schema,
        rows,
        program: 'FROM Item WHERE .meta isnot object SELECT .id',
        expectRows: [{ id: 2 }, { id: 3 }]
    },
    {
        name: 'a function that reads only its parameters is still inlined',
        schema,
        rows,
        program: 'fn gross(p: DECIMAL): DECIMAL { p * (1 + 0.2) }\nFROM Item WHERE .id == 3 SELECT gross(.price) AS g',
        expectRows: [{ g: '1.5' }]
    }
];
