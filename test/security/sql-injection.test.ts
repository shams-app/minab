/**
 * Phase Q3: no program, name or value can change the shape of the SQL.
 *
 * Names (a table, a column, a `sqlName`) are quoted. Values are always `$n` parameters.
 * Run on PGlite (or on Postgres when `MINAB_TEST_DATABASE_URL` is set).
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { databaseScript } from '../../src/host/ddl.js';
import { createMinab, type DataPort } from '../../src/runtime/index.js';
import { parseConfig } from '../../src/host/config.js';
import { openTestDatabase, type TestDatabase } from '../support/database.js';

/** Physical names that try to break out of a quoted name. */
const EVIL_TABLE = 'it"em"; DROP TABLE victim; --';
const EVIL_COLUMN = `la'bel"; DROP TABLE victim; --`;
const TICK_TABLE = 'tick`s;\\n--';
const UNICODE_TABLE = 'کالا_طلا_ß_日本';

/** Values that try to break out of a string. */
const EVIL_VALUES = [
    `x'; DROP TABLE victim; --`,
    `quote" and 'single'`,
    'back\\slash\\',
    'semi;colon -- comment',
    'tick`tick',
    '𝒳 ünï ✓ ی',
    `'); DELETE FROM victim; --`
];

const schema = parseConfig({
    schema: {
        tables: [
            {
                name: 'Item',
                sqlName: EVIL_TABLE,
                primaryKey: 'id',
                columns: [
                    { name: 'id', type: 'INTEGER' },
                    { name: 'label', sqlName: EVIL_COLUMN, type: 'TEXT' }
                ]
            },
            { name: 'Tick', sqlName: TICK_TABLE, primaryKey: 'id', columns: { id: 'INTEGER', name: 'TEXT' } },
            { name: 'Kala', sqlName: UNICODE_TABLE, primaryKey: 'id', columns: { id: 'INTEGER', name: 'TEXT' } }
        ]
    }
}).schema;

let database: TestDatabase;
beforeAll(async () => {
    database = await openTestDatabase();
}, 60_000);
afterAll(async () => {
    await database?.close();
});

const rows = {
    Item: [
        { id: 1, label: EVIL_VALUES[0] },
        { id: 2, label: EVIL_VALUES[2] },
        { id: 3, label: 'plain' }
    ],
    Tick: [{ id: 1, name: EVIL_VALUES[4] }],
    Kala: [{ id: 1, name: EVIL_VALUES[5] }]
};
const SETUP = `${databaseScript(schema, rows)}
CREATE TABLE victim (id integer PRIMARY KEY);
INSERT INTO victim VALUES (1), (2);`;

/** A data port that keeps the SQL it sent. */
function recordingPort(): DataPort & { sent: { text: string; params: unknown[] }[] } {
    const port = {
        sent: [] as { text: string; params: unknown[] }[],
        execute: async (query: { text: string; params: unknown[] }) => {
            port.sent.push({ text: query.text, params: query.params });
            return database.executor.execute(query as never);
        }
    };
    return port as never;
}

async function run(source: string) {
    const program = await createMinab({ schema }).prepare(source);
    expect(program.diagnostics).toEqual([]);
    const port = recordingPort();
    const result = await database.isolated(SETUP, async () => {
        const result = await program.run({}, { data: port });
        const victim = await database.query('SELECT count(*)::int AS n FROM victim');
        return { result, victim: victim[0].n };
    });
    return { ...result, sent: port.sent, compiled: program.compile() };
}

const literal = (value: string) => JSON.stringify(value);

describe('names are quoted', () => {
    test('a table and a column with quotes, semicolons and comments in their sqlName work, and nothing else runs', async () => {
        const { result, victim, sent } = await run('FROM Item WHERE .id == 3 SELECT .id, .label');
        expect(result).toMatchObject({ ok: true });
        expect(JSON.stringify((result as { value: unknown }).value)).toContain('plain');
        expect(victim).toBe(2);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain('"it""em""; DROP TABLE victim; --"');
        expect(sent[0].text).toContain(`"la'bel""; DROP TABLE victim; --"`);
    });

    test('a table whose sqlName has a backtick and a backslash works', async () => {
        const { result, victim } = await run('FROM Tick SELECT .name');
        expect(result).toMatchObject({ ok: true });
        expect(JSON.stringify((result as { value: unknown }).value)).toContain('tick`tick');
        expect(victim).toBe(2);
    });

    test('a table whose sqlName is Persian, German and Japanese text works', async () => {
        const { result } = await run('FROM Kala SELECT .name');
        expect(result).toMatchObject({ ok: true });
        expect(JSON.stringify((result as { value: unknown }).value)).toContain('ی');
    });

    test('a program cannot name a table that is not in the schema: scope error, no SQL', async () => {
        const program = await createMinab({ schema }).prepare('FROM victim SELECT .id');
        expect(program.ok).toBe(false);
        expect(program.compile()).toMatchObject({ ok: false });
    });
});

describe('values are parameters', () => {
    test.each(EVIL_VALUES)('the string %j never appears in the SQL text', async value => {
        const { result, victim, sent } = await run(`FROM Item WHERE .label == ${literal(value)} SELECT .id`);
        expect(result).toMatchObject({ ok: true });
        expect(victim).toBe(2);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).not.toContain(value);
        expect(sent[0].text).not.toContain('DROP TABLE victim; --"\n');
        expect(sent[0].text).toMatch(/\$1/);
        expect(sent[0].params).toContain(value);
    });

    test('a value that matches a stored row finds it (the parameter carries the exact text)', async () => {
        const { result } = await run(`FROM Item WHERE .label == ${literal(EVIL_VALUES[0])} SELECT .id`);
        expect(JSON.stringify((result as { value: unknown }).value)).toContain('1');
    });

    test('the same holds in IN, LIKE and function arguments', async () => {
        for (const value of EVIL_VALUES) {
            const { result, victim, sent } = await run(
                `FROM Item WHERE .label IN [${literal(value)}, "b"] OR .label LIKE ${literal(value)} OR UPPER(.label) == UPPER(${literal(value)}) SELECT .id`
            );
            expect(result).toMatchObject({ ok: true });
            expect(victim).toBe(2);
            for (const query of sent) expect(query.text).not.toContain(value);
        }
    });

    test('a quoted (backtick) column name in the program is a name, never SQL text', async () => {
        const { compiled } = await run('FROM Item WHERE .`id` == 3 SELECT .`label`');
        expect(compiled).toMatchObject({ ok: true });
    });

    test('a value from the record or a host input is a parameter too', async () => {
        const minab = createMinab({ schema, ruleContext: { recordTable: 'Item', isFieldRule: false }, inputs: { term: 'TEXT' } });
        const program = await minab.prepare('EXISTS(#Item[.label == term])');
        expect(program.diagnostics).toEqual([]);
        const port = recordingPort();
        const result = await database.isolated(SETUP, () => program.run({ record: { id: 1 }, hostInputs: { term: EVIL_VALUES[0] } }, { data: port }));
        expect(result).toMatchObject({ ok: true, value: true });
        expect(port.sent[0].text).not.toContain(EVIL_VALUES[0]);
        expect(port.sent[0].params).toContain(EVIL_VALUES[0]);
    });
});
