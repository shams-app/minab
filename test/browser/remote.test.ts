/**
 * Production plan phase H5 — the remote client, the tier router and the console sink.
 * A mock `fetch` stands in for the server. The local side is the H4 worker over a `MessageChannel`.
 */

import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, test } from 'vitest';
import {
    consoleEventSink,
    createRemoteMinab,
    createWorkerMinab,
    routeByTier,
    type FetchLike,
    type RemoteMinab,
    type WorkerMinab
} from '../../src/browser/index.js';
import { serveMinab } from '../../src/browser/worker.js';
import { runError } from '../../src/runtime/errors.js';
import type { WireRequest } from '../../src/runtime/wire.js';
import { orderSchema } from '../support/runtime.js';

const record = { recordTable: 'Order', isFieldRule: false };
const stats = { statements: 0, rows: 0, durationMs: 1 };

/** A fetch that records its requests. `answer` builds the response from the request. */
function mockFetch(
    answer: (request: WireRequest) => unknown = request => ({ v: 1, results: request.runs.map(r => ({ id: r.id, ok: true, value: true, stats })) })
) {
    const requests: WireRequest[] = [];
    const signals: AbortSignal[] = [];
    const fetch: FetchLike = (_url, init) => {
        const request = JSON.parse(init.body) as WireRequest;
        requests.push(request);
        signals.push(init.signal);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer(request)) });
    };
    return { fetch, requests, signals };
}

const clients: RemoteMinab[] = [];
const locals: WorkerMinab[] = [];
afterEach(() => {
    for (const client of clients.splice(0)) client.dispose();
    for (const local of locals.splice(0)) local.dispose();
});

function remote(options: Parameters<typeof createRemoteMinab>[0]) {
    const client = createRemoteMinab(options);
    clients.push(client);
    return client;
}

function localMinab() {
    const { port1, port2 } = new MessageChannel();
    serveMinab(port2 as never);
    const minab = createWorkerMinab({ worker: () => port1 as never, schema: orderSchema(), ruleContext: record });
    locals.push(minab);
    return minab;
}

