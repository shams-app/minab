/**
 * Production plan phase X5 — table writes: INSERT, UPDATE and DELETE through the write port.
 *
 * The statements run for real, on PGlite or on the Postgres of `MINAB_TEST_DATABASE_URL`:
 * rows change with `apply`, nothing changes in a dry run, and a failure rolls the whole run back.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMinab, type MinabEvent, type RunPorts, type WritePort } from '../src/runtime/index.js';
import { pgWritePort, queryFunctionDataPort, queryFunctionWritePort } from '../src/node/index.js';
import { parseConfig } from '../src/host/config.js';
import { openTestDatabase, type TestDatabase } from './support/database.js';

const { schema } = parseConfig({
    schema: {
        tables: [
            {
                name: 'Customer',
                primaryKey: 'id',
                columns: {
                    id: 'UUID',
                    name: 'TEXT',
                    country: 'TEXT?',
                    points: 'INTEGER',
                    balance: 'DECIMAL',
                    meta: 'JSON?',
                    orders: { collection: 'Order', foreignKey: 'customer_id' }
                }
            },
            {
                name: 'Order',
                primaryKey: 'id',
                columns: { id: 'UUID', customer_id: 'UUID', total: 'DECIMAL', status: 'TEXT' }
            },
            { name: 'Archive', primaryKey: 'id', columns: { id: 'UUID', name: 'TEXT', country: 'TEXT?', points: 'INTEGER' } }
        ]
    }
});

const SETUP = `
CREATE TABLE "Customer" (id uuid PRIMARY KEY, name text NOT NULL, country text, points integer NOT NULL DEFAULT 0, balance numeric NOT NULL DEFAULT 0, meta jsonb);
CREATE TABLE "Order" (id uuid PRIMARY KEY, customer_id uuid NOT NULL, total numeric NOT NULL, status text NOT NULL);
CREATE TABLE "Archive" (id uuid PRIMARY KEY, name text NOT NULL, country text, points integer NOT NULL);
INSERT INTO "Customer" (id, name, country, points, balance) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Ada', 'TR', 10, 100),
  ('00000000-0000-0000-0000-0000000000c2', 'Bob', 'DE', 20, 50),
  ('00000000-0000-0000-0000-0000000000c3', 'Cem', 'TR', 30, 0);
INSERT INTO "Order" (id, customer_id, total, status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 10, 'new'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 30, 'new'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 20, 'new'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c2', 40, 'new');
`;

let db: TestDatabase;
beforeAll(async () => {
    db = await openTestDatabase();
});
afterAll(async () => {
    await db.close();
});

const minab = createMinab({ schema });

/** The ports of a host that can write: reads and writes on the test database. */
function ports(extra: Partial<RunPorts> = {}): RunPorts {
    return { data: db.executor, write: pgWritePort({ query: (text, params) => db.queryResult(text, params) }), ...extra };
}

async function prepare(source: string) {
    const program = await minab.prepare(source);
    expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    return program;
}

/** Runs `source` with a fresh copy of the tables, then reads `after`. */
async function withTables<T>(fn: () => Promise<T>): Promise<T> {
    return await db.isolated(SETUP, fn);
}

const orderTotals = async () => (await db.query(`SELECT total::text AS total FROM "Order" ORDER BY id`)).map(r => r.total);

