/**
 * Production plan phase H4 — the two-way bridge between a page and a Minab worker.
 * No browser is needed: a `MessageChannel` pair stands in for the worker. The bridge
 * only uses `postMessage` and `onmessage`, so the logic is the same.
 */

import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, test } from 'vitest';
import { createWorkerMinab, type WorkerMinab, type WorkerMinabOptions } from '../../src/browser/index.js';
import { serveWorker, type ServeOptions } from '../../src/browser/worker.js';
import { Big } from '../../src/language/values.js';
import { PortError, type DataPort, type MinabEvent } from '../../src/runtime/index.js';
import { orderSchema } from '../support/runtime.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Waits (up to 10 s) until `find` gives a value. The first parse in a process can be slow. */
async function until<T>(find: () => T | undefined): Promise<T> {
    for (let i = 0; i < 1000; i++) {
        const found = find();
        if (found !== undefined) return found;
        await delay(10);
    }
    throw new Error('timed out while waiting for a message');
}
const recordRule = { isFieldRule: false, recordTable: 'Order' };
const fieldRule = {
    isFieldRule: true,
    recordTable: 'Order',
    fieldType: { kind: 'scalar', base: 'UUID', nullable: false, array: false, arrayNullable: false }
} as const;

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
});

/** A worker made of a message channel. The page gets one port, `serveWorker` gets the other. */
function bridge(serve: ServeOptions = {}, options: Partial<WorkerMinabOptions> = {}) {
    const channel = new MessageChannel();
    const stop = serveWorker(channel.port2 as never, serve);
    const minab: WorkerMinab = createWorkerMinab({
        schema: orderSchema(),
        ruleContext: recordRule,
        ...options,
        worker: () => channel.port1 as never
    });
    cleanup.push(() => {
        minab.dispose();
        stop();
        channel.port1.close();
        channel.port2.close();
    });
    return { minab, channel };
}

/** Sends one raw message to a served worker and waits for its answer. */
function rawRequest(message: unknown, serve: ServeOptions = {}): Promise<Record<string, unknown>> {
    const channel = new MessageChannel();
    const stop = serveWorker(channel.port2 as never, serve);
    cleanup.push(() => {
        stop();
        channel.port1.close();
        channel.port2.close();
    });
    return new Promise(resolve => {
        channel.port1.once('message', resolve as never);
        channel.port1.postMessage(message);
    });
}

describe('a data port on the page, called from the worker', () => {
    test('prepare and run give the answer, and the worker called the page port', async () => {
        const { minab } = bridge({}, { ruleContext: fieldRule });
        const program = await minab.prepare('EXISTS(#Customer[.id == $])');
        expect(program.ok).toBe(true);
        expect(program.analysis.needsData).toBe(true);
        const queries: unknown[] = [];
        const data: DataPort = {
            async execute(query) {
                queries.push(query);
                return [{ value: true }];
            }
        };
        const result = await program.run({ fieldValue: 'c-1' }, { data });
        expect(result).toMatchObject({ ok: true, value: true });
        expect(queries).toHaveLength(1);
        expect(queries[0]).toMatchObject({ params: ['c-1'] });
    });

    test('with no data port the run fails with data.noPort', async () => {
        const { minab } = bridge({}, { ruleContext: fieldRule });
        const program = await minab.prepare('EXISTS(#Customer[.id == $])');
        const result = await program.run({ fieldValue: 'c-1' });
        expect(result).toMatchObject({ ok: false, error: { code: 'data.noPort' } });
    });

    test('a row with a decimal arrives as exact text', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .total');
        const when = new Date('2026-10-02T08:30:00.000Z');
        const data: DataPort = { execute: async () => [{ total: new Big('24.90'), at: when }] };
        const result = await program.run({}, { data });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const rows = result.value as Array<Record<string, unknown>>;
        // The runtime gives a decimal result as exact text, the same as without a worker.
        expect(rows[0].total).toBe('24.9');
    });
});

