/**
 * Production plan phase H4 — the two-way bridge between the main thread and the Minab worker.
 * No browser is needed: a `MessageChannel` pair stands in for the worker. The bridge code does not
 * care what is on the other end of the port.
 */

import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, test } from 'vitest';
import { createWorkerMinab, type WorkerMinab, type WorkerMinabOptions } from '../../src/browser/index.js';
import { serveMinab, type ServeOptions } from '../../src/browser/worker.js';
import { Big } from '../../src/language/values.js';
import { PortError, type DataPort, type HostFunctions, type MinabEvent } from '../../src/runtime/index.js';
import { orderSchema } from '../support/runtime.js';

const record = { recordTable: 'Order', isFieldRule: false };
const functions = [{ name: 'fxRate', params: [{ name: 'from', type: 'TEXT' }], returns: 'DECIMAL' }];

const opened: WorkerMinab[] = [];

/** A runtime whose "worker" is the other end of a message channel in this thread. */
function setup(options: Partial<WorkerMinabOptions> = {}, serve: ServeOptions = {}) {
    const { port1, port2 } = new MessageChannel();
    const server = serveMinab(port2 as never, serve);
    const minab = createWorkerMinab({
        worker: () => port1 as never,
        schema: orderSchema(),
        ruleContext: record,
        functions,
        inputs: { limit: 'INTEGER' },
        ...options
    });
    opened.push(minab);
    return {
        minab,
        close() {
            minab.dispose();
            server.close();
            port1.close();
            port2.close();
        }
    };
}

afterEach(() => {
    for (const minab of opened.splice(0)) minab.dispose();
});

/** A data port that answers after `delayMs` and records its calls. */
function slowData(rows: Record<string, unknown>[], delayMs = 0) {
    const calls: { text: string; params: unknown[]; aborted: () => boolean }[] = [];
    const port: DataPort = {
        execute: (query, { signal }) =>
            new Promise((resolve, reject) => {
                calls.push({ text: query.text, params: query.params, aborted: () => signal.aborted });
                const timer = setTimeout(() => resolve(rows), delayMs);
                signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new Error('aborted'));
                });
            })
    };
    return { port, calls };
}

describe('prepare in the worker', () => {
    test('gives diagnostics, kind, result type and analysis', async () => {
        const { minab } = setup();
        const ok = await minab.prepare('.total > 1');
        expect(ok.ok).toBe(true);
        expect(ok.kind).toBe('record-rule');
        expect(ok.resultType).toBe('BOOLEAN');
        expect(ok.analysis.tier).toBe('local');
        expect(ok.dependsOn('total')).toBe(true);
        expect(ok.dependsOn('status')).toBe(false);
        const bad = await minab.prepare('.nope > 1');
        expect(bad.ok).toBe(false);
        expect(bad.diagnostics[0].code).toBeTypeOf('string');
    });

    test('compile runs in the worker', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        const sql = await program.compile();
        expect(sql.ok).toBe(true);
    });

    test('a wrong host declaration rejects the first prepare', async () => {
        const { minab } = setup({ functions: [{ name: 'BAD', params: [], returns: 'TEXT' }] });
        await expect(minab.prepare('1')).rejects.toThrow(/lowercase/);
    });
});

describe('run: values and ports', () => {
    test('a data port on the main thread is called from the worker', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order WHERE .status == "open" SELECT .id');
        const { port, calls } = slowData([{ id: 'o-1' }]);
        const result = await program.run({}, { data: port });
        expect(result).toMatchObject({ ok: true, value: [{ id: 'o-1' }] });
        expect(calls).toHaveLength(1);
        expect(calls[0].text).toContain('Order');
    });

    test('decimals and dates cross as exact strings and come back as values', async () => {
        const { minab } = setup();
        const rule = await minab.prepare('.total * 2');
        const run = await rule.run({ record: { total: new Big('0.1') } });
        expect(run).toMatchObject({ ok: true });
        expect(String((run as { value: unknown }).value)).toBe('0.2');
        const sum = await (await minab.prepare('limit + 1')).run({ hostInputs: { limit: 4 } });
        expect(sum).toMatchObject({ ok: true, value: 5 });
    });

    test('host functions run on the main thread, with typed arguments and results', async () => {
        const { minab } = setup();
        const program = await minab.prepare('fxRate("EUR") * 2');
        const calls: unknown[][] = [];
        const hostFunctions: HostFunctions = {
            call: (name, args) => {
                calls.push([name, ...args]);
                return new Big('1.1');
            }
        };
        const run = await program.run({}, { hostFunctions });
        expect(calls).toEqual([['fxRate', 'EUR']]);
        expect(String((run as { value: unknown }).value)).toBe('2.2');
    });

    test('the clock of the main thread is read once and used by the run', async () => {
        const { minab } = setup();
        const program = await minab.prepare('NOW()');
        let reads = 0;
        const clock = {
            now: () => {
                reads++;
                return new Date('2026-10-04T08:30:00.000Z');
            },
            timeZone: 'UTC'
        };
        const run = await program.run({}, { clock });
        expect(reads).toBe(1);
        expect(run).toMatchObject({ ok: true });
        expect(new Date((run as { value: string }).value).toISOString()).toBe('2026-10-04T08:30:00.000Z');
    });

    test('events cross to the main thread', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        const events: MinabEvent[] = [];
        await program.run({}, { data: slowData([]).port, events: { emit: event => events.push(event) } });
        expect(events.map(e => e.kind)).toContain('statement');
        expect(events.some(e => e.kind === 'timing' && e.phase === 'run')).toBe(true);
    });

    test('a port that lives inside the worker is used when the main thread gives none', async () => {
        const local = slowData([{ id: 'in-worker' }]);
        const { minab } = setup({}, { ports: { data: local.port } });
        const program = await minab.prepare('FROM Order SELECT .id');
        expect(await program.run()).toMatchObject({ ok: true, value: [{ id: 'in-worker' }] });
        expect(local.calls).toHaveLength(1);
    });
});

