/**
 * Production plan phase R4 — structured run errors (`src/runtime/errors.ts`, decision D35).
 */

import { AstUtils, EmptyFileSystem } from 'langium';
import { validationHelper } from 'langium/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Model } from '../src/language/generated/ast.js';
import { DIAGNOSTICS } from '../src/language/diagnostics/codes.js';
import { createMinabServices, type MinabServices } from '../src/language/minab-module.js';
import { createMinab, type DataPort, type HostFunctions, type MinabError } from '../src/runtime/index.js';
import { dataFailure, sqlstateOf } from '../src/runtime/errors.js';
import { openTestDatabase, type TestDatabase } from './support/database.js';
import { orderSchema } from './support/runtime.js';

const record = { recordTable: 'Order', isFieldRule: false };

// Building the services takes seconds, so the tests that need them share one set.
let services: MinabServices;
beforeAll(() => {
    services = createMinabServices(EmptyFileSystem, orderSchema(), { isFieldRule: false }).Minab;
}, 60_000);

/** A data port that fails the way a driver does: an error with a SQLSTATE `code`. */
function failingWith(code: string | undefined, message = 'driver text: SELECT secret FROM Order'): DataPort {
    return {
        execute: () => Promise.reject(Object.assign(new Error(message), code === undefined ? {} : { code }))
    };
}

async function errorOf(
    source: string,
    run: (program: Awaited<ReturnType<ReturnType<typeof createMinab>['prepare']>>) => Promise<unknown>
): Promise<MinabError> {
    const minab = createMinab({ schema: orderSchema(), ruleContext: record });
    const result = (await run(await minab.prepare(source))) as { ok: boolean; error: MinabError };
    expect(result.ok).toBe(false);
    return result.error;
}

describe('every error has a code, a message, params and a range', () => {
    test('5 / 0 is eval.divisionByZero, with the range of the division', async () => {
        const error = await errorOf('1 + 5 / 0', p => p.run());
        expect(error).toEqual({
            code: 'eval.divisionByZero',
            message: 'division by zero',
            params: {},
            range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } }
        });
    });

    test('5 % 0 is eval.divisionByZero too', async () => {
        expect((await errorOf('5 % 0', p => p.run())).code).toBe('eval.divisionByZero');
    });

    test('a failing CAST has a range that points at the CAST', async () => {
        const source = 'let n: INTEGER = 1;\nn + CAST("12a" AS INTEGER)';
        const error = await errorOf(source, p => p.run());
        expect(error.code).toBe('eval.castFailed');
        expect(error.params).toEqual({ value: '"12a"', from: 'TEXT', to: 'INTEGER' });
        // Line 1 (0-based), from the C of CAST to its closing bracket.
        expect(error.range).toEqual({ start: { line: 1, character: 4 }, end: { line: 1, character: 26 } });
        expect(source.split('\n')[1].slice(4, 26)).toBe('CAST("12a" AS INTEGER)');
    });

    test('the failure is reported at the innermost node, not at the whole program', async () => {
        const error = await errorOf('(1 + 2) * (3 / 0)', p => p.run());
        // The second factor, with its brackets: `(3 / 0)`.
        expect(error.range).toEqual({ start: { line: 0, character: 10 }, end: { line: 0, character: 17 } });
    });

    test('a failure with no special code is eval.failed, and params.reason has the text', async () => {
        const error = await errorOf('.total > 5', p => p.run({ record: { total: null } }));
        expect(error.code).toBe('eval.failed');
        expect(error.message).toContain('against null');
        expect(error.params).toEqual({ reason: error.message });
        expect(error.range).toBeDefined();
    });

    test('the messages and the params come from the registry', async () => {
        const error = await errorOf('CAST("x" AS INTEGER)', p => p.run());
        expect(error.message).toBe(DIAGNOSTICS['eval.castFailed'].message(error.params as never));
    });

    test('an error is plain JSON', async () => {
        const error = await errorOf('1 / 0', p => p.run());
        expect(JSON.parse(JSON.stringify(error))).toEqual(error);
    });
});