describe('createRemoteMinab', () => {
    test('sends the program reference and the inputs, never SQL or source', async () => {
        const { fetch, requests } = mockFetch();
        const client = remote({ endpoint: 'https://app.test/run', fetch });
        const result = await client.run({ id: 'view:visible', version: '17' }, { record: { total: 5 }, hostInputs: { limit: 3 } });
        expect(result).toMatchObject({ ok: true, value: true });
        expect(requests).toHaveLength(1);
        const [run] = requests[0].runs;
        expect(run.program).toEqual({ ref: { id: 'view:visible', version: '17' } });
        expect(run.record).toEqual({ total: 5 });
        expect(run.inputs).toEqual({ limit: 3 });
        const text = JSON.stringify(requests[0]);
        expect(text).not.toMatch(/source|SELECT|schema/i);
    });

    test('headers (also from a function) reach the request', async () => {
        const seen: Record<string, string>[] = [];
        const fetch: FetchLike = (_url, init) => {
            seen.push(init.headers);
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 1, results: [{ id: 'q0', ok: true, value: 1, stats }] }) });
        };
        await remote({ endpoint: 'x', fetch, headers: () => Promise.resolve({ authorization: 'Bearer t' }) }).run({ id: 'a', version: '1' });
        expect(seen[0].authorization).toBe('Bearer t');
        expect(seen[0]['content-type']).toBe('application/json');
    });

    test('ten runs in one tick make one request, and each caller gets its own answer', async () => {
        const { fetch, requests } = mockFetch(request => ({
            v: 1,
            // Answer in reverse order on purpose: the client matches by id.
            results: [...request.runs].reverse().map(r => ({ id: r.id, ok: true, value: (r.inputs as { n: number }).n * 2, stats }))
        }));
        const client = remote({ endpoint: 'x', fetch });
        const results = await Promise.all(Array.from({ length: 10 }, (_, n) => client.run({ id: 'p', version: '1' }, { hostInputs: { n } })));
        expect(requests).toHaveLength(1);
        expect(requests[0].runs).toHaveLength(10);
        expect(results.map(r => (r as { value: number }).value)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    });

    test('a batch over the limit is split into several requests', async () => {
        const { fetch, requests } = mockFetch();
        const client = remote({ endpoint: 'x', fetch, maxBatch: 4 });
        await Promise.all(Array.from({ length: 10 }, () => client.run({ id: 'p', version: '1' })));
        expect(requests.map(r => r.runs.length)).toEqual([4, 4, 2]);
    });

    test('an abort during a remote run gives `cancelled` and aborts the fetch', async () => {
        const { fetch, signals } = mockFetch();
        const slow: FetchLike = (url, init) => {
            void fetch(url, init);
            return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
        };
        const controller = new AbortController();
        const pending = remote({ endpoint: 'x', fetch: slow }).run({ id: 'p', version: '1' }, {}, { signal: controller.signal });
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(signals[0].aborted).toBe(false);
        controller.abort();
        expect(await pending).toEqual({ ok: false, error: runError('cancelled', undefined) });
        expect(signals[0].aborted).toBe(true);
    });

    test('a run that is aborted before the tick never reaches the network', async () => {
        const { fetch, requests } = mockFetch();
        const client = remote({ endpoint: 'x', fetch });
        const controller = new AbortController();
        const first = client.run({ id: 'p', version: '1' }, {}, { signal: controller.signal });
        const second = client.run({ id: 'p', version: '1' });
        controller.abort();
        expect(await first).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        expect(await second).toMatchObject({ ok: true });
        expect(requests[0].runs).toHaveLength(1);
    });

    test('a decimal result is decoded with the result type', async () => {
        const { fetch } = mockFetch(request => ({ v: 1, results: request.runs.map(r => ({ id: r.id, ok: true, value: '24.9', stats })) }));
        const result = await remote({ endpoint: 'x', fetch }).run({ id: 'p', version: '1' }, {}, { resultType: 'DECIMAL' });
        expect(String((result as { value: unknown }).value)).toBe('24.9');
        expect((result as { value: object }).value).toHaveProperty('plus');
    });

    test('a failing run and a failing request come back as coded errors', async () => {
        const failing = mockFetch(request => ({
            v: 1,
            results: request.runs.map(r => ({ id: r.id, ok: false, error: { code: 'limit.timeout', message: 'too slow', params: {} } }))
        }));
        expect(await remote({ endpoint: 'x', fetch: failing.fetch }).run({ id: 'p', version: '1' })).toMatchObject({
            ok: false,
            error: { code: 'limit.timeout' }
        });
        const whole = mockFetch(() => ({ v: 1, error: { code: 'wire.tooManyRuns', message: 'm', params: { limit: 1, used: 2 } } }));
        expect(await remote({ endpoint: 'x', fetch: whole.fetch }).run({ id: 'p', version: '1' })).toMatchObject({
            ok: false,
            error: { code: 'wire.tooManyRuns' }
        });
        const network: FetchLike = () => Promise.reject(new Error('offline'));
        expect(await remote({ endpoint: 'x', fetch: network }).run({ id: 'p', version: '1' })).toMatchObject({
            ok: false,
            error: { code: 'wire.remoteFailed' }
        });
        const garbage = mockFetch(() => ({ nonsense: true }));
        expect(await remote({ endpoint: 'x', fetch: garbage.fetch }).run({ id: 'p', version: '1' })).toMatchObject({
            ok: false,
            error: { code: 'wire.invalidResponse' }
        });
    });

    test('a missing result for a run is `wire.remoteFailed`', async () => {
        const { fetch } = mockFetch(() => ({ v: 1, results: [] }));
        expect(await remote({ endpoint: 'x', fetch }).run({ id: 'p', version: '1' })).toMatchObject({ ok: false, error: { code: 'wire.remoteFailed' } });
    });

    test('remote logs arrive in the console sink', async () => {
        const { fetch } = mockFetch(request => ({
            v: 1,
            results: request.runs.map(r => ({ id: r.id, ok: true, value: 1, logs: ['first', 'second'], stats }))
        }));
        const lines: unknown[][] = [];
        const events = consoleEventSink({ console: { log: (...args) => lines.push(args), debug: () => {} } });
        await remote({ endpoint: 'x', fetch, events }).run({ id: 'p', version: '1' });
        expect(lines).toEqual([['[minab] first'], ['[minab] second']]);
    });

    test('a disposed client answers `cancelled`', async () => {
        const client = remote({ endpoint: 'x', fetch: mockFetch().fetch });
        client.dispose();
        expect(await client.run({ id: 'p', version: '1' })).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    });
});