describe('apply: rows really change', () => {
    test('UPDATE with filter and compound operators; rowCounts are right', () =>
        withTables(async () => {
            const program = await prepare(`UPDATE #Customer[.country == "TR"] SET { points +: 5, name +: "!", country: null };\ntrue`);
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: true, value: true, writes: { mode: 'apply' }, stats: { writes: { statements: 1, rows: 2 } } });
            expect(result.ok && result.writes?.statements).toMatchObject([{ rowCount: 2 }]);
            expect(await db.query(`SELECT name, country, points FROM "Customer" ORDER BY name`)).toEqual([
                { name: 'Ada!', country: null, points: 15 },
                { name: 'Bob', country: 'DE', points: 20 },
                { name: 'Cem!', country: null, points: 35 }
            ]);
        }));

    test('the other relative operators: -: *: /: and :| on JSON', () =>
        withTables(async () => {
            const program = await prepare(
                `UPDATE #Customer[.name == "Ada"] SET { points -: 4, balance *: 3, meta :| { vip: true } };\n` +
                    `UPDATE #Customer[.name == "Ada"] SET { points /: 2, meta :| { level: 2 } };\ntrue`
            );
            await program.run({}, ports(), { writes: 'apply' });
            const [ada] = await db.query(`SELECT points, balance::text AS balance, meta FROM "Customer" WHERE name = 'Ada'`);
            expect(ada).toEqual({ points: 3, balance: '300', meta: { vip: true, level: 2 } });
        }));

    test('INSERT of an object, of a list of objects, and of a missing key (DEFAULT)', () =>
        withTables(async () => {
            const program = await prepare(
                `INSERT #Customer VALUES { id: CAST("00000000-0000-0000-0000-0000000000d1" AS UUID), name: "Dil" };\n` +
                    `INSERT #Customer VALUES [{ id: CAST("00000000-0000-0000-0000-0000000000d2" AS UUID), name: "Eda", points: 7 }, { id: CAST("00000000-0000-0000-0000-0000000000d3" AS UUID), name: "Fay" }];\ntrue`
            );
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: true, stats: { writes: { statements: 2, rows: 3 } } });
            expect(await db.query(`SELECT name, points FROM "Customer" WHERE name IN ('Dil','Eda','Fay') ORDER BY name`)).toEqual([
                { name: 'Dil', points: 0 },
                { name: 'Eda', points: 7 },
                { name: 'Fay', points: 0 }
            ]);
        }));

    test('INSERT ... SELECT from a table and from a query', () =>
        withTables(async () => {
            const program = await prepare(
                `INSERT #Archive VALUES #Customer[.country == "TR"];\n` +
                    `INSERT #Archive VALUES FROM #Customer WHERE .country == "DE" SELECT .id, .name, .points + 1 AS points;\ntrue`
            );
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: true, stats: { writes: { statements: 2, rows: 3 } } });
            expect(await db.query(`SELECT name, points FROM "Archive" ORDER BY name`)).toEqual([
                { name: 'Ada', points: 10 },
                { name: 'Bob', points: 21 },
                { name: 'Cem', points: 30 }
            ]);
        }));

    test('values come from variables and from the loop row', () =>
        withTables(async () => {
            const program = await prepare(
                `let bonus: INTEGER = 100;\n` +
                    `loop c in #Customer where .country == "TR" {\n    UPDATE #Customer[.id == c.id] SET { points +: bonus };\n}\ntrue`
            );
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: true, stats: { writes: { statements: 2, rows: 2 } } });
            expect((await db.query(`SELECT points FROM "Customer" ORDER BY name`)).map(r => r.points)).toEqual([110, 20, 130]);
        }));

    test('a relation target (UPDATE .orders) compiles with the foreign key condition; INSERT sets the link column', () =>
        withTables(async () => {
            const program = await prepare(
                `loop c in #Customer where .name == "Ada" {\n` +
                    `    UPDATE .orders WHERE .total > 15 SET { status: "big" };\n` +
                    `    INSERT .orders VALUES { id: CAST("00000000-0000-0000-0000-0000000000a9" AS UUID), total: 1, status: "gift" };\n` +
                    `    DELETE .orders[.total < 15 AND .status == "new"];\n` +
                    `}\ntrue`
            );
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: true, stats: { writes: { statements: 3, rows: 4 } } });
            expect(await db.query(`SELECT status, customer_id FROM "Order" WHERE customer_id = '00000000-0000-0000-0000-0000000000c1' ORDER BY total`)).toEqual(
                [
                    { status: 'gift', customer_id: '00000000-0000-0000-0000-0000000000c1' },
                    { status: 'big', customer_id: '00000000-0000-0000-0000-0000000000c1' },
                    { status: 'big', customer_id: '00000000-0000-0000-0000-0000000000c1' }
                ]
            );
            // Another customer's order is not touched.
            expect(await db.query(`SELECT status FROM "Order" WHERE customer_id = '00000000-0000-0000-0000-0000000000c2'`)).toEqual([{ status: 'new' }]);
        }));

    test('a read after a write in the same run sees the write', () =>
        withTables(async () => {
            const program = await prepare(`UPDATE #Customer SET { points: 0 };\nSUM(#Customer.points) + COUNT(#Customer[.points == 0])`);
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: true, value: 3 });
        }));

    test('the events: a statement event for each write, just before it runs', () =>
        withTables(async () => {
            const events: MinabEvent[] = [];
            const program = await prepare(`DELETE #Order[.total > 100];\ntrue`);
            await program.run({}, ports({ events: { emit: e => events.push(e) } }), { writes: 'apply' });
            expect(events.map(e => e.kind)).toEqual(['statement', 'timing', 'timing']);
            expect(events[0]).toMatchObject({ kind: 'statement', sql: expect.stringMatching(/^DELETE FROM "Order"/), params: [100] });
        }));
});