describe('data port failures (D35)', () => {
    test('Postgres 22012 and the interpreter both give eval.divisionByZero', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const interpreted = await (await minab.prepare('5 / 0')).run();
        const fromData = await (await minab.prepare('FROM Order SELECT .id')).run({}, { data: failingWith('22012') });
        expect(interpreted).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero' } });
        expect(fromData).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero', params: { sqlstate: '22012' } } });
    });

    test('22P02 and 22003 give eval.castFailed, with the SQLSTATE', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order SELECT .id');
        for (const sqlstate of ['22P02', '22003']) {
            const result = await program.run({}, { data: failingWith(sqlstate) });
            expect(result).toMatchObject({ ok: false, error: { code: 'eval.castFailed', params: { sqlstate } } });
        }
    });

    test('any other failure is data.error, with params.sqlstate when the driver gave one', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order SELECT .id');
        expect(await program.run({}, { data: failingWith('42P01') })).toMatchObject({
            ok: false,
            error: { code: 'data.error', message: 'the data source failed', params: { sqlstate: '42P01' } }
        });
        const plain = await program.run({}, { data: failingWith(undefined) });
        expect(plain).toMatchObject({ ok: false, error: { code: 'data.error', params: {} } });
        // A `code` that is not a SQLSTATE (Node's ECONNREFUSED) is not copied as one.
        const refused = await program.run({}, { data: failingWith('ECONNREFUSED') });
        expect(refused).toMatchObject({ ok: false, error: { code: 'data.error', params: {} } });
    });

    test('neither the SQL text nor the driver text is in the error', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order SELECT .id');
        const result = await program.run({}, { data: failingWith('42P01') });
        const text = JSON.stringify(result);
        expect(text).not.toContain('SELECT');
        expect(text).not.toContain('secret');
        expect(text).not.toContain('driver text');
    });

    test('the SQL still reaches the host through the statement event', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order SELECT .id');
        const sql: string[] = [];
        await program.run({}, { data: failingWith('42P01'), events: { emit: e => e.kind === 'statement' && sql.push(e.sql) } });
        expect(sql[0]).toMatch(/^SELECT /);
    });

    test('the range of a data error is the statement that failed', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const result = await (await minab.prepare('FROM Order SELECT .id')).run({}, { data: failingWith('42P01') });
        expect(result.ok ? undefined : result.error.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 21 } });
    });

    test('a pushed-down check that fails gives the range of that check', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const result = await (
            await minab.prepare('.total > 1 AND EXISTS(#Order[.status == "a"])')
        ).run({ record: { total: 5 } }, { data: failingWith('42P01') });
        expect(result).toMatchObject({ ok: false, error: { code: 'data.error' } });
        expect(result.ok ? undefined : result.error.range?.start).toEqual({ line: 0, character: 15 });
    });

    test('without a data port, data.noPort', async () => {
        const error = await errorOf('FROM Order SELECT .id', p => p.run());
        expect(error).toMatchObject({ code: 'data.noPort', message: 'this program needs data, and no data port was given' });
    });

    test('sqlstateOf and dataFailure', () => {
        expect(sqlstateOf({ code: '22012' })).toBe('22012');
        expect(sqlstateOf({ code: '2201' })).toBeUndefined();
        expect(sqlstateOf({ code: 22012 })).toBeUndefined();
        expect(sqlstateOf(null)).toBeUndefined();
        expect(sqlstateOf('22012')).toBeUndefined();
        expect(dataFailure({ code: '23505' })).toMatchObject({ code: 'data.error', params: { sqlstate: '23505' } });
    });
});

describe('host function failures', () => {
    test('a host function that throws is eval.hostFunctionFailed, and its text is not copied', async () => {
        const minab = createMinab({ schema: orderSchema(), functions: [{ name: 'fxRate', params: [], returns: 'DECIMAL' }] });
        const program = await minab.prepare('fxRate()');
        const hostFunctions: HostFunctions = {
            call: () => {
                throw new Error('api key abc123 rejected');
            }
        };
        const result = await program.run({}, { hostFunctions });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.hostFunctionFailed', params: { name: 'fxRate' } } });
        expect(JSON.stringify(result)).not.toContain('abc123');
        // An async failure is the same.
        const asynchronous = await program.run({}, { hostFunctions: { call: () => Promise.reject(new Error('abc123')) } });
        expect(asynchronous).toMatchObject({ ok: false, error: { code: 'eval.hostFunctionFailed' } });
    });
});

