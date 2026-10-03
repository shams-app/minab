/**
 * Production plan phase R3 — ports: data, host functions and inputs, clock,
 * events, write (`src/runtime/ports.ts`).
 */

import { AstUtils, EmptyFileSystem } from 'langium';
import { validationHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/host/config.js';
import type { Expression, Model } from '../src/language/generated/ast.js';
import { resolveHostDeclarations } from '../src/language/host-declarations.js';
import { createMinabServices } from '../src/language/minab-module.js';
import { DIAGNOSTICS } from '../src/language/diagnostics/codes.js';
import {
    createMinab,
    HostDeclarationError,
    REFUSING_WRITE_PORT,
    SYSTEM_CLOCK,
    type ClockPort,
    type DataPort,
    type HostFunctions,
    type MinabEvent,
    type RunPorts
} from '../src/runtime/index.js';
import { orderSchema } from './support/runtime.js';

const record = { recordTable: 'Order', isFieldRule: false };
const inputs = { currentUser: { id: 'TEXT', roles: 'TEXT[]', email: 'CITEXT' }, url: 'JSON' };
const functions = [
    {
        name: 'fxRate',
        params: [
            { name: 'from', type: 'TEXT' },
            { name: 'to', type: 'TEXT' }
        ],
        returns: 'DECIMAL'
    }
];

/** A data port that records every call and answers with `rows`. */
function fakeData(rows: Record<string, unknown>[] = [{ value: true }]) {
    const calls: { text: string; params: unknown[]; signal: AbortSignal }[] = [];
    const port: DataPort = {
        execute: (query, context) => {
            calls.push({ text: query.text, params: query.params, signal: context.signal });
            return Promise.resolve(rows);
        }
    };
    return { port, calls };
}

function host(overrides: Partial<Parameters<typeof createMinab>[0]> = {}) {
    return createMinab({ schema: orderSchema(), ruleContext: record, inputs, functions, ...overrides });
}

describe('host inputs (D27)', () => {
    test('currentUser.id == .owner_id checks, and runs with the input given', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record, inputs: { currentUser: { id: 'TEXT' } } });
        const program = await minab.prepare('currentUser.id == .status');
        expect(program.diagnostics).toEqual([]);
        expect(program.resultType).toBe('BOOLEAN');
        const yes = await program.run({ record: { status: 'u-1' }, hostInputs: { currentUser: { id: 'u-1' } } });
        expect(yes).toMatchObject({ ok: true, value: true });
        const no = await program.run({ record: { status: 'u-2' }, hostInputs: { currentUser: { id: 'u-1' } } });
        expect(no).toMatchObject({ ok: true, value: false });
    });

    test('a run without the input is eval.missingInput', async () => {
        const program = await host().prepare('currentUser.id == .status');
        for (const hostInputs of [undefined, {}, { url: {} }, { currentUser: undefined }]) {
            const result = await program.run({ record: { status: 'x' }, hostInputs });
            expect(result).toMatchObject({ ok: false, error: { code: 'eval.missingInput', params: { name: 'currentUser' } } });
        }
    });

    test('a scalar, an array and a JSON input are typed', async () => {
        const minab = createMinab({ schema: orderSchema(), inputs: { limit: 'INTEGER', tags: 'TEXT[]', url: 'JSON' } });
        expect((await minab.prepare('limit')).resultType).toBe('INTEGER');
        expect((await minab.prepare('tags')).resultType).toBe('TEXT[]');
        expect((await minab.prepare('url')).resultType).toBe('JSON');
        expect((await minab.prepare('limit + 1')).ok).toBe(true);
        const bad = await minab.prepare('limit == "x"');
        expect(bad.diagnostics.map(d => d.code)).toContain('type.implicitCoercion');
        const run = await (await minab.prepare('limit + 1')).run({ hostInputs: { limit: 4 } });
        expect(run).toMatchObject({ ok: true, value: 5 });
    });

    test('an input may be null when its type says so', async () => {
        const minab = createMinab({ schema: orderSchema(), inputs: { note: 'TEXT?' } });
        const program = await minab.prepare('note == null');
        expect(await program.run({ hostInputs: { note: null } })).toMatchObject({ ok: true, value: true });
    });

    test('an unknown field of a record input is a scope error', async () => {
        const program = await host().prepare('currentUser.nope == "x"');
        expect(program.ok).toBe(false);
        expect(program.diagnostics.map(d => d.code)).toContain('scope.unknownColumn');
    });

    test('a CITEXT field of a record input compares without case', async () => {
        const program = await host().prepare('currentUser.email == CAST("ADA@example.com" AS CITEXT)');
        expect(program.ok).toBe(true);
        const result = await program.run({ hostInputs: { currentUser: { email: 'ada@example.com' } } });
        expect(result).toMatchObject({ ok: true, value: true });
    });

    test('a roles array works with IN', async () => {
        const program = await host().prepare('"admin" IN currentUser.roles');
        expect(program.diagnostics).toEqual([]);
        expect(await program.run({ hostInputs: { currentUser: { roles: ['admin'] } } })).toMatchObject({ ok: true, value: true });
        expect(await program.run({ hostInputs: { currentUser: { roles: ['staff'] } } })).toMatchObject({ ok: true, value: false });
    });

    test('a host input reaches SQL as a bound parameter', async () => {
        const { port, calls } = fakeData([{ id: 'o-1' }]);
        const program = await host().prepare('FROM Order WHERE .status == currentUser.id SELECT .id');
        expect(program.diagnostics).toEqual([]);
        const result = await program.run({ hostInputs: { currentUser: { id: 'u-7' } } }, { data: port });
        expect(result).toMatchObject({ ok: true, value: [{ id: 'o-1' }] });
        expect(calls[0].params).toEqual(['u-7']);
    });

    test('assigning to a host input is scope.assignToInput', async () => {
        for (const source of ['currentUser = 1;\n1', 'currentUser.id = "x";\n1', 'url = 1;\n1']) {
            const program = await host().prepare(source);
            expect(program.ok, source).toBe(false);
            const found = program.diagnostics.find(d => d.code === 'scope.assignToInput');
            expect(found, source).toBeDefined();
            expect(found!.message).toBe(DIAGNOSTICS['scope.assignToInput'].message(found!.params as never));
        }
    });
});