describe('run: errors, cancel, timeout', () => {
    test('an error from a port arrives with its code', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        const data: DataPort = { execute: () => Promise.reject(new PortError('data.error', 'the database is away')) };
        const result = await program.run({}, { data });
        expect(result).toMatchObject({ ok: false, error: { code: 'data.error' } });
    });

    test('a driver error keeps its sqlstate, and no raw Error crosses', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        const data: DataPort = { execute: () => Promise.reject(Object.assign(new Error('secret sql text'), { code: '22012' })) };
        const result = await program.run({}, { data });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero', params: { sqlstate: '22012' } } });
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    test('a run with no data port fails with data.noPort', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'data.noPort' } });
    });

    test('cancel during a port call ends the run and aborts the port call', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        const { port, calls } = slowData([], 5_000);
        const controller = new AbortController();
        const running = program.run({}, { data: port }, { signal: controller.signal });
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(calls).toHaveLength(1);
        controller.abort();
        expect(await running).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        expect(calls[0].aborted()).toBe(true);
    });

    test('a signal that is already aborted ends the run before any port is called', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        const { port, calls } = slowData([]);
        const result = await program.run({}, { data: port }, { signal: AbortSignal.abort() });
        expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        expect(calls).toHaveLength(0);
    });

    test('a port call with no answer fails with limit.timeout at the wall time, and the port is aborted', async () => {
        const { minab } = setup({ limits: { wallTimeMs: 100 } });
        const program = await minab.prepare('FROM Order SELECT .id');
        const { port, calls } = slowData([], 5_000);
        const started = Date.now();
        const result = await program.run({}, { data: port });
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.timeout' } });
        expect(Date.now() - started).toBeLessThan(2_000);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(calls[0].aborted()).toBe(true);
    });

    test('two runs at once do not mix their answers', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        const first = slowData([{ id: 'slow' }], 80);
        const second = slowData([{ id: 'fast' }], 5);
        const [a, b] = await Promise.all([program.run({}, { data: first.port }), program.run({}, { data: second.port })]);
        expect(a).toMatchObject({ value: [{ id: 'slow' }] });
        expect(b).toMatchObject({ value: [{ id: 'fast' }] });
    });

    test('cancelling one of two runs leaves the other running', async () => {
        const { minab } = setup();
        const program = await minab.prepare('FROM Order SELECT .id');
        const controller = new AbortController();
        const keep = program.run({}, { data: slowData([{ id: 'kept' }], 60).port });
        const stop = program.run({}, { data: slowData([], 5_000).port }, { signal: controller.signal });
        await new Promise(resolve => setTimeout(resolve, 20));
        controller.abort();
        expect(await stop).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        expect(await keep).toMatchObject({ ok: true, value: [{ id: 'kept' }] });
    });

    test('a value that does not fit its type is a wire.invalidValue error, not a crash', async () => {
        const { minab } = setup();
        const program = await minab.prepare('limit + 1');
        expect(await program.run({ hostInputs: { limit: 'x' } })).toMatchObject({ ok: false, error: { code: 'wire.invalidValue' } });
    });
});

describe('lifetime', () => {
    test('a released program refuses to run, and dispose stops the runtime', async () => {
        const { minab } = setup();
        const program = await minab.prepare('1 + 1');
        expect(await program.run()).toMatchObject({ ok: true, value: 2 });
        program.release();
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'wire.workerFailed' } });
        minab.dispose();
        await expect(minab.prepare('1')).rejects.toThrow(/disposed/);
    });

    test('the worker answers a message of an unknown version with nothing and keeps working', async () => {
        const { port1, port2 } = new MessageChannel();
        serveMinab(port2 as never);
        port1.postMessage({ v: 99, type: 'create', id: 'x' });
        const minab = createWorkerMinab({ worker: () => port1 as never, schema: orderSchema() });
        opened.push(minab);
        expect((await minab.prepare('1 + 1')).ok).toBe(true);
    });
});