describe('inputs, values, host functions, clock, events', () => {
    test('a decimal record field is exact (0.1 * 2 is 0.2)', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('.total * 2');
        const result = await program.run({ record: { total: new Big('0.1') } });
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) return;
        expect(result.value).toBe('0.2');
    });

    test('a host function runs on the page', async () => {
        const { minab } = bridge({}, { functions: [{ name: 'fxRate', params: [{ name: 'code', type: 'TEXT' }], returns: 'DECIMAL', local: true }] });
        const program = await minab.prepare('fxRate("EUR") * 2');
        expect(program.diagnostics).toEqual([]);
        const seen: unknown[][] = [];
        const result = await program.run({}, { hostFunctions: { call: (_name, args) => (seen.push(args), new Big('1.5')) } });
        expect(seen).toEqual([['EUR']]);
        expect(result).toMatchObject({ ok: true });
        expect(String((result as { value: unknown }).value)).toBe('3');
    });

    test('the clock is read once for each run, and the events reach the page', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .id');
        let reads = 0;
        const events: MinabEvent[] = [];
        const ports = {
            data: { execute: async () => [] },
            clock: {
                now: () => (reads++, new Date('2026-10-03T10:00:00Z')),
                timeZone: 'Europe/Istanbul'
            },
            events: { emit: (event: MinabEvent) => void events.push(event) }
        };
        const result = await program.run({}, ports);
        expect(result.ok).toBe(true);
        expect(reads).toBe(1);
        await delay(10);
        expect(events.map(e => e.kind)).toContain('statement');
        expect(events.find(e => e.kind === 'timing' && e.phase === 'run')).toBeDefined();
    });

    test('compile() and dependsOn() work on the page', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order WHERE .total > 5 SELECT .id');
        const compiled = program.compile();
        expect(compiled.ok).toBe(true);
        expect(program.dependsOn('total')).toBe(false); // a query does not read the record under validation
        const rule = await minab.prepare('.total > 5');
        expect(rule.dependsOn('total')).toBe(true);
        expect(rule.dependsOn('status')).toBe(false);
    });

    test('a program with errors has diagnostics and refuses to run', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('nope(');
        expect(program.ok).toBe(false);
        expect(program.diagnostics.length).toBeGreaterThan(0);
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'eval.programInvalid' } });
    });
});

describe('cancel and timeout', () => {
    test('an AbortSignal stops the run during a port call, and the page port sees the abort', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .id');
        const controller = new AbortController();
        let seen: AbortSignal | undefined;
        let started!: () => void;
        const portStarted = new Promise<void>(resolve => (started = resolve));
        const data: DataPort = {
            execute: (_query, context) => {
                seen = context.signal;
                started();
                return new Promise(() => {}); // never answers
            }
        };
        const running = program.run({}, { data }, { signal: controller.signal });
        await portStarted;
        controller.abort();
        expect(await running).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        await delay(20);
        expect(seen?.aborted).toBe(true);
    });

    test('a signal that is already aborted ends the run before any port call', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .id');
        const controller = new AbortController();
        controller.abort();
        let called = false;
        const result = await program.run({}, { data: { execute: async () => ((called = true), []) } }, { signal: controller.signal });
        expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        expect(called).toBe(false);
    });

    test('a port that never answers fails with limit.timeout after the wall time', async () => {
        const { minab } = bridge({}, { limits: { wallTimeMs: 60 } });
        const program = await minab.prepare('FROM Order SELECT .id');
        const started = performance.now();
        const result = await program.run({}, { data: { execute: () => new Promise(() => {}) } });
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.timeout', params: { limit: 60 } } });
        expect(performance.now() - started).toBeLessThan(2000);
    });

    test('a page that never answers the clock fails the run with limit.timeout', async () => {
        const channel = new MessageChannel();
        const stop = serveWorker(channel.port2 as never);
        cleanup.push(() => (stop(), channel.port1.close(), channel.port2.close()));
        const answers: Array<Record<string, unknown>> = [];
        channel.port1.on('message', m => answers.push(m as Record<string, unknown>));
        channel.port1.postMessage({ v: 1, type: 'create', id: 1, options: { schema: orderSchema(), limits: { wallTimeMs: 60 } } });
        channel.port1.postMessage({ v: 1, type: 'prepare', id: 2, source: '1 + 1' });
        const program = ((await until(() => answers.find(a => a.id === 2))) as { value: { program: number } }).value.program;
        channel.port1.postMessage({ v: 1, type: 'run', id: 3, program, inputs: {}, ports: ['clock'] });
        const done = (await until(() => answers.find(a => a.id === 3))) as { value: { ok: boolean; error: { code: string } } };
        expect(answers.find(a => a.type === 'port-call')).toMatchObject({ port: 'clock' });
        expect(done.value).toMatchObject({ ok: false, error: { code: 'limit.timeout' } });
    });

    test('RunOptions limits can only be tighter', async () => {
        const { minab } = bridge({}, { limits: { statements: 1 } });
        const program = await minab.prepare('FROM Order SELECT .id');
        const data: DataPort = { execute: async () => [] };
        expect(await program.run({}, { data }, { limits: { statements: 5 } })).toMatchObject({ ok: true });
        expect(await program.run({}, { data }, { limits: { statements: 1 } })).toMatchObject({ ok: true });
    });
});