describe('host functions (D27)', () => {
    const rates: HostFunctions = {
        call: (name, args) => {
            if (name !== 'fxRate') throw new Error(`unexpected ${name}`);
            return args[1] === 'USD' ? 1 : 2;
        }
    };

    test('fxRate("EUR", .status) checks, and runs through the host implementation', async () => {
        const program = await host().prepare('.total * fxRate("EUR", .status) > 1000');
        expect(program.diagnostics).toEqual([]);
        const same = await program.run({ record: { total: 600, status: 'USD' } }, { hostFunctions: rates });
        expect(same).toMatchObject({ ok: true, value: false });
        const converted = await program.run({ record: { total: 600, status: 'TRY' } }, { hostFunctions: rates });
        expect(converted).toMatchObject({ ok: true, value: true });
    });

    test('the implementation gets the argument values and a signal, and may be async', async () => {
        const seen: unknown[][] = [];
        const signals: AbortSignal[] = [];
        const controller = new AbortController();
        const program = await host().prepare('fxRate("EUR", "USD")');
        const result = await program.run(
            {},
            {
                hostFunctions: {
                    call: async (_name, args, context) => {
                        seen.push(args);
                        signals.push(context.signal);
                        return 4;
                    }
                }
            },
            { signal: controller.signal }
        );
        expect(result).toMatchObject({ ok: true, value: 4 });
        expect(seen).toEqual([['EUR', 'USD']]);
        // R4: the port gets one signal that joins the host's signal and the wall-time timer.
        expect(signals[0]).toBeInstanceOf(AbortSignal);
        expect(signals[0].aborted).toBe(false);
    });

    test('a call with no implementation is eval.hostFunctionMissing', async () => {
        const program = await host().prepare('fxRate("EUR", "USD")');
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'eval.hostFunctionMissing', params: { name: 'fxRate' } } });
    });

    test('a call with a wrong argument count or type does not check', async () => {
        const minab = host();
        expect((await minab.prepare('fxRate("EUR")')).diagnostics.map(d => d.code)).toContain('call.userArity');
        expect((await minab.prepare('fxRate(1, "USD")')).diagnostics.map(d => d.code)).toContain('call.argumentType');
    });

    test('compile of a query that uses a host function is compile.hostFunctionInSql', async () => {
        const minab = host();
        const query = await minab.prepare('FROM Order WHERE .total * fxRate("EUR", .status) > 1000 SELECT .id');
        expect(query.diagnostics).toEqual([]);
        expect(query.compile()).toMatchObject({ ok: false, error: { code: 'compile.hostFunctionInSql' } });
        const rule = await minab.prepare('fxRate("EUR", "USD") > 1');
        expect(rule.compile()).toMatchObject({ ok: false, error: { code: 'compile.hostFunctionInSql' } });
        // A program without one still compiles.
        expect((await minab.prepare('FROM Order SELECT .id')).compile().ok).toBe(true);
    });

    test('a user function is still compile.notSql', async () => {
        const program = await host().prepare('fn f(a: INTEGER): INTEGER { a }\nFROM Order WHERE f(1) == 1 SELECT .id');
        expect(program.compile()).toMatchObject({ ok: false, error: { code: 'compile.notSql' } });
    });

    test('a host function in a rule that also reads data: the data goes to SQL, the function runs in the host', async () => {
        const { port, calls } = fakeData([{ value: 3 }]);
        const program = await host().prepare('fxRate("EUR", "TRY") * COUNT(#Order[.status == "open"]) == 6');
        expect(program.diagnostics).toEqual([]);
        const result = await program.run({}, { data: port, hostFunctions: rates });
        expect(result).toMatchObject({ ok: true, value: true });
        expect(calls).toHaveLength(1);
        expect(calls[0].text).not.toContain('fxRate');
    });

    test('a function with an array type and a local flag is declared', async () => {
        const minab = createMinab({
            schema: orderSchema(),
            functions: [{ name: 'tagsOf', params: [{ name: 'id', type: 'TEXT' }], returns: 'TEXT[]', local: true }]
        });
        const program = await minab.prepare('tagsOf("a")');
        expect(program.resultType).toBe('TEXT[]');
    });
});