describe('routeByTier', () => {
    test('a local-tier rule runs in the worker with zero fetch calls', async () => {
        const { fetch, requests } = mockFetch();
        const router = routeByTier({ local: localMinab(), remote: remote({ endpoint: 'x', fetch }) });
        const program = await router.prepare({ id: 'r1', version: '1', source: '.total > 1' });
        expect(program.route).toBe('local');
        expect(await program.run({ record: { total: 5 } })).toMatchObject({ ok: true, value: true });
        expect(requests).toHaveLength(0);
    });

    test('a data-tier rule sends one request with the reference and the inputs, and no SQL', async () => {
        const { fetch, requests } = mockFetch(request => ({ v: 1, results: request.runs.map(r => ({ id: r.id, ok: true, value: [{ id: 'o-1' }], stats })) }));
        const router = routeByTier({ local: localMinab(), remote: remote({ endpoint: 'x', fetch }) });
        const program = await router.prepare({ id: 'r2', version: '9', source: 'FROM Order WHERE .status == "open" SELECT .id' });
        expect(program.route).toBe('remote');
        expect(program.analysis.tier).toBe('data');
        const result = await program.run({ record: { status: 'open' } });
        expect(result).toMatchObject({ ok: true, value: [{ id: 'o-1' }] });
        expect(requests).toHaveLength(1);
        expect(requests[0].runs[0].program).toEqual({ ref: { id: 'r2', version: '9' } });
        expect(requests[0].runs[0].record).toEqual({ status: 'open' });
        expect(JSON.stringify(requests[0])).not.toMatch(/SELECT|FROM|"source"/);
    });

    test('a program with a check error stays local and gives its error', async () => {
        const { fetch, requests } = mockFetch();
        const router = routeByTier({ local: localMinab(), remote: remote({ endpoint: 'x', fetch }) });
        const program = await router.prepare({ id: 'r3', version: '1', source: 'FROM Nope SELECT .id' });
        expect(program.ok).toBe(false);
        expect(program.route).toBe('local');
        expect(await program.run()).toMatchObject({ ok: false });
        expect(requests).toHaveLength(0);
    });

    test('an abort of a routed remote run gives `cancelled`', async () => {
        const slow: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
        const router = routeByTier({ local: localMinab(), remote: remote({ endpoint: 'x', fetch: slow }) });
        const program = await router.prepare({ id: 'r4', version: '1', source: 'FROM Order SELECT .id' });
        const controller = new AbortController();
        const pending = program.run({}, {}, { signal: controller.signal });
        controller.abort();
        expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    });

    test('logs of remote runs reach the same sink as the router default', async () => {
        const { fetch } = mockFetch(request => ({ v: 1, results: request.runs.map(r => ({ id: r.id, ok: true, value: 1, logs: ['from server'], stats })) }));
        const lines: string[] = [];
        const events = consoleEventSink({ console: { log: (...args) => lines.push(String(args[0])), debug: () => {} } });
        const router = routeByTier({ local: localMinab(), remote: remote({ endpoint: 'x', fetch }), events });
        const program = await router.prepare({ id: 'r5', version: '1', source: 'FROM Order SELECT .id' });
        await program.run();
        expect(lines).toEqual(['[minab] from server']);
    });
});

describe('consoleEventSink', () => {
    test('shows log events, and statements only when asked', () => {
        const log: unknown[][] = [];
        const debug: unknown[][] = [];
        const target = { log: (...args: unknown[]) => log.push(args), debug: (...args: unknown[]) => debug.push(args) };
        const quiet = consoleEventSink({ console: target });
        quiet.emit({ kind: 'log', message: 'hi' });
        quiet.emit({ kind: 'statement', sql: 'SELECT 1', params: [] });
        quiet.emit({ kind: 'timing', phase: 'run', durationMs: 1 });
        expect(log).toEqual([['[minab] hi']]);
        expect(debug).toEqual([]);
        consoleEventSink({ console: target, statements: true }).emit({ kind: 'statement', sql: 'SELECT 1', params: [] });
        expect(debug).toEqual([['[minab] SELECT 1', []]]);
    });
});