describe('LIMIT and ORDERBY on UPDATE and DELETE', () => {
    test('DELETE ... ORDERBY ... LIMIT deletes the right rows', () =>
        withTables(async () => {
            const program = await prepare(`DELETE #Order ORDERBY .total DESC LIMIT 2;\ntrue`);
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: true, stats: { writes: { statements: 1, rows: 2 } } });
            // The two biggest (40 and 30) are gone.
            expect(await orderTotals()).toEqual(['10', '20']);
        }));

    test('UPDATE with WHERE and LIMIT changes only the first rows; the SET still reads the row', () =>
        withTables(async () => {
            const program = await prepare(`UPDATE #Order WHERE .status == "new" ORDERBY .total LIMIT 2 SET { total *: 10 };\ntrue`);
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: true, stats: { writes: { rows: 2 } } });
            expect(await orderTotals()).toEqual(['100', '30', '200', '40']);
        }));

    test('LIMIT with OFFSET', () =>
        withTables(async () => {
            const program = await prepare(`DELETE #Order ORDERBY .total LIMIT 1 OFFSET 1;\ntrue`);
            await program.run({}, ports(), { writes: 'apply' });
            expect(await orderTotals()).toEqual(['10', '30', '40']);
        }));
});

describe('dry run: nothing changes', () => {
    test('the statements come back and the tables stay the same; reads still run', () =>
        withTables(async () => {
            const events: MinabEvent[] = [];
            const program = await prepare(
                `let n: INTEGER = COUNT(#Customer);\nUPDATE #Customer SET { points: n };\nDELETE #Order;\nINSERT #Archive VALUES #Customer;\nn`
            );
            const before = await db.query(`SELECT * FROM "Customer" ORDER BY id`);
            const result = await program.run({}, ports({ events: { emit: e => events.push(e) } }), { writes: 'dry-run' });
            expect(result).toMatchObject({ ok: true, value: 3, writes: { mode: 'dry-run' }, stats: { writes: { statements: 3, rows: 0 } } });
            expect(result.ok && result.writes?.statements.map(s => s.sql.split(' ')[0])).toEqual(['UPDATE', 'DELETE', 'INSERT']);
            expect(result.ok && result.writes?.statements[0]).toMatchObject({ params: [3], range: { start: { line: 1 } } });
            expect(result.ok && result.writes?.statements.every(s => s.rowCount === undefined)).toBe(true);
            expect(await db.query(`SELECT * FROM "Customer" ORDER BY id`)).toEqual(before);
            expect(await db.query(`SELECT count(*)::int AS n FROM "Order"`)).toEqual([{ n: 4 }]);
            expect(await db.query(`SELECT count(*)::int AS n FROM "Archive"`)).toEqual([{ n: 0 }]);
            // Only the read reached the data port.
            expect(events.filter(e => e.kind === 'statement')).toHaveLength(1);
        }));

    test('a dry run needs no write port', async () => {
        const program = await prepare(`DELETE #Order;\ntrue`);
        expect(await program.run({}, {}, { writes: 'dry-run' })).toMatchObject({
            ok: true,
            writes: { statements: [{ sql: 'DELETE FROM "Order" AS "_r0"', params: [] }] }
        });
    });

    test('a program that does not write has an empty list, and the mode does not matter', async () => {
        const program = await prepare(`1 + 1`);
        expect(await program.run()).toMatchObject({
            ok: true,
            value: 2,
            writes: { mode: null, statements: [] },
            stats: { writes: { statements: 0, rows: 0 } }
        });
    });

    test('dry-run statements count toward limits.statements, so a loop cannot make an endless list', async () => {
        const limited = createMinab({ schema, limits: { statements: 3 } });
        const program = await limited.prepare(`loop i from 1 to 10 {\n    DELETE #Order[.total > i];\n}\ntrue`);
        expect(await program.run({}, {}, { writes: 'dry-run' })).toMatchObject({ ok: false, error: { code: 'limit.tooManyStatements' } });
    });
});