describe('names (D10, D11)', () => {
    test('a host function named RATE is an error at createMinab', () => {
        const declare = () => createMinab({ schema: orderSchema(), functions: [{ name: 'RATE', params: [], returns: 'DECIMAL' }] });
        expect(declare).toThrow(HostDeclarationError);
        expect(declare).toThrow(/lowercase letter/);
    });

    test('a host input needs a lowercase letter too', () => {
        expect(() => createMinab({ schema: orderSchema(), inputs: { USER: 'TEXT' } })).toThrow(/lowercase letter/);
    });

    test('other bad declarations give clear errors', () => {
        const schema = orderSchema();
        expect(() => createMinab({ schema, inputs: { 'a-b': 'TEXT' } })).toThrow(/starts with a letter/);
        expect(() => createMinab({ schema, inputs: { count: 'STRING' } })).toThrow(/not a Minab type/);
        expect(() => createMinab({ schema, inputs: { Customer: 'TEXT' } })).toThrow(/name of a table/);
        expect(() => createMinab({ schema, inputs: { who: {} } })).toThrow(/at least one field/);
        expect(() => createMinab({ schema, inputs: { who: { id: 'NOPE' } } })).toThrow(/field "id"/);
        expect(() =>
            createMinab({
                schema,
                functions: [
                    { name: 'a', params: [], returns: 'INTEGER' },
                    { name: 'a', params: [], returns: 'INTEGER' }
                ]
            })
        ).toThrow(/twice/);
        expect(() => createMinab({ schema, functions: [{ name: 'who', params: [], returns: 'INTEGER' }], inputs: { who: 'TEXT' } })).toThrow(/two names/);
    });

    test('a let, a parameter or an fn with a host name is scope.nameIsHostName', async () => {
        const minab = host();
        for (const source of [
            'let currentUser: TEXT = "x";\n1',
            'let fxRate: TEXT = "x";\n1',
            'fn check(url: TEXT): TEXT { url }\n1',
            'fn fxRate(a: INTEGER): INTEGER { a }\n1',
            'fn currentUser(a: INTEGER): INTEGER { a }\n1'
        ]) {
            const program = await minab.prepare(source);
            expect(program.ok, source).toBe(false);
            const found = program.diagnostics.find(d => d.code === 'scope.nameIsHostName');
            expect(found, source).toBeDefined();
            expect(found!.message).toBe(DIAGNOSTICS['scope.nameIsHostName'].message(found!.params as never));
        }
    });

    test('without the declaration, the same names are fine', async () => {
        const program = await createMinab({ schema: orderSchema() }).prepare('let currentUser: TEXT = "x";\ncurrentUser');
        expect(program.ok).toBe(true);
        expect(await program.run()).toMatchObject({ ok: true, value: 'x' });
    });

    test('a name resolves for the checker only when the host declared it', async () => {
        const schema = orderSchema();
        const infer = async (declared: boolean) => {
            const resolved = resolveHostDeclarations(declared ? { inputs } : undefined, schema);
            const { Minab } = createMinabServices(EmptyFileSystem, schema, { isFieldRule: false }, { host: resolved, mode: 'production' });
            const { document } = await validationHelper<Model>(Minab)('currentUser.id');
            const node = AstUtils.streamAst(document.parseResult.value).find(n => n.$type === 'MemberAccess');
            return Minab.typeChecker.inferType(node as Expression);
        };
        expect(await infer(true)).toMatchObject({ ok: true, type: { kind: 'scalar', base: 'TEXT' } });
        expect(await infer(false)).toMatchObject({ ok: false, code: 'scope.unknownName' });
    });

    test('the declarations are part of the service cache key', async () => {
        // Two runtimes with different declarations over one schema do not share a service set.
        const a = createMinab({ schema: orderSchema(), inputs: { x: 'TEXT' } });
        const b = createMinab({ schema: orderSchema(), inputs: { x: 'INTEGER' } });
        expect((await a.prepare('x')).resultType).toBe('TEXT');
        expect((await b.prepare('x')).resultType).toBe('INTEGER');
    });
});

