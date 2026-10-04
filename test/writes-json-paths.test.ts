/**
 * Production plan phase X6 — writes, part 2: `JSON` arrays and record path assignment.
 *
 * Runs on PGlite, or on the Postgres of `MINAB_TEST_DATABASE_URL`. A `JSON` array is read,
 * changed in memory and written back. A path (`.doctor!.name = "x";`) is one `UPDATE`,
 * with a check and a creating statement for each `!` step.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMinab, type RunPorts } from '../src/runtime/index.js';
import { pgWritePort } from '../src/node/index.js';
import { parseConfig } from '../src/host/config.js';
import { openTestDatabase, type TestDatabase } from './support/database.js';

const { schema } = parseConfig({
    schema: {
        tables: [
            {
                name: 'Customer',
                primaryKey: 'id',
                columns: {
                    id: 'INTEGER',
                    name: 'TEXT',
                    points: 'INTEGER',
                    flagged: 'BOOLEAN',
                    tags: 'JSON?',
                    doctor: { ref: 'Doctor', foreignKey: 'doctor_id' },
                    doctor_id: 'INTEGER?',
                    coach: { ref: 'Coach', foreignKey: 'coach_id' },
                    coach_id: 'INTEGER?'
                }
            },
            {
                name: 'Doctor',
                primaryKey: 'id',
                columns: {
                    id: 'INTEGER',
                    name: 'TEXT?',
                    city: 'TEXT?',
                    visits: 'INTEGER',
                    meta: 'JSON?',
                    clinic: { ref: 'Clinic', foreignKey: 'clinic_id' },
                    clinic_id: 'INTEGER?',
                    patients: { collection: 'Customer', foreignKey: 'doctor_id' }
                }
            },
            { name: 'Clinic', primaryKey: 'id', columns: { id: 'INTEGER', city: 'TEXT?' } },
            // A coach needs a name and has no default for it: creating one with "!" must fail.
            { name: 'Coach', primaryKey: 'id', columns: { id: 'INTEGER', name: 'TEXT' } }
        ]
    }
});

const SETUP = `
CREATE TABLE "Clinic" (id serial PRIMARY KEY, city text);
CREATE TABLE "Doctor" (id serial PRIMARY KEY, name text, city text, visits integer NOT NULL DEFAULT 0, meta jsonb, clinic_id integer REFERENCES "Clinic"(id));
CREATE TABLE "Coach" (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE "Customer" (id integer PRIMARY KEY, name text NOT NULL, points integer NOT NULL DEFAULT 0, flagged boolean NOT NULL DEFAULT false, tags jsonb, doctor_id integer REFERENCES "Doctor"(id), coach_id integer REFERENCES "Coach"(id));
INSERT INTO "Doctor" (id, name, city, visits) VALUES (1, 'Dr A', 'Ankara', 0);
SELECT setval('"Doctor_id_seq"', 1);
INSERT INTO "Customer" (id, name, points, tags, doctor_id) VALUES
  (1, 'Ada', 5, '[{"k":"a"},{"k":"b"},{"k":"c"}]', 1),
  (2, 'Bob', 50, '[]', 1),
  (3, 'Cem', 7, NULL, NULL);
`;

let db: TestDatabase;
beforeAll(async () => {
    db = await openTestDatabase();
});
afterAll(async () => {
    await db.close();
});

const minab = createMinab({ schema });

function ports(): RunPorts {
    return { data: db.executor, write: pgWritePort({ query: (text, params) => db.queryResult(text, params) }) };
}

async function prepare(source: string) {
    const program = await minab.prepare(source);
    expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    return program;
}

const withTables = <T>(fn: () => Promise<T>) => db.isolated(SETUP, fn);
const apply = async (source: string) => (await prepare(source)).run({}, ports(), { writes: 'apply' });
const dryRun = async (source: string) => (await prepare(source)).run({}, ports(), { writes: 'dry-run' });
const tagsOf = async (id: number) => (await db.query(`SELECT tags FROM "Customer" WHERE id = ${id}`))[0].tags as Array<Record<string, unknown>> | null;
const doctors = () => db.query(`SELECT id, name, city, visits, clinic_id FROM "Doctor" ORDER BY id`);

describe('JSON arrays', () => {
    test('INSERT appends an element; a list appends each element; a null column starts an array', () =>
        withTables(async () => {
            const result = await apply(
                `loop c in #Customer where .id == 3 {\n    INSERT .tags VALUES { k: "x" };\n}\n` +
                    `loop c in #Customer where .id == 1 {\n    INSERT .tags VALUES [{ k: "d" }, { k: "e" }];\n}\ntrue`
            );
            expect(result).toMatchObject({ ok: true, stats: { writes: { statements: 2, rows: 2 } } });
            expect(await tagsOf(3)).toEqual([{ k: 'x' }]);
            expect(await tagsOf(1)).toEqual([{ k: 'a' }, { k: 'b' }, { k: 'c' }, { k: 'd' }, { k: 'e' }]);
        }));

    test('DELETE .tags[2] on a three-element array leaves the other two', () =>
        withTables(async () => {
            const result = await apply(`loop c in #Customer where .id == 1 {\n    DELETE .tags[2];\n}\ntrue`);
            expect(result).toMatchObject({ ok: true });
            expect(await tagsOf(1)).toEqual([{ k: 'a' }, { k: 'b' }]);
        }));

    test('DELETE with WHERE .$index, and a position past the end changes nothing', () =>
        withTables(async () => {
            await apply(`loop c in #Customer where .id == 1 {\n    DELETE .tags WHERE .$index > 0;\n}\ntrue`);
            expect(await tagsOf(1)).toEqual([{ k: 'a' }]);
            const result = await apply(`loop c in #Customer where .id == 1 {\n    DELETE .tags[5];\n}\ntrue`);
            // Nothing selected, so nothing is written.
            expect(result).toMatchObject({ ok: true, stats: { writes: { statements: 0 } } });
            expect(await tagsOf(1)).toEqual([{ k: 'a' }]);
        }));

    test('UPDATE sets keys of the selected elements; :| merges; ORDERBY and LIMIT choose the first ones', () =>
        withTables(async () => {
            await apply(
                `loop c in #Customer where .id == 1 {\n` +
                    `    UPDATE .tags WHERE .$index >= 1 SET { done: true };\n` +
                    `    UPDATE .tags ORDERBY .$index DESC LIMIT 1 SET { last: 1, extra :| { z: 1 } };\n` +
                    `}\ntrue`
            );
            // The first element is not selected; the last one is changed twice, and `:|` makes the object from a missing key.
            expect(await tagsOf(1)).toEqual([{ k: 'a' }, { k: 'b', done: true }, { k: 'c', done: true, last: 1, extra: { z: 1 } }]);
        }));

    test('a variable position: .tags[i]', () =>
        withTables(async () => {
            await apply(`let i: INTEGER = 1;\nloop c in #Customer where .id == 1 {\n    DELETE .tags[i];\n}\ntrue`);
            expect(await tagsOf(1)).toEqual([{ k: 'a' }, { k: 'c' }]);
        }));

    test('a record variable reaches the column: c.tags', () =>
        withTables(async () => {
            await apply(`loop c in #Customer where .id == 1 {\n    DELETE c.tags[0];\n}\ntrue`);
            expect(await tagsOf(1)).toEqual([{ k: 'b' }, { k: 'c' }]);
        }));

    test('a column behind a ref: .doctor.meta', () =>
        withTables(async () => {
            await apply(`loop c in #Customer where .id == 1 {\n    INSERT .doctor.meta VALUES 7;\n}\ntrue`);
            expect((await db.query(`SELECT meta FROM "Doctor" WHERE id = 1`))[0].meta).toEqual([7]);
        }));

    test('a dry run lists the write-back, writes nothing, and a second write starts from the first', () =>
        withTables(async () => {
            const result = await dryRun(`loop c in #Customer where .id == 2 {\n    INSERT .tags VALUES 1;\n    INSERT .tags VALUES 2;\n}\ntrue`);
            expect(result).toMatchObject({ ok: true, writes: { mode: 'dry-run' } });
            const statements = result.ok ? result.writes!.statements : [];
            expect(statements).toHaveLength(2);
            expect(statements[0].sql).toMatch(/^UPDATE "Customer" AS "_r\d+" SET "tags" = \$2::jsonb WHERE .* = \$1$/);
            expect(statements.map(s => s.params[1])).toEqual(['[1]', '[1,2]']);
            expect(await tagsOf(2)).toEqual([]);
        }));

    test('UPDATE on elements that are not objects is an error and nothing changes', () =>
        withTables(async () => {
            await apply(`loop c in #Customer where .id == 2 {\n    INSERT .tags VALUES 1;\n}\ntrue`);
            const result = await apply(`loop c in #Customer where .id == 2 {\n    UPDATE .tags SET { a: 1 };\n}\ntrue`);
            expect(result).toMatchObject({ ok: false, error: { code: 'eval.failed' } });
            expect(await tagsOf(2)).toEqual([1]);
        }));

    test('a JSON value that is not an array is an error; a null column has no element to change', () =>
        withTables(async () => {
            await db.exec(`UPDATE "Doctor" SET meta = '{"a":1}'`);
            const bad = await apply(`loop c in #Customer where .id == 1 {\n    INSERT .doctor.meta VALUES 1;\n}\ntrue`);
            expect(bad).toMatchObject({ ok: false, error: { code: 'eval.failed' } });
            const none = await apply(`loop c in #Customer where .id == 3 {\n    DELETE .tags[0];\n}\ntrue`);
            expect(none).toMatchObject({ ok: true, stats: { writes: { statements: 0 } } });
        }));
});

describe('path assignment', () => {
    test('.doctor.visits = 21 sets the related record; it is a no-op when .doctor is null', () =>
        withTables(async () => {
            const result = await apply(`loop c in #Customer {\n    .doctor.visits = 21;\n}\ntrue`);
            expect(result).toMatchObject({ ok: true });
            // Ada and Bob share doctor 1; Cem has none, and no doctor was created for Cem.
            expect(await doctors()).toEqual([{ id: 1, name: 'Dr A', city: 'Ankara', visits: 21, clinic_id: null }]);
        }));

    test('.doctor!.name creates the missing doctor, links it, and a second run creates nothing more', () =>
        withTables(async () => {
            const source = `loop c in #Customer where .id == 3 {\n    .doctor!.name = "Dr C";\n}\ntrue`;
            expect(await apply(source)).toMatchObject({ ok: true });
            expect(await doctors()).toEqual([
                { id: 1, name: 'Dr A', city: 'Ankara', visits: 0, clinic_id: null },
                { id: 2, name: 'Dr C', city: null, visits: 0, clinic_id: null }
            ]);
            expect(await db.query(`SELECT doctor_id FROM "Customer" WHERE id = 3`)).toEqual([{ doctor_id: 2 }]);
            expect(await apply(source)).toMatchObject({ ok: true });
            expect(await doctors()).toHaveLength(2);
        }));

    test('a mixed path: .doctor!.clinic!.city creates a doctor and a clinic; a dry run lists them in order', () =>
        withTables(async () => {
            const source = `loop c in #Customer where .id == 3 {\n    .doctor!.clinic!.city = "Izmir";\n}\ntrue`;
            const dry = await dryRun(source);
            const statements = dry.ok ? dry.writes!.statements : [];
            expect(statements.map(s => s.sql.split(' ')[0] + ' ' + (s.sql.match(/INSERT INTO "(\w+)"/)?.[1] ?? ''))).toEqual([
                'WITH Doctor',
                'WITH Clinic',
                'UPDATE '
            ]);
            expect(await doctors()).toHaveLength(1);
            expect(await apply(source)).toMatchObject({ ok: true });
            expect(await db.query(`SELECT city FROM "Clinic"`)).toEqual([{ city: 'Izmir' }]);
            expect(await db.query(`SELECT c.doctor_id, d.clinic_id FROM "Customer" c JOIN "Doctor" d ON d.id = c.doctor_id WHERE c.id = 3`)).toEqual([
                { doctor_id: 2, clinic_id: 1 }
            ]);
        }));

    test('without ! a null step stops the assignment, with ! only that step is created (.doctor.clinic!.city)', () =>
        withTables(async () => {
            // Cem has no doctor: nothing is created, because the step before the "!" is not marked.
            await apply(`loop c in #Customer where .id == 3 {\n    .doctor.clinic!.city = "Izmir";\n}\ntrue`);
            expect(await db.query(`SELECT count(*)::int AS n FROM "Clinic"`)).toEqual([{ n: 0 }]);
            // Ada has a doctor without a clinic: the clinic is created and linked.
            await apply(`loop c in #Customer where .id == 1 {\n    .doctor.clinic!.city = "Izmir";\n}\ntrue`);
            expect(await doctors()).toMatchObject([{ id: 1, clinic_id: 1 }]);
        }));

    test('|= merges into a ref and keeps its other fields; it creates the record when missing', () =>
        withTables(async () => {
            await apply(`loop c in #Customer where .id == 1 {\n    .doctor |= { name: "Dr Z" };\n}\ntrue`);
            expect(await doctors()).toEqual([{ id: 1, name: 'Dr Z', city: 'Ankara', visits: 0, clinic_id: null }]);
            await apply(`loop c in #Customer where .id == 3 {\n    .doctor |= { name: "New", city: "Bursa" };\n}\ntrue`);
            expect(await doctors()).toMatchObject([{ id: 1 }, { id: 2, name: 'New', city: 'Bursa' }]);
            expect(await db.query(`SELECT doctor_id FROM "Customer" WHERE id = 3`)).toEqual([{ doctor_id: 2 }]);
        }));

    test('a filtered path updates only the matching rows: .patients[...].flagged', () =>
        withTables(async () => {
            await apply(`loop d in #Doctor {\n    .patients[.points > 10].flagged = true;\n}\ntrue`);
            expect(await db.query(`SELECT name, flagged FROM "Customer" ORDER BY id`)).toEqual([
                { name: 'Ada', flagged: false },
                { name: 'Bob', flagged: true },
                { name: 'Cem', flagged: false }
            ]);
            await apply(`loop d in #Doctor {\n    .patients[.points <= 10] |= { flagged: true, points: 0 };\n}\ntrue`);
            expect(await db.query(`SELECT name, flagged, points FROM "Customer" ORDER BY id`)).toEqual([
                { name: 'Ada', flagged: true, points: 0 },
                { name: 'Bob', flagged: true, points: 50 },
                { name: 'Cem', flagged: false, points: 7 }
            ]);
        }));

    test('the filtered path is one UPDATE ... WHERE (dry run)', () =>
        withTables(async () => {
            const result = await dryRun(`loop d in #Doctor {\n    .patients[.points > 10].flagged = true;\n}\ntrue`);
            const statements = result.ok ? result.writes!.statements : [];
            expect(statements).toHaveLength(1);
            expect(statements[0].sql).toMatch(/^UPDATE "Customer" AS "(_r\d+)" SET "flagged" = \$\d+ WHERE .*"points" > \$\d+/);
        }));

    test('compound operators and ?= work on a path; a loop variable can start the path', () =>
        withTables(async () => {
            await apply(
                `loop c in #Customer where .id == 1 {\n    c.doctor.visits += 5;\n    c.doctor.name ?= "unused";\n    c.doctor.city = "Konya";\n}\ntrue`
            );
            expect(await doctors()).toEqual([{ id: 1, name: 'Dr A', city: 'Konya', visits: 5, clinic_id: null }]);
        }));

    test('the value is evaluated by the program: it can read the loop row', () =>
        withTables(async () => {
            await apply(`loop c in #Customer where .id == 1 {\n    .doctor.name = .name;\n}\ntrue`);
            expect((await doctors())[0].name).toBe('Ada');
        }));

    test('a column in the path that is not a relation is a refusal with compile.writePath', async () => {
        const program = await minab.prepare(`loop c in #Customer {\n    .doctor.clinic.city.x = "a";\n}\ntrue`);
        // The checker rejects this path; nothing reaches the compiler.
        expect(program.diagnostics.some(d => d.severity === 'error')).toBe(true);
    });

    test('a relation step after a filtered to-many step is refused', () =>
        withTables(async () => {
            const program = await prepare(`loop d in #Doctor {\n    .patients[.points > 1].doctor.name = "x";\n}\ntrue`);
            const result = await program.run({}, ports(), { writes: 'dry-run' });
            expect(result).toMatchObject({ ok: false, error: { code: 'compile.writePath' } });
        }));
});

describe('creating a record that cannot be created', () => {
    test('a required column with no default is eval.cannotCreateRecord, and the whole run is rolled back', () =>
        withTables(async () => {
            const result = await apply(`UPDATE #Customer SET { points: 999 };\nloop c in #Customer where .id == 1 {\n    .coach!.name = "Kim";\n}\ntrue`);
            expect(result).toMatchObject({ ok: false, error: { code: 'eval.cannotCreateRecord', params: { table: 'Coach', column: 'name' } } });
            expect((await db.query(`SELECT points FROM "Customer" ORDER BY id`)).map(r => r.points)).toEqual([5, 50, 7]);
            expect(await db.query(`SELECT count(*)::int AS n FROM "Coach"`)).toEqual([{ n: 0 }]);
        }));
});

describe('dry run of paths', () => {
    test('nothing changes, and the statements come back in order', () =>
        withTables(async () => {
            const result = await dryRun(`loop c in #Customer where .id == 3 {\n    .doctor!.name = "Dr C";\n}\ntrue`);
            expect(result).toMatchObject({ ok: true, writes: { mode: 'dry-run' } });
            const statements = result.ok ? result.writes!.statements : [];
            expect(statements).toHaveLength(2);
            expect(statements[0].sql).toMatch(/^WITH "_created" AS \(INSERT INTO "Doctor" DEFAULT VALUES RETURNING "id"\) UPDATE "Customer"/);
            expect(statements[1].sql).toMatch(/^UPDATE "Doctor"/);
            expect(await doctors()).toHaveLength(1);
        }));

    test('a dry run stops where a new record would have empty links (no ! on the next step)', () =>
        withTables(async () => {
            const result = await dryRun(`loop c in #Customer where .id == 3 {\n    .doctor!.clinic.city = "x";\n}\ntrue`);
            const statements = result.ok ? result.writes!.statements : [];
            // Only the creation of the doctor: the new doctor has no clinic, so the assignment would do nothing.
            expect(statements).toHaveLength(1);
        }));
});