describe('errors cross as codes', () => {
    test('a PortError from the page port arrives with its code', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .id');
        const data: DataPort = {
            execute: async () => {
                throw new PortError('data.noPort', 'no port here');
            }
        };
        const result = await program.run({}, { data });
        expect(result).toMatchObject({ ok: false, error: { code: 'data.noPort', message: 'no port here' } });
    });

    test('a driver error keeps its SQLSTATE mapping and never its text', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .id');
        const driver = Object.assign(new Error('SELECT secret FROM users failed'), { code: '22012' });
        const result = await program.run({}, { data: { execute: async () => Promise.reject(driver) } });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero' } });
        expect(JSON.stringify(result)).not.toContain('secret');
        const other = await program.run({}, { data: { execute: async () => Promise.reject(new Error('password=hunter2')) } });
        expect(other).toMatchObject({ ok: false, error: { code: 'data.error' } });
        expect(JSON.stringify(other)).not.toContain('hunter2');
    });

    test('a value that cannot cross becomes a coded error, not a crash', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .id');
        const result = await program.run({}, { data: { execute: async () => [{ id: () => 1 }] } });
        expect(result.ok).toBe(false);
        const bad = await program.run({ record: { total: () => 1 } });
        expect(bad).toMatchObject({ ok: false, error: { code: 'wire.invalidValue' } });
    });
});

describe('runs at the same time', () => {
    test('two runs at once do not mix their answers', async () => {
        const { minab } = bridge({}, { ruleContext: fieldRule });
        const program = await minab.prepare('EXISTS(#Customer[.id == $])');
        const known = new Set(Array.from({ length: 30 }, (_, i) => `c-${i}`).filter((_, i) => i % 3 === 0));
        const data: DataPort = {
            async execute(query) {
                await delay(Math.random() * 15);
                return [{ value: known.has(String(query.params[0])) }];
            }
        };
        const results = await Promise.all(Array.from({ length: 30 }, (_, i) => program.run({ fieldValue: `c-${i}` }, { data })));
        expect(results.map(r => r.ok && r.value)).toEqual(Array.from({ length: 30 }, (_, i) => known.has(`c-${i}`)));
    });

    test('each run uses its own ports', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .total');
        const make = (n: number): DataPort => ({
            async execute() {
                await delay(n === 1 ? 20 : 1);
                return [{ total: n }];
            }
        });
        const [a, b] = await Promise.all([program.run({}, { data: make(1) }), program.run({}, { data: make(2) })]);
        expect(a).toMatchObject({ ok: true, value: [{ total: 1 }] });
        expect(b).toMatchObject({ ok: true, value: [{ total: 2 }] });
    });

    test('cancelling one run leaves the other alone', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('FROM Order SELECT .total');
        const controller = new AbortController();
        const slow: DataPort = { execute: () => new Promise(() => {}) };
        const quick: DataPort = { execute: async () => [{ total: 7 }] };
        const first = program.run({}, { data: slow }, { signal: controller.signal });
        const second = program.run({}, { data: quick });
        await delay(10);
        controller.abort();
        expect(await first).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        expect(await second).toMatchObject({ ok: true, value: [{ total: 7 }] });
    });
});

describe('a port that lives in the worker', () => {
    test('the worker-side data port is used when the page gives none', async () => {
        const inside: DataPort = { execute: async () => [{ total: 5 }] };
        const { minab } = bridge({ ports: { data: inside } });
        const program = await minab.prepare('FROM Order SELECT .total');
        expect(await program.run()).toMatchObject({ ok: true, value: [{ total: 5 }] });
        // A port the page gives for this run wins.
        expect(await program.run({}, { data: { execute: async () => [{ total: 9 }] } })).toMatchObject({ value: [{ total: 9 }] });
    });
});

