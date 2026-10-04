/**
 * The worker side of the bridge (entry `@shamsine/minab/browser/worker`, production plan H4).
 *
 * `serveWorker(endpoint, { ports })` hosts one runtime. It answers `create`, `prepare`, `run`,
 * `cancel` and `dispose`. During a run, a port that lives on the page is a proxy: each call
 * goes to the page as a `port-call` and waits for the `port-result`.
 *
 * A port can also live in the worker (the playground keeps PGlite there). Give it in `ports`.
 * A port the page gives for a run wins over the worker's own.
 *
 * Importing this file in a Web Worker starts the bridge on `self`. In any other place (a test,
 * a worker file of your own) it does nothing until you call `serveWorker`.
 */

import { resolveLimits, tightenLimits, type Limits } from '../runtime/limits.js';
import { runError } from '../runtime/errors.js';
import { createMinab } from '../runtime/minab.js';
import { PortError, type ClockPort, type DataPort, type EventSink, type HostFunctions } from '../runtime/ports.js';
import type { Minab, MinabError, PreparedProgram, RunInputs, RunPorts, RunResult } from '../runtime/types.js';
import {
    BRIDGE_VERSION,
    badMessage,
    compileSnapshot,
    fromWire,
    isMessage,
    toWire,
    type BridgeRequest,
    type BridgeResponse,
    type Crossing,
    type Endpoint,
    type PortName,
    type PreparedSnapshot
} from './protocol.js';
import { WireError } from '../runtime/wire.js';

/** Ports that live inside the worker. */
export type WorkerPorts = Pick<RunPorts, 'data' | 'hostFunctions' | 'clock' | 'events'>;

export interface ServeOptions {
    ports?: WorkerPorts;
    /** How many prepared programs the worker keeps. The oldest goes first. Default 4096. */
    maxPrograms?: number;
}

const DEFAULT_MAX_PROGRAMS = 4096;

interface PendingCall {
    resolve(value: Crossing): void;
    reject(error: unknown): void;
}

