/**
 * `createRemoteMinab`: runs stored programs on a server, through wire format v1 (phase H5).
 *
 * The browser sends the program's id and version and its inputs. It never sends SQL, a schema or
 * program text (decisions D28, D34). Runs made in the same tick go out in one request.
 *
 * Nothing here may touch Node or the DOM. `fetch` is a parameter, so tests and apps can swap it.
 */

import { runError } from '../runtime/errors.js';
import { DEFAULT_LIMITS, type Limits } from '../runtime/limits.js';
import type { EventSink } from '../runtime/ports.js';
import type { MinabError, RunInputs, RunResult } from '../runtime/types.js';
import { parseResponse, type Json, type WireResult, type WireRun } from '../runtime/wire.js';
import { emitLogs } from './console.js';
import { decodeBy, encodeInputs, encodeLoose, resultWireType, toMinabError, type InputTypes } from './protocol.js';

export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<FetchResponse>;

/** The part of a `Response` that the client reads. */
export interface FetchResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}

export interface RemoteMinabOptions {
    /** The URL of the run endpoint (the NestJS controller of H2, or any server that speaks wire v1). */
    endpoint: string;
    /** Default: the global `fetch`. */
    fetch?: FetchLike;
    /** Extra headers, such as `Authorization`. A function is called for each request. */
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
    /** The most runs in one request. Default: `DEFAULT_LIMITS.batchRuns`. */
    maxBatch?: number;
    /**
     * Schema, host inputs and rule context. With them, record fields and inputs are encoded by their
     * declared types (an exact decimal is sent as text). Without them, values are encoded by their JS type.
     */
    types?: InputTypes;
    /** Receives the `logs` of each answer, as `log` events. */
    events?: EventSink;
}

export interface RemoteRunOptions {
    /** Aborts the run. A request is aborted when all its runs are aborted. */
    signal?: AbortSignal;
    /** Limits for this run. The server can only make them tighter. */
    limits?: Partial<Limits>;
    /** The Minab type of the result (for example `DECIMAL`), so the value is decoded. Without it the JSON value is returned. */
    resultType?: string;
    /** Ask the server for the log entries. Default `true`. */
    logs?: boolean;
    /** Sink for the logs of this run. Default: the one of `createRemoteMinab`. */
    events?: EventSink;
}

export interface RemoteProgramRef {
    id: string;
    version: string;
}

export interface RemoteMinab {
    /** Runs a stored program. It never throws: a failure is `{ ok: false, error }`. */
    run(ref: RemoteProgramRef, inputs?: RunInputs, options?: RemoteRunOptions): Promise<RunResult>;
    /** Aborts every request in flight. A disposed client answers `cancelled`. */
    dispose(): void;
}

interface Pending {
    wire: WireRun;
    resultType: ReturnType<typeof resultWireType>;
    events: EventSink | undefined;
    signal: AbortSignal | undefined;
    settled: boolean;
    settle(result: RunResult): void;
}

function failure(reason: string): MinabError {
    return runError('wire.remoteFailed', undefined, { reason });
}

