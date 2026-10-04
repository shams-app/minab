import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, test } from 'vitest';
import { demoDataset } from '../src/content/datasets/demo.js';
import { EngineClient, type EngineWorker } from '../src/client/engine-client.js';
import type { Engine } from '../src/engine/engine.js';
import type { EngineStatus, HostSettings } from '../src/engine/protocol.js';
import { serveEngine } from '../src/engine/worker.js';

/**
 * The client and the worker as the app runs them (H7): `createWorkerMinab` on one side, `serveMinab` with the
 * engine on the other. A `MessageChannel` stands in for the Web Worker, so no browser is needed.
 */

const demo: HostSettings = { config: { schema: demoDataset.schema, seed: demoDataset.seed }, dataSource: 'fixtures' };

const clients: EngineClient[] = [];
const engines: Engine[] = [];
let spawned = 0;

function spawn(): EngineWorker {
    const { port1, port2 } = new MessageChannel();
    const { engine } = serveEngine(port2 as never);
    engines.push(engine);
    spawned++;
    return Object.assign(port1, {
        terminate() {
            port1.close();
            port2.close();
        }
    }) as unknown as EngineWorker;
}

function client(): EngineClient {
    const c = new EngineClient(spawn);
    clients.push(c);
    return c;
}

afterEach(async () => {
    for (const c of clients.splice(0)) c.restart();
    for (const e of engines.splice(0)) await e.close();
});

describe('EngineClient over the browser bridge', () => {
    test('a call reaches the engine and its answer comes back', async () => {
        const engine = client();
        expect(await engine.call('setHost', demo)).toMatchObject({ ok: true });
        const report = await engine.call('analyze', 'FROM Order WHERE .total > 500 SELECT .id');
        expect(report.program.kind).toBe('query');
        expect(report.compiled).toMatchObject({ ok: true });
    });

    test('a run gives a full report', async () => {
        const engine = client();
        await engine.call('setHost', demo);
        const report = await engine.run('1 + 2', 1);
        expect(report.stage).toBe('done');
        expect(report.result).toMatchObject({ kind: 'value', value: 3 });
    });

    test('the status event arrives and listeners get the current status at once', async () => {
        const engine = client();
        const seen: EngineStatus[] = [];
        engine.onStatus(status => seen.push(status));
        expect(seen[0]).toEqual({ phase: 'starting' });
        await engine.call('setHost', demo);
        expect(seen.some(status => status.phase === 'ready')).toBe(true);
    });

    test('an error of the engine keeps its own message', async () => {
        const engine = client();
        await engine.call('setHost', demo);
        await expect(engine.call('tablePreview', 'Nope', 5)).rejects.toThrow('unknown table "Nope"');
    });

    test('restart fails the calls in flight with "the engine was restarted" and brings a new worker', async () => {
        const engine = client();
        await engine.call('setHost', demo);
        const before = spawned;
        const pending = engine.call('warmUp');
        engine.restart();
        await expect(pending).rejects.toThrow('the engine was restarted');
        expect(spawned).toBe(before + 1);
        expect(engine.status).toEqual({ phase: 'starting' });
        expect(await engine.call('setHost', demo)).toMatchObject({ ok: true });
    });

    test('a cancelled run rejects at once and the engine does not run it', async () => {
        const engine = client();
        await engine.call('setHost', demo);
        const controller = new AbortController();
        const answer = engine.run('1 + 2', 7, controller.signal);
        controller.abort();
        await expect(answer).rejects.toThrow(/cancel/i);
        // The engine is still usable.
        expect((await engine.run('1 + 2', 8)).stage).toBe('done');
    });

    test('the engine does not start a run whose signal is already aborted', async () => {
        const engine = client();
        await engine.call('setHost', demo);
        const controller = new AbortController();
        controller.abort();
        const report = await engines[0]!.run('1 + 2', 1, controller.signal);
        expect(report.stage).toBe('run');
        expect(report.error).toMatchObject({ kind: 'evaluation', message: 'the run was cancelled' });
        expect(report.result).toBeUndefined();
    });
});