/** Starts the bridge on `endpoint`. Returns a function that stops it. */
export function serveWorker(endpoint: Endpoint, serve: ServeOptions = {}): () => void {
    const own = serve.ports ?? {};
    const maxPrograms = serve.maxPrograms ?? DEFAULT_MAX_PROGRAMS;
    let minab: Minab | undefined;
    let hostLimits: Limits | undefined;
    let nextProgram = 1;
    let nextCall = 1;
    const programs = new Map<number, PreparedProgram>();
    const runs = new Map<number, AbortController>();
    const calls = new Map<number, PendingCall>();

    const send = (message: BridgeResponse) => endpoint.postMessage(message);
    const answer = (id: number, value: Crossing) => send({ v: 1, type: 'response', id, ok: true, value });
    const fail = (id: number, error: MinabError) => send({ v: 1, type: 'response', id, ok: false, error });

    /** One call to a port on the page. Gives up (and tells the page) when the signal aborts. */
    function callPage(runId: number, port: PortName, method: string, args: unknown[], signal?: AbortSignal): Promise<unknown> {
        const callId = nextCall++;
        return new Promise<unknown>((resolve, reject) => {
            const abort = () => {
                if (!calls.delete(callId)) return;
                send({ v: 1, type: 'port-cancel', callId });
                reject(new PortError('cancelled', 'the run was stopped'));
            };
            if (signal?.aborted) return reject(new PortError('cancelled', 'the run was stopped'));
            signal?.addEventListener('abort', abort, { once: true });
            calls.set(callId, {
                resolve: value => {
                    signal?.removeEventListener('abort', abort);
                    try {
                        resolve(fromWire(value));
                    } catch (e) {
                        reject(e);
                    }
                },
                reject: error => {
                    signal?.removeEventListener('abort', abort);
                    reject(error);
                }
            });
            try {
                send({ v: 1, type: 'port-call', callId, runId, port, method, args: args.map(a => toWire(a)) });
            } catch (e) {
                calls.delete(callId);
                signal?.removeEventListener('abort', abort);
                reject(e);
            }
        });
    }

    function proxyData(runId: number): DataPort {
        return { execute: (query, context) => callPage(runId, 'data', 'execute', [query], context.signal) as Promise<never> };
    }

    function proxyFunctions(runId: number): HostFunctions {
        return { call: (name, args, context) => callPage(runId, 'functions', 'call', [name, args], context.signal) };
    }

    function proxyEvents(runId: number): EventSink {
        return {
            emit(event) {
                try {
                    send({ v: 1, type: 'port-call', callId: nextCall++, runId, port: 'events', method: 'emit', args: [toWire(event)], oneWay: true });
                } catch {
                    // The sink must not throw. A value that cannot cross is dropped.
                }
            }
        };
    }

    /** The clock is read once for each run: ask the page once, then keep the answer. */
    async function pageClock(runId: number, signal: AbortSignal): Promise<ClockPort> {
        const [now, timeZone] = await Promise.all([callPage(runId, 'clock', 'now', [], signal), callPage(runId, 'clock', 'timeZone', [], signal)]);
        if (!(now instanceof Date) || typeof timeZone !== 'string') throw new WireError(badMessage('the clock port gave a bad answer'));
        return { now: () => new Date(now.getTime()), timeZone };
    }

    async function handleRun(request: Extract<BridgeRequest, { type: 'run' }>): Promise<RunResult> {
        if (!minab || !hostLimits) throw new WireError(badMessage('run before create'));
        const program = programs.get(request.program);
        if (!program) return { ok: false, error: runError('wire.programExpired', undefined) };
        const wanted = new Set(request.ports);
        const controller = new AbortController();
        runs.set(request.id, controller);
        const runId = request.id;
        const limits = tightenLimits(hostLimits, request.limits);
        try {
            const inputs = fromWire(request.inputs) as RunInputs | undefined;
            const ports: RunPorts = { ...own };
            if (wanted.has('data')) ports.data = proxyData(runId);
            if (wanted.has('functions')) ports.hostFunctions = proxyFunctions(runId);
            if (wanted.has('events')) ports.events = proxyEvents(runId);
            if (wanted.has('clock')) ports.clock = await withDeadline(pageClock(runId, controller.signal), limits.wallTimeMs, controller);
            return await program.run(inputs, ports, { signal: controller.signal, limits: request.limits });
        } catch (e) {
            if (e instanceof WireError) return { ok: false, error: e.error };
            if (e instanceof DeadlineError) return { ok: false, error: runError('limit.timeout', undefined, { limit: limits.wallTimeMs }) };
            if (controller.signal.aborted) return { ok: false, error: runError('cancelled', undefined) };
            if (e instanceof PortError) return { ok: false, error: { code: e.code, message: e.message, params: {} } };
            throw e;
        } finally {
            runs.delete(runId);
        }
    }

    async function handle(request: BridgeRequest): Promise<void> {
        switch (request.type) {
            case 'create': {
                minab?.dispose();
                const { options } = request;
                minab = createMinab(options);
                hostLimits = resolveLimits(options.limits);
                programs.clear();
                return answer(request.id, null);
            }
            case 'prepare': {
                if (!minab) throw new WireError(badMessage('prepare before create'));
                const prepared = await minab.prepare(request.source, request.options);
                const program = nextProgram++;
                programs.set(program, prepared);
                // Keep a limited number of programs: Map keeps the order of insertion.
                if (programs.size > maxPrograms) programs.delete(programs.keys().next().value as number);
                const snapshot: PreparedSnapshot = {
                    program,
                    diagnostics: [...prepared.diagnostics],
                    kind: prepared.kind,
                    analysis: prepared.analysis,
                    compile: compileSnapshot(prepared.compile())
                };
                if (prepared.resultType !== undefined) snapshot.resultType = prepared.resultType;
                return answer(request.id, snapshot);
            }
            case 'run': {
                const result = await handleRun(request);
                return answer(
                    request.id,
                    result.ok ? { ok: true, value: toWire(result.value), logs: result.logs, stats: result.stats } : { ok: false, error: result.error }
                );
            }
            case 'dispose':
                minab?.dispose();
                minab = undefined;
                programs.clear();
                for (const controller of runs.values()) controller.abort();
                return answer(request.id, null);
            case 'cancel':
                runs.get(request.id)?.abort();
                return;
            case 'port-result': {
                const call = calls.get(request.callId);
                if (!call) return; // The run ended or was aborted: nobody waits for this.
                calls.delete(request.callId);
                if (request.ok) return call.resolve(request.value);
                if (request.raw) {
                    const sqlstate = request.error.params.sqlstate;
                    return call.reject(Object.assign(new Error(request.error.message), typeof sqlstate === 'string' ? { code: sqlstate } : {}));
                }
                return call.reject(new PortError(request.error.code, request.error.message));
            }
        }
    }

    endpoint.onmessage = event => {
        const request = event.data;
        const id = isMessage(request) ? (request as { id?: unknown }).id : undefined;
        if (!isMessage(request) || request.v !== BRIDGE_VERSION) {
            if (typeof id === 'number')
                fail(id, badMessage(`version ${String((request as { v?: unknown })?.v)} is not supported (supported: ${BRIDGE_VERSION})`));
            return;
        }
        handle(request as BridgeRequest).catch((e: unknown) => {
            if (typeof id !== 'number') return;
            if (e instanceof WireError) return fail(id, e.error);
            fail(id, runError('wire.workerFailed', undefined, { reason: e instanceof Error ? e.message : String(e) }));
        });
    };

    return () => {
        endpoint.onmessage = null;
        for (const controller of runs.values()) controller.abort();
        for (const call of calls.values()) call.reject(new PortError('wire.workerStopped', 'the worker stopped'));
        calls.clear();
        minab?.dispose();
    };
}

class DeadlineError extends Error {}

/** `promise`, but it fails with `DeadlineError` (and aborts `controller`) when `ms` pass first. */
function withDeadline<T>(promise: Promise<T>, ms: number, controller: AbortController): Promise<T> {
    if (!Number.isFinite(ms)) return promise;
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            controller.abort();
            reject(new DeadlineError());
        }, ms);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

// ---- start on `self` inside a Web Worker --------------------------------

const scope = globalThis as unknown as { WorkerGlobalScope?: new () => unknown; self?: unknown };
if (typeof scope.WorkerGlobalScope === 'function' && scope.self instanceof scope.WorkerGlobalScope) {
    serveWorker(scope.self as Endpoint);
}