describe('compile errors', () => {
    test('compile gives { ok: true, sql }', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const compiled = (await minab.prepare('FROM Order SELECT .id')).compile();
        expect(compiled.ok && compiled.sql.text).toMatch(/^SELECT /);
        expect(compiled.ok && compiled.sql.params).toEqual([]);
    });

    test('a user function is compile.notSql, with the reason and a range', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const compiled = (await minab.prepare('fn f(a: INTEGER): INTEGER { a }\nf(1) + 1')).compile();
        expect(compiled).toMatchObject({ ok: false, error: { code: 'compile.notSql', params: { reason: expect.any(String) } } });
        expect(compiled.ok ? undefined : compiled.error.range).toEqual({ start: { line: 1, character: 0 }, end: { line: 1, character: 8 } });
        expect(compiled.ok ? '' : compiled.error.message).toBe(
            `this program does not compile to SQL on its own: ${(compiled as { error: MinabError }).error.params.reason}`
        );
    });

    test('a program with errors and a program with nothing in it have their own codes', async () => {
        const minab = createMinab({ schema: orderSchema() });
        expect((await minab.prepare('FROM')).compile()).toMatchObject({ ok: false, error: { code: 'compile.programHasErrors' } });
        expect((await minab.prepare('')).compile()).toMatchObject({ ok: false, error: { code: 'compile.nothingToCompile' } });
    });

    test('every compiler refusal has a registry code', async () => {
        const { document } = await validationHelper<Model>(services)('FROM Order SELECT switch .status { "a" => { let x: INTEGER = 1; x }, _ => 2 } AS s\n');
        const query = AstUtils.streamAst(document.parseResult.value).find(node => node.$type === 'Query');
        const specific = services.sqlCompiler.compileQuery(query as never);
        expect(specific).toMatchObject({ ok: false, code: 'compile.blockInQuery' });
        const { document: other } = await validationHelper<Model>(services)('fn f(a: INTEGER): INTEGER { a }\nFROM Order SELECT f(1) AS x');
        const plain = services.sqlCompiler.compileQuery(AstUtils.streamAst(other.parseResult.value).find(node => node.$type === 'Query') as never);
        expect(plain).toMatchObject({ ok: false, code: 'compile.notSql', params: { reason: expect.any(String) } });
    });
});

describe('the old evaluate entry (until R7 and R8)', () => {
    async function evaluate(source: string, executor: DataPort) {
        const { document } = await validationHelper<Model>(services)(source);
        return services.interpreter.evaluate(document.parseResult.value, { executor });
    }

    test('a failure keeps the old shape: a reason, and a code only when it has a specific one', async () => {
        const executor: DataPort = { execute: async () => [] };
        expect(await evaluate('1 / 0', executor)).toEqual({ ok: false, reason: 'division by zero', code: 'eval.divisionByZero', params: {} });
        expect(await evaluate('.total > null', executor)).toEqual({ ok: false, reason: expect.stringContaining('against null') });
    });

    test('a data port failure is thrown again, as before', async () => {
        await expect(evaluate('FROM Order SELECT .id', failingWith('42P01', 'down'))).rejects.toThrow('down');
    });

    test('it has no limits, so a run of any length works', async () => {
        const executor: DataPort = { execute: async () => Array.from({ length: 20_000 }, (_, i) => ({ id: i })) };
        expect(await evaluate('FROM Order SELECT .id', executor)).toMatchObject({ ok: true });
    });
});

describe('a real database (PGlite, or Postgres when MINAB_TEST_DATABASE_URL is set)', () => {
    let database: TestDatabase;
    beforeAll(async () => {
        database = await openTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await database?.close();
    });

    const SETUP = `CREATE TABLE "Order" (id uuid PRIMARY KEY, customer_id uuid, total numeric, status text);
        INSERT INTO "Order" VALUES ('00000000-0000-0000-0000-000000000001', NULL, 5, 'abc');`;

    /** The data port a host would write over the driver: it passes the driver error on. */
    const port = (): DataPort => ({ execute: query => database.executor.execute(query) });

    async function run(source: string) {
        const program = await createMinab({ schema: orderSchema() }).prepare(source);
        expect(program.diagnostics).toEqual([]);
        return database.isolated(SETUP, () => program.run({}, { data: port() }));
    }

    test('a division by zero in SQL is eval.divisionByZero, like 5 / 0 in the interpreter', async () => {
        const fromSql = await run('FROM Order SELECT .total / 0 AS x');
        expect(fromSql).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero', params: { sqlstate: '22012' } } });
        const interpreted = await (await createMinab({ schema: orderSchema() }).prepare('5 / 0')).run();
        expect(interpreted).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero' } });
    });

    test('a cast that Postgres refuses is eval.castFailed', async () => {
        const invalidText = await run('FROM Order SELECT CAST(.status AS INTEGER) AS n');
        expect(invalidText).toMatchObject({ ok: false, error: { code: 'eval.castFailed', params: { sqlstate: '22P02' } } });
    });

    test('a failure that has no special code is data.error with its SQLSTATE, and no SQL in the text', async () => {
        // No database has a table of this name (a shared Postgres may hold `Order` from another suite).
        const schema = orderSchema();
        const missing = { ...schema, tables: [{ ...schema.tables.find(t => t.name === 'Customer')!, name: 'NoSuchTableR4' }] };
        const program = await createMinab({ schema: missing }).prepare('FROM NoSuchTableR4 SELECT .id');
        expect(program.diagnostics).toEqual([]);
        const result = await database.isolated('SELECT 1', () => program.run({}, { data: port() }));
        expect(result).toMatchObject({ ok: false, error: { code: 'data.error', params: { sqlstate: '42P01' } } });
        expect(JSON.stringify(result)).not.toContain('SELECT');
    });
});