describe('one run, one transaction', () => {
    test('a failure in the third statement rolls back the first two', () =>
        withTables(async () => {
            const program = await prepare(
                `UPDATE #Customer SET { points: 999 };\n` +
                    `DELETE #Order;\n` +
                    // The same primary key twice: the database refuses the third statement.
                    `INSERT #Customer VALUES [{ id: CAST("00000000-0000-0000-0000-0000000000f1" AS UUID), name: "X" }, { id: CAST("00000000-0000-0000-0000-0000000000f1" AS UUID), name: "Y" }];\ntrue`
            );
            const result = await program.run({}, ports(), { writes: 'apply' });
            expect(result).toMatchObject({ ok: false, error: { code: 'data.error', params: { sqlstate: '23505' } } });
            expect((await db.query(`SELECT points FROM "Customer" ORDER BY name`)).map(r => r.points)).toEqual([10, 20, 30]);
            expect(await db.query(`SELECT count(*)::int AS n FROM "Order"`)).toEqual([{ n: 4 }]);
        }));

    test('a program error after a write (division by zero) rolls the write back', () =>
        withTables(async () => {
            const program = await prepare(`DELETE #Order;\n1 / 0`);
            expect(await program.run({}, ports(), { writes: 'apply' })).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero' } });
            expect(await db.query(`SELECT count(*)::int AS n FROM "Order"`)).toEqual([{ n: 4 }]);
        }));

    test('a cancel stops the run and rolls back what it wrote', () =>
        withTables(async () => {
            const controller = new AbortController();
            const program = await prepare(`DELETE #Order;\nloop i from 1 to 1000000 {\n    LOG(i);\n}\ntrue`);
            const base = ports();
            // Abort right after the first write.
            const write: WritePort = {
                transaction: (work, context) =>
                    base.write!.transaction(
                        tx =>
                            work({
                                execute: tx.execute.bind(tx),
                                executeWrite: async (q, c) => {
                                    const answer = await tx.executeWrite(q, c);
                                    controller.abort();
                                    return answer;
                                }
                            }),
                        context
                    )
            };
            const result = await program.run({}, { ...base, write }, { writes: 'apply', signal: controller.signal });
            expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
            expect(await db.query(`SELECT count(*)::int AS n FROM "Order"`)).toEqual([{ n: 4 }]);
        }));

    test('the next run starts clean after a rollback (the connection is not left in a failed transaction)', () =>
        withTables(async () => {
            const bad = await prepare(`INSERT #Customer VALUES { id: CAST("00000000-0000-0000-0000-0000000000c1" AS UUID), name: "Dup" };\ntrue`);
            expect(await bad.run({}, ports(), { writes: 'apply' })).toMatchObject({ ok: false });
            const good = await prepare(`DELETE #Order;\ntrue`);
            expect(await good.run({}, ports(), { writes: 'apply' })).toMatchObject({ ok: true });
            expect(await db.query(`SELECT count(*)::int AS n FROM "Order"`)).toEqual([{ n: 0 }]);
        }));
});