export function createRemoteMinab(options: RemoteMinabOptions): RemoteMinab {
    const maxBatch = Math.max(1, Math.floor(options.maxBatch ?? DEFAULT_LIMITS.batchRuns));
    const inFlight = new Set<AbortController>();
    let queue: Pending[] = [];
    let scheduled = false;
    let disposed = false;
    let counter = 0;

    function finish(pending: Pending, result: RunResult): void {
        if (pending.settled) return;
        pending.settled = true;
        pending.settle(result);
    }

    function answer(pending: Pending, result: WireResult | undefined): void {
        if (!result) return finish(pending, { ok: false, error: failure('the answer has no result for this run') });
        emitLogs(pending.events, result.logs);
        if (!result.ok) return finish(pending, { ok: false, error: result.error });
        try {
            finish(pending, { ok: true, value: decodeBy(result.value, pending.resultType), logs: result.logs ?? [], stats: result.stats });
        } catch (error) {
            finish(pending, { ok: false, error: toMinabError(error) });
        }
    }

    async function send(batch: Pending[]): Promise<void> {
        const controller = new AbortController();
        inFlight.add(controller);
        // The request stops only when every run in it was aborted.
        const abortIfAllDone = () => {
            if (batch.every(p => p.signal?.aborted)) controller.abort();
        };
        for (const pending of batch) pending.signal?.addEventListener('abort', abortIfAllDone, { once: true });
        try {
            const extra = typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {});
            const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
            if (!doFetch) throw new Error('there is no fetch function: pass the "fetch" option');
            const response = await doFetch(options.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json', ...extra },
                body: JSON.stringify({ v: 1, runs: batch.map(p => p.wire) }),
                signal: controller.signal
            });
            let body: unknown;
            try {
                body = await response.json();
            } catch {
                throw new Error(`the server answered with status ${response.status} and no JSON body`);
            }
            const parsed = parseResponse(body);
            if (!parsed.ok) {
                for (const pending of batch) finish(pending, { ok: false, error: parsed.error });
                return;
            }
            if ('error' in parsed.value) {
                for (const pending of batch) finish(pending, { ok: false, error: parsed.value.error });
                return;
            }
            const byId = new Map(parsed.value.results.map(r => [r.id, r]));
            for (const pending of batch) answer(pending, byId.get(pending.wire.id));
        } catch (error) {
            const aborted = controller.signal.aborted;
            for (const pending of batch) {
                finish(pending, {
                    ok: false,
                    error:
                        aborted || pending.signal?.aborted
                            ? runError('cancelled', undefined)
                            : failure(error instanceof Error ? error.message : 'unknown failure')
                });
            }
        } finally {
            inFlight.delete(controller);
            for (const pending of batch) pending.signal?.removeEventListener('abort', abortIfAllDone);
        }
    }

    function flush(): void {
        scheduled = false;
        const waiting = queue.filter(p => !p.settled);
        queue = [];
        for (let i = 0; i < waiting.length; i += maxBatch) void send(waiting.slice(i, i + maxBatch));
    }

    return {
        run(ref, inputs = {}, runOptions = {}) {
            if (disposed || runOptions.signal?.aborted) return Promise.resolve({ ok: false, error: runError('cancelled', undefined) });
            let wire: WireRun;
            try {
                const run: WireRun = { id: `q${counter++}`, program: { ref: { id: ref.id, version: ref.version } } };
                const options2: NonNullable<WireRun['options']> = { logs: runOptions.logs ?? true };
                if (runOptions.limits) options2.limits = runOptions.limits;
                run.options = options2;
                if (options.types) {
                    const encoded = encodeInputs(inputs, options.types);
                    if (encoded.record) run.record = encoded.record;
                    if (encoded.fieldValue !== undefined) run.fieldValue = encoded.fieldValue;
                    if (encoded.hostInputs) run.inputs = encoded.hostInputs;
                } else {
                    if (inputs.record) run.record = encodeLoose(inputs.record) as Record<string, Json>;
                    if (inputs.fieldValue !== undefined) run.fieldValue = encodeLoose(inputs.fieldValue);
                    if (inputs.hostInputs) run.inputs = encodeLoose(inputs.hostInputs) as Record<string, Json>;
                }
                wire = run;
            } catch (error) {
                return Promise.resolve({ ok: false, error: toMinabError(error) });
            }
            return new Promise<RunResult>(resolve => {
                const pending: Pending = {
                    wire,
                    resultType: resultWireType(runOptions.resultType),
                    events: runOptions.events ?? options.events,
                    signal: runOptions.signal,
                    settled: false,
                    settle: resolve
                };
                // An aborted run answers at once, even while its request is still in flight.
                runOptions.signal?.addEventListener('abort', () => finish(pending, { ok: false, error: runError('cancelled', undefined) }), { once: true });
                queue.push(pending);
                if (!scheduled) {
                    scheduled = true;
                    queueMicrotask(flush);
                }
            });
        },
        dispose() {
            disposed = true;
            for (const controller of inFlight) controller.abort();
            for (const pending of queue) finish(pending, { ok: false, error: runError('cancelled', undefined) });
            queue = [];
        }
    };
}