describe('the protocol itself', () => {
    test('a message with another version is refused with wire.badMessage', async () => {
        const answer = await rawRequest({ v: 2, type: 'prepare', id: 7, source: '1' });
        expect(answer).toMatchObject({ type: 'response', id: 7, ok: false, error: { code: 'wire.badMessage' } });
    });

    test('a request before create is refused with wire.badMessage', async () => {
        const answer = await rawRequest({ v: 1, type: 'prepare', id: 3, source: '1' });
        expect(answer).toMatchObject({ id: 3, ok: false, error: { code: 'wire.badMessage' } });
    });

    test('an unexpected failure in the worker is wire.workerFailed, with the id', async () => {
        const channel = new MessageChannel();
        const stop = serveWorker(channel.port2 as never);
        cleanup.push(() => (stop(), channel.port1.close(), channel.port2.close()));
        const answers: Array<Record<string, unknown>> = [];
        channel.port1.on('message', m => answers.push(m as Record<string, unknown>));
        channel.port1.postMessage({ v: 1, type: 'create', id: 1, options: { schema: orderSchema() } });
        channel.port1.postMessage({ v: 1, type: 'prepare', id: 2, source: 42 });
        expect(await until(() => answers.find(a => a.id === 2))).toMatchObject({ ok: false, error: { code: 'wire.workerFailed' } });
    });

    test('the page refuses a port call for a method that is not on the list', async () => {
        const channel = new MessageChannel();
        const minab = createWorkerMinab({ schema: orderSchema(), worker: () => channel.port1 as never });
        cleanup.push(() => (minab.dispose(), channel.port1.close(), channel.port2.close()));
        const seen: Array<Record<string, unknown>> = [];
        channel.port2.on('message', m => {
            const message = m as Record<string, unknown>;
            seen.push(message);
            if (message.type === 'create') channel.port2.postMessage({ v: 1, type: 'response', id: message.id, ok: true, value: null });
            if (message.type === 'prepare') {
                const analysis = {
                    tables: [],
                    recordFields: [],
                    dependencies: [],
                    readsWholeRecord: false,
                    readsFieldValue: false,
                    inputs: [],
                    hostFunctions: [],
                    userFunctions: [],
                    builtins: [],
                    needsData: true,
                    writes: false,
                    tier: 'data'
                };
                const value = {
                    program: 1,
                    diagnostics: [],
                    kind: 'value',
                    analysis,
                    compile: { ok: false, error: { code: 'compile.notSql', message: '', params: {} } }
                };
                channel.port2.postMessage({ v: 1, type: 'response', id: message.id, ok: true, value });
            }
            if (message.type === 'run') {
                channel.port2.postMessage({ v: 1, type: 'port-call', callId: 9, runId: message.id, port: 'data', method: 'drop', args: [] });
            }
        });
        const program = await minab.prepare('1');
        void program.run({}, { data: { execute: async () => [] } });
        expect(await until(() => seen.find(m => m.type === 'port-result'))).toMatchObject({ callId: 9, ok: false, error: { code: 'wire.badMessage' } });
    });

    test('an old prepared program that the worker dropped gives wire.programExpired', async () => {
        const { minab } = bridge({ maxPrograms: 1 });
        const first = await minab.prepare('1 + 1');
        await minab.prepare('2 + 2');
        expect(await first.run()).toMatchObject({ ok: false, error: { code: 'wire.programExpired' } });
    });
});

describe('dispose', () => {
    test('a disposed runtime fails with wire.workerStopped', async () => {
        const { minab } = bridge();
        const program = await minab.prepare('1 + 1');
        minab.dispose();
        await expect(minab.prepare('1')).rejects.toMatchObject({ code: 'wire.workerStopped' });
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'wire.workerStopped' } });
    });

    test('a request that waits when dispose is called fails with wire.workerStopped', async () => {
        const { minab } = bridge();
        const waiting = minab.prepare('1 + 1');
        minab.dispose();
        await expect(waiting).rejects.toMatchObject({ code: 'wire.workerStopped' });
    });

    test('a worker error event stops the runtime', async () => {
        const channel = new MessageChannel();
        const minab = createWorkerMinab({ schema: orderSchema(), worker: () => Object.assign(channel.port1, { onerror: null }) as never });
        cleanup.push(() => (minab.dispose(), channel.port1.close(), channel.port2.close()));
        const worker = channel.port1 as unknown as { onerror: (event: unknown) => void };
        worker.onerror({});
        await expect(minab.prepare('1')).rejects.toMatchObject({ code: 'wire.workerStopped' });
    });
});

describe('startup checks, like createMinab', () => {
    test('a bad host function name throws at once, on the page', () => {
        const channel = new MessageChannel();
        cleanup.push(() => (channel.port1.close(), channel.port2.close()));
        expect(() =>
            createWorkerMinab({ schema: orderSchema(), functions: [{ name: 'RATE', params: [], returns: 'DECIMAL' }], worker: () => channel.port1 as never })
        ).toThrow(/RATE/);
    });

    test('prepare needs a string', async () => {
        const { minab } = bridge();
        await expect(minab.prepare(42 as never)).rejects.toThrow(TypeError);
    });
});