describe('the host must choose', () => {
    test('a program that writes, with no write mode, fails with eval.writeModeMissing before any port is called', async () => {
        const program = await prepare(`UPDATE #Customer SET { points: 1 };\ntrue`);
        const events: MinabEvent[] = [];
        let calls = 0;
        const counting = {
            execute: () => {
                calls++;
                return Promise.resolve([]);
            }
        };
        const result = await program.run({}, { data: counting, events: { emit: e => events.push(e) } });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.writeModeMissing' } });
        expect(calls).toBe(0);
        expect(events.filter(e => e.kind === 'statement')).toEqual([]);
    });

    test('apply with no write port is eval.writesNotSupported', async () => {
        const program = await prepare(`DELETE #Order;\ntrue`);
        expect(await program.run({}, { data: db.executor }, { writes: 'apply' })).toMatchObject({ ok: false, error: { code: 'eval.writesNotSupported' } });
    });
});

describe('rules cannot write', () => {
    const cases: [string, string][] = [
        ['a field rule with DELETE', 'DELETE #Order[.total > 1]; $ == 1'],
        ['a record rule with INSERT', 'INSERT #Archive VALUES { id: .id, name: "x", points: 1 }; true'],
        ['a record rule with UPDATE', 'UPDATE #Customer SET { points: 1 }; true'],
        ['a record rule with a record path assignment', '.points = 1; true'],
        ['a write inside a function of a rule', 'fn f(): INTEGER { DELETE #Order; 1 }\nf() == 1']
    ];
    test.each(cases)('%s is rule.writeInRule', async (_name, source) => {
        const field = source.includes('$');
        const program = await minab.prepare(source, {
            ruleContext: field
                ? {
                      isFieldRule: true,
                      recordTable: 'Customer',
                      fieldType: { kind: 'scalar', base: 'INTEGER', nullable: false, array: false, arrayNullable: false }
                  }
                : { isFieldRule: false, recordTable: 'Customer' }
        });
        expect(program.diagnostics.map(d => d.code)).toContain('rule.writeInRule');
        expect(program.ok).toBe(false);
        expect(await program.run({ record: {} }, ports(), { writes: 'apply' })).toMatchObject({ ok: false, error: { code: 'eval.programInvalid' } });
    });

    test('a local variable assignment is not a write', async () => {
        const program = await minab.prepare('let n: INTEGER = 1;\nn += 1;\nn == 2', { ruleContext: { isFieldRule: false, recordTable: 'Customer' } });
        expect(program.diagnostics).toEqual([]);
    });
});

describe('the checker', () => {
    const codes = async (source: string) => (await minab.prepare(source)).diagnostics.map(d => d.code);

    test('an unknown column, a relation as a column, and a wrong value type', async () => {
        expect(await codes('INSERT #Customer VALUES { bogus: 1 };\ntrue')).toContain('compile.writeColumn');
        expect(await codes('UPDATE #Customer SET { orders: 1 };\ntrue')).toContain('compile.writeColumn');
        expect(await codes('UPDATE #Customer SET { points: "x" };\ntrue')).toContain('type.assignMismatch');
        expect(await codes('INSERT #Customer VALUES { name: 5 };\ntrue')).toContain('type.assignMismatch');
    });

    test('a relative operator needs a number (+: also text); :| needs JSON', async () => {
        expect(await codes('UPDATE #Customer SET { name -: 1 };\ntrue')).toContain('type.assignNeedsNumericTarget');
        expect(await codes('UPDATE #Customer SET { points :| { a: 1 } };\ntrue')).toContain('type.mergeAssignTarget');
        expect(await codes('UPDATE #Customer SET { name +: "x", points +: 1, meta :| { a: 1 } };\ntrue')).toEqual([]);
    });

    test('the target must be a table, and SET must not be empty', async () => {
        expect(await codes('DELETE .points;\ntrue')).not.toEqual([]);
        expect(await codes('UPDATE #Customer SET { };\ntrue')).toContain('compile.writeEmptySet');
    });
});