describe('events (D33)', () => {
    test('a statement event goes out before each data call, with the source range', async () => {
        const order: string[] = [];
        const events: MinabEvent[] = [];
        const port: DataPort = {
            execute: () => {
                order.push('data');
                return Promise.resolve([{ value: false }]);
            }
        };
        const sink = {
            emit: (event: MinabEvent) => {
                events.push(event);
                order.push(event.kind === 'timing' ? `timing:${event.phase}` : event.kind);
            }
        };
        const program = await createMinab({ schema: orderSchema() }).prepare('EXISTS(#Order[.status == "a"]) OR EXISTS(#Order[.status == "b"])');
        const result = await program.run({}, { data: port, events: sink });
        expect(result.ok).toBe(true);
        expect(order).toEqual(['statement', 'data', 'timing:data', 'statement', 'data', 'timing:data', 'timing:run']);
        const statements = events.filter((e): e is Extract<MinabEvent, { kind: 'statement' }> => e.kind === 'statement');
        expect(statements).toHaveLength(2);
        expect(statements[0].sql).toContain('FROM "Order"');
        expect(statements[0].params).toEqual(['a']);
        expect(statements[1].params).toEqual(['b']);
        // The range is the pushed-down sub-expression, one for each statement.
        expect(statements[0].range?.start.character).toBeLessThan(statements[1].range!.start.character);
        expect(statements[0].range!.end.line).toBe(0);
        for (const event of events.filter(e => e.kind === 'timing')) expect(event.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('a query program reports the whole query as one statement', async () => {
        const events: MinabEvent[] = [];
        const { port } = fakeData([]);
        const program = await createMinab({ schema: orderSchema() }).prepare('FROM Order SELECT .id');
        await program.run({}, { data: port, events: { emit: e => events.push(e) } });
        const statement = events.find(e => e.kind === 'statement');
        expect(statement).toMatchObject({ kind: 'statement', range: { start: { line: 0, character: 0 } } });
    });

    test('a data failure still sends the timing event, and a throwing sink does not break the run', async () => {
        const events: MinabEvent[] = [];
        const failing: DataPort = { execute: () => Promise.reject(new Error('down')) };
        const program = await createMinab({ schema: orderSchema() }).prepare('FROM Order SELECT .id');
        // R4: a data port failure is a coded result. The driver's text is not copied into it.
        const failed = await program.run({}, { data: failing, events: { emit: e => events.push(e) } });
        expect(failed).toMatchObject({ ok: false, error: { code: 'data.error' } });
        expect(JSON.stringify(failed)).not.toContain('down');
        expect(events.map(e => e.kind)).toEqual(['statement', 'timing', 'timing']);

        const { port } = fakeData([]);
        const result = await program.run(
            {},
            {
                data: port,
                events: {
                    emit: () => {
                        throw new Error('sink bug');
                    }
                }
            }
        );
        expect(result).toMatchObject({ ok: true, value: [] });
    });

    test('a rule settled from the record sends no statement event', async () => {
        const events: MinabEvent[] = [];
        const program = await createMinab({ schema: orderSchema(), ruleContext: record }).prepare('.total > 1');
        await program.run({ record: { total: 5 } }, { events: { emit: e => events.push(e) } });
        expect(events.map(e => e.kind)).toEqual(['timing']);
    });
});

describe('data port', () => {
    test('execute gets the query and a signal; the run option signal is passed on', async () => {
        const { port, calls } = fakeData([{ id: 'o-1' }]);
        const program = await createMinab({ schema: orderSchema() }).prepare('FROM Order SELECT .id');
        const controller = new AbortController();
        await program.run({}, { data: port }, { signal: controller.signal });
        await program.run({}, { data: port });
        // R4: the port gets one signal that joins the host's signal and the wall-time timer.
        expect(calls[0].signal).toBeInstanceOf(AbortSignal);
        expect(calls[1].signal).toBeInstanceOf(AbortSignal);
        expect(calls[1].signal.aborted).toBe(false);
    });

    test('a plain QueryExecutor (one argument) still works as the data port', async () => {
        const legacy = { execute: () => Promise.resolve([{ id: 'o-2' }]) };
        const program = await createMinab({ schema: orderSchema() }).prepare('FROM Order SELECT .id');
        expect(await program.run({}, { data: legacy })).toMatchObject({ ok: true, value: [{ id: 'o-2' }] });
    });

    test('no data port is data.noPort', async () => {
        const program = await createMinab({ schema: orderSchema() }).prepare('FROM Order SELECT .id');
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'data.noPort' } });
    });
});

