/**
 * Production plan phase H7 — host requests and host events on the bridge.
 * A `MessageChannel` pair stands in for the worker, as in `bridge.test.ts`.
 */

import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, test } from 'vitest';
import { createWorkerMinab, type WorkerMinab } from '../../src/browser/index.js';
import { serveMinab, type MinabServer, type ServeOptions } from '../../src/browser/worker.js';
import { orderSchema } from '../support/runtime.js';

const opened: { minab: WorkerMinab; server: MinabServer }[] = [];

function setup(serve: ServeOptions) {
    const { port1, port2 } = new MessageChannel();
    const server = serveMinab(port2 as never, serve);
    const minab = createWorkerMinab({ worker: () => port1 as never, schema: orderSchema() });
    opened.push({ minab, server });
    return { minab, server, port1, port2 };
}

afterEach(() => {
    for (const { minab, server } of opened.splice(0)) {
        minab.dispose();
        server.close();
    }
});

describe('host requests', () => {
    test('a request gives the value of its handler', async () => {
        const { minab } = setup({ requests: { double: payload => (payload as number) * 2, nothing: () => undefined } });
        expect(await minab.request('double', 21)).toBe(42);
        expect(await minab.request('nothing')).toBeNull();
    });

    test('an async handler is awaited', async () => {
        const { minab } = setup({ requests: { later: async payload => ({ got: payload }) } });
        expect(await minab.request('later', { a: 1 })).toEqual({ got: { a: 1 } });
    });

    test('an unknown name fails with wire.requestFailed', async () => {
        const { minab } = setup({ requests: {} });
        await expect(minab.request('missing')).rejects.toThrow('unknown request missing');
        await expect(minab.request('toString')).rejects.toThrow('unknown request toString');
    });

    test('a handler that throws keeps its message', async () => {
        const { minab } = setup({
            requests: {
                boom: () => {
                    throw new Error('could not create the demo tables: nope');
                }
            }
        });
        await expect(minab.request('boom')).rejects.toThrow('could not create the demo tables: nope');
    });

    test('an abort rejects at once and aborts the signal of the handler', async () => {
        let seen: AbortSignal | undefined;
        const { minab } = setup({
            requests: {
                slow: (_payload, { signal }) =>
                    new Promise(resolve => {
                        seen = signal;
                        signal.addEventListener('abort', () => resolve('too late'));
                    })
            }
        });
        const controller = new AbortController();
        const answer = minab.request('slow', undefined, { signal: controller.signal });
        await new Promise(resolve => setTimeout(resolve, 20));
        controller.abort();
        await expect(answer).rejects.toThrow(/cancel/i);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(seen?.aborted).toBe(true);
    });

    test('a signal that is already aborted never reaches the worker', async () => {
        let calls = 0;
        const { minab } = setup({ requests: { count: () => ++calls } });
        const controller = new AbortController();
        controller.abort();
        await expect(minab.request('count', undefined, { signal: controller.signal })).rejects.toThrow(/cancel/i);
        expect(calls).toBe(0);
    });

    test('a disposed runtime does not take requests', async () => {
        const { minab } = setup({ requests: { ok: () => 1 } });
        minab.dispose();
        await expect(minab.request('ok')).rejects.toThrow('disposed');
    });
});

describe('host events', () => {
    test('an event reaches the listener, and the unsubscribe stops it', async () => {
        const { minab, server } = setup({});
        const seen: [string, unknown][] = [];
        const off = minab.onEvent((name, payload) => seen.push([name, payload]));
        server.emit('status', { phase: 'ready' });
        await new Promise(resolve => setTimeout(resolve, 20));
        off();
        server.emit('status', { phase: 'later' });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(seen).toEqual([['status', { phase: 'ready' }]]);
    });

    test('a listener that throws does not stop the others', async () => {
        const { minab, server } = setup({});
        const seen: unknown[] = [];
        minab.onEvent(() => {
            throw new Error('bad listener');
        });
        minab.onEvent((_name, payload) => seen.push(payload));
        server.emit('tick', 1);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(seen).toEqual([1]);
    });
});

describe('one server for each endpoint', () => {
    test('a second serveMinab on the same endpoint replaces the first', async () => {
        const { port1, port2 } = new MessageChannel();
        const first = serveMinab(port2 as never, { requests: { who: () => 'first' } });
        const second = serveMinab(port2 as never, { requests: { who: () => 'second' } });
        const minab = createWorkerMinab({ worker: () => port1 as never, schema: orderSchema() });
        opened.push({ minab, server: second });
        expect(await minab.request('who')).toBe('second');
        first.emit('ignored');
        second.close();
    });
});