describe('the Node adapters', () => {
    const context = { signal: new AbortController().signal };

    test('pgWritePort over a client: BEGIN, the writes, COMMIT; ROLLBACK when the work throws', async () => {
        const sent: string[] = [];
        const client = {
            query: async (text: string) => {
                sent.push(text);
                return { rows: [], rowCount: 2 };
            }
        };
        const port = pgWritePort(client);
        const result = await port.transaction(async tx => (await tx.executeWrite({ text: 'DELETE FROM t', params: [] }, context)).affected, context);
        expect(result).toBe(2);
        expect(sent).toEqual(['BEGIN', 'DELETE FROM t', 'COMMIT']);

        sent.length = 0;
        await expect(
            port.transaction(async tx => {
                await tx.executeWrite({ text: 'DELETE FROM t', params: [] }, context);
                throw new Error('stop');
            }, context)
        ).rejects.toThrow('stop');
        expect(sent).toEqual(['BEGIN', 'DELETE FROM t', 'ROLLBACK']);
    });

    test('pgWritePort over a pool: one connection for the transaction, given back at the end; a broken one is dropped', async () => {
        const sent: string[] = [];
        const released: unknown[] = [];
        let failRollback = false;
        const pool = {
            totalCount: 0,
            connect: async () => ({
                query: async (text: string) => {
                    sent.push(text);
                    if (text === 'ROLLBACK' && failRollback) throw new Error('connection lost');
                    return { rows: [], rowCount: 1 };
                },
                release: (error?: unknown) => released.push(error)
            })
        };
        const port = pgWritePort(pool);
        await port.transaction(tx => tx.executeWrite({ text: 'DELETE FROM t', params: [] }, context), context);
        expect(sent).toEqual(['BEGIN', 'DELETE FROM t', 'COMMIT']);
        expect(released).toEqual([undefined]);

        failRollback = true;
        await expect(
            port.transaction(async () => {
                throw new Error('stop');
            }, context)
        ).rejects.toThrow('stop');
        expect(released[1]).toBeInstanceOf(Error);
    });

    test('queryFunctionWritePort opens no transaction of its own: the host owns it', async () => {
        const sent: string[] = [];
        const port = queryFunctionWritePort(async text => {
            sent.push(text);
            return [[], 3]; // the pair that TypeORM gives for UPDATE and DELETE on PostgreSQL
        });
        const affected = await port.transaction(async tx => (await tx.executeWrite({ text: 'UPDATE t SET a = 1', params: [] }, context)).affected, context);
        expect(affected).toBe(3);
        expect(sent).toEqual(['UPDATE t SET a = 1']);
    });

    test('the row count from the shapes a driver gives', async () => {
        const count = async (answer: unknown) =>
            (await queryFunctionWritePort(async () => answer as never).transaction(tx => tx.executeWrite({ text: 'x', params: [] }, context), context))
                .affected;
        expect(await count({ rows: [], rowCount: 5 })).toBe(5);
        expect(await count({ rows: [{}, {}] })).toBe(2);
        expect(await count([[], 4])).toBe(4);
        expect(await count([{}, {}, {}])).toBe(3);
    });

    test('a host that owns the transaction: a failed run does not commit, and the host rolls back', async () => {
        await withTables(async () => {
            const program = await prepare(`DELETE #Order;\n1 / 0`);
            await db.exec('BEGIN');
            const query = (text: string, params: unknown[]) => db.queryResult(text, params);
            const result = await program.run({}, { data: queryFunctionDataPort(query), write: queryFunctionWritePort(query) }, { writes: 'apply' });
            expect(result).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero' } });
            // The host sees the failure and rolls back its own transaction.
            await db.exec('ROLLBACK');
            expect(await db.query(`SELECT count(*)::int AS n FROM "Order"`)).toEqual([{ n: 4 }]);
        });
    });
});