describe('clock', () => {
    test('the default clock is the system clock in UTC', () => {
        expect(SYSTEM_CLOCK.timeZone).toBe('UTC');
        expect(Math.abs(SYSTEM_CLOCK.now().getTime() - Date.now())).toBeLessThan(1000);
    });

    test('a run reads now() once, however many statements it makes', async () => {
        let reads = 0;
        const clock: ClockPort = {
            timeZone: 'Asia/Tehran',
            now: () => {
                reads++;
                return new Date('2026-10-03T10:00:00Z');
            }
        };
        const { port, calls } = fakeData([{ value: false }]);
        const program = await createMinab({ schema: orderSchema() }).prepare('EXISTS(#Order[.status == "a"]) OR EXISTS(#Order[.status == "b"])');
        await program.run({}, { data: port, clock });
        expect(calls).toHaveLength(2);
        expect(reads).toBe(1);
        await program.run({}, { data: port, clock });
        expect(reads).toBe(2);
    });

    test('a fixed clock gives the same now() to every read in a run', async () => {
        const fixed = new Date('2026-10-03T10:00:00Z');
        const seen: Array<Date | undefined> = [];
        const minab = createMinab({ schema: orderSchema(), functions: [{ name: 'probe', params: [], returns: 'INTEGER' }] });
        const program = await minab.prepare('probe() + probe()');
        // The interpreter holds the instant of the run; L6's NOW() will return it. Here we read it through the evaluation context.
        const services = (program as unknown as { interpreter: { run: (...a: unknown[]) => Promise<unknown> } }).interpreter;
        const original = services.run.bind(services);
        services.run = (model: unknown, context: unknown) => {
            const ctx = context as { now?: Date; timeZone?: string };
            seen.push(ctx.now);
            expect(ctx.timeZone).toBe('Europe/Istanbul');
            return original(model, context);
        };
        const result = await program.run({}, { clock: { now: () => fixed, timeZone: 'Europe/Istanbul' }, hostFunctions: { call: () => 1 } });
        expect(result).toMatchObject({ ok: true, value: 2 });
        expect(seen).toEqual([fixed]);
    });
});

describe('write port', () => {
    test('the default refuses with eval.writesNotSupported', async () => {
        await expect(REFUSING_WRITE_PORT.transaction(() => Promise.resolve(1), { signal: new AbortController().signal })).rejects.toMatchObject({
            code: 'eval.writesNotSupported'
        });
    });

    test('a host can give its own write port (the type is open for X5)', () => {
        const ports: RunPorts = {
            write: { transaction: work => work({ execute: () => Promise.resolve([]), executeWrite: () => Promise.resolve({ rows: [], affected: 0 }) }) }
        };
        expect(ports.write).toBeDefined();
    });
});

describe('schema.functions is gone', () => {
    test('a config with schema.functions gets an error that points to the new option', () => {
        expect(() => parseConfig({ schema: { tables: [], functions: [] } })).toThrow(/createMinab/);
        expect(() => parseConfig({ schema: { tables: [], functions: [] } })).toThrow(/functions/);
    });
});
