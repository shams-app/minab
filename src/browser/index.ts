/**
 * `createWorkerMinab`: the runtime API of `@shamsine/minab`, with the language work in a Web Worker.
 *
 * `prepare` and `run` look like the ones of `createMinab`, but every step is asynchronous, because
 * the parser lives in the worker. The ports (data, host functions, clock, events) stay on the main
 * thread: the worker calls back through the bridge and waits for the answer (see `protocol.ts`).
 *
 * Nothing here may touch Node or the DOM.
 */

import type { CompletionResult, HoverResult, SignatureHelpResult } from '../editor/types.js';
import { coded } from '../language/diagnostics/codes.js';
import type { HostFunctionDeclaration } from '../language/host-declarations.js';
import { parseTypeWord } from '../language/host-declarations.js';
import { DEFAULT_RULE_CONTEXT } from '../language/schema.js';
import { dependsOnField } from '../runtime/analyze.js';
import { dataFailure, runError } from '../runtime/errors.js';
import { PortError } from '../runtime/ports.js';
import type {
    CompileResult,
    MinabDiagnostic,
    MinabError,
    MinabOptions,
    PrepareOptions,
    ProgramAnalysis,
    ProgramKind,
    RunInputs,
    RunOptions,
    RunPorts,
    RunResult
} from '../runtime/types.js';
import { WireError, encodeValue, type Json } from '../runtime/wire.js';
import {
    BRIDGE_VERSION,
    bridgeError,
    decodeBy,
    encodeInputs,
    encodeLoose,
    isBridgeMessage,
    resultWireType,
    toMinabError,
    type BridgeEndpoint,
    type EditorMethod,
    type FromWorker,
    type InputTypes,
    type PortName,
    type PreparedInfo,
    type RunAnswer,
    type ToWorker
} from './protocol.js';

export type { BridgeEndpoint } from './protocol.js';
export { consoleEventSink, emitLogs } from './console.js';
export type { ConsoleLike, ConsoleSinkOptions } from './console.js';
export { createRemoteMinab } from './remote.js';
export type { FetchLike, FetchResponse, RemoteMinab, RemoteMinabOptions, RemoteProgramRef, RemoteRunOptions } from './remote.js';
export { routeByTier } from './route.js';
export type { LocalMinab, RoutedProgram, RouteOptions, StoredProgram, TierRouter } from './route.js';

export interface WorkerMinabOptions extends Pick<MinabOptions, 'schema' | 'functions' | 'inputs' | 'ruleContext' | 'limits' | 'serviceCacheSize' | 'mode'> {
    /**
     * Makes the worker. A web app writes:
     * `() => new Worker(new URL('@shamsine/minab/browser/worker', import.meta.url), { type: 'module' })`.
     * A `MessagePort` also fits, which is how the tests run without a browser.
     */
    worker: () => BridgeEndpoint;
}

/** What `prepare` gives. It is `PreparedProgram` with the steps that need the worker made asynchronous. */
export interface WorkerPreparedProgram {
    readonly diagnostics: readonly MinabDiagnostic[];
    readonly ok: boolean;
    readonly kind: ProgramKind;
    readonly resultType?: string;
    readonly analysis: ProgramAnalysis;
    /** Does a change of this record field change the result? It answers at once: the analysis is already here. */
    dependsOn(field: string): boolean;
    compile(): Promise<CompileResult>;
    /** Never throws for a failed program: the answer says `ok: false`. The ports stay on this thread. */
    run(inputs?: RunInputs, ports?: RunPorts, options?: RunOptions): Promise<RunResult>;
    /** Frees the program in the worker. Calling `run` afterwards gives an error. */
    release(): void;
}

export interface WorkerMinab {
    prepare(source: string, options?: PrepareOptions): Promise<WorkerPreparedProgram>;
    /**
     * Editor services, computed in the worker (phase E5). `offset` is a UTF-16 offset into `source`,
     * lines and columns in the results are 0-based. They need no `prepare`, and they fail soft: an
     * answer the worker cannot give is an empty result (`hover` and `signatureHelp`: `undefined`).
     */
    complete(source: string, offset: number, options?: Pick<PrepareOptions, 'ruleContext'>): Promise<CompletionResult>;
    hover(source: string, offset: number, options?: Pick<PrepareOptions, 'ruleContext'>): Promise<HoverResult | undefined>;
    signatureHelp(source: string, offset: number, options?: Pick<PrepareOptions, 'ruleContext'>): Promise<SignatureHelpResult | undefined>;
    /**
     * Calls a handler that the host app put in `serveMinab` (`requests`) and gives its answer. The payload and the
     * answer must be clonable by `postMessage`. A failure throws an `Error` with the message of the handler. An abort
     * through `signal` cancels the request in the worker and throws `cancelled` at once.
     */
    request<T = unknown>(name: string, payload?: unknown, options?: { signal?: AbortSignal }): Promise<T>;
    /** Listens to the events that the worker code sends with `emit`. Gives a function that stops the listener. */
    onEvent(listener: (name: string, payload: unknown) => void): () => void;
    /** Stops the worker. A disposed runtime throws on use. */
    dispose(): void;
}

interface Request {
    resolve(value: unknown): void;
    reject(error: MinabError): void;
}

interface ActiveRun {
    ports: RunPorts;
    controller: AbortController;
    calls: Set<string>;
}

class BridgeFailure extends Error {
    constructor(readonly error: MinabError) {
        super(error.message);
    }
}

export function createWorkerMinab(options: WorkerMinabOptions): WorkerMinab {
    const { worker: makeWorker, ...runtimeOptions } = options;
    const endpoint = makeWorker();
    const requests = new Map<string, Request>();
    const activeRuns = new Map<string, ActiveRun>();
    const callControllers = new Map<string, AbortController>();
    const eventListeners = new Set<(name: string, payload: unknown) => void>();
    const declaredFunctions = new Map<string, HostFunctionDeclaration>((options.functions ?? []).map(f => [f.name, f]));
    let counter = 0;
    let disposed = false;
    let broken: MinabError | undefined;

    const nextId = (prefix: string) => `${prefix}${counter++}`;
    const post = (message: ToWorker) => endpoint.postMessage(message);

    function request(message: Extract<ToWorker, { id: string }>): Promise<unknown> {
        if (broken) return Promise.reject(new BridgeFailure(broken));
        return new Promise((resolve, reject) => {
            requests.set(message.id, { resolve, reject: error => reject(new BridgeFailure(error)) });
            post(message);
        });
    }

    function breakAll(error: MinabError): void {
        broken = error;
        for (const pending of requests.values()) pending.reject(error);
        requests.clear();
    }

    // ---- port calls from the worker -------------------------------------

    function portBody(port: PortName, error: unknown, name?: string): MinabError {
        if (error instanceof PortError) return { code: error.code, message: error.message, params: {} };
        if (port === 'functions') return runError('eval.hostFunctionFailed', undefined, { name: name ?? '' });
        const failure = dataFailure(error);
        return { code: failure.code, message: failure.message, params: failure.params };
    }

    async function callPort(message: Extract<FromWorker, { type: 'port-call' }>, run: ActiveRun, signal: AbortSignal): Promise<Json> {
        const { ports } = run;
        switch (message.port) {
            case 'data': {
                if (!ports.data) throw new PortError('data.noPort', coded('data.noPort').reason);
                const query = message.args[0] as { text: string; params: unknown[] };
                return encodeLoose(await ports.data.execute({ text: query.text, params: query.params }, { signal }));
            }
            case 'functions': {
                if (!ports.hostFunctions)
                    throw new PortError('eval.hostFunctionMissing', coded('eval.hostFunctionMissing', { name: String(message.args[0]) }).reason);
                const name = String(message.args[0]);
                const declaration = declaredFunctions.get(name);
                const args = message.args
                    .slice(1)
                    .map((arg, i) => decodeBy(arg, declaration?.params[i] ? parseTypeWord(declaration.params[i].type) : undefined));
                const value = await ports.hostFunctions.call(name, args, { signal });
                const returns = declaration ? parseTypeWord(declaration.returns) : undefined;
                return returns ? encodeValue(value, returns) : encodeLoose(value);
            }
            case 'clock': {
                const clock = ports.clock;
                if (!clock) return { now: new Date().toISOString(), timeZone: 'UTC' };
                return { now: clock.now().toISOString(), timeZone: clock.timeZone };
            }
            default:
                throw new PortError('wire.invalidRequest', `unknown port ${String(message.port)}`);
        }
    }

    function onPortCall(message: Extract<FromWorker, { type: 'port-call' }>): void {
        const run = activeRuns.get(message.runId);
        if (message.port === 'events') {
            // One way: no answer. A sink that throws is ignored.
            try {
                run?.ports.events?.emit(message.args[0] as never);
            } catch {
                // dropped on purpose
            }
            return;
        }
        const reply = (body: { ok: true; value: Json } | { ok: false; error: MinabError }) =>
            post({ v: BRIDGE_VERSION, type: 'port-result', callId: message.callId, ...body });
        if (!run) return reply({ ok: false, error: bridgeError(`unknown run ${message.runId}`) });
        const controller = new AbortController();
        // The run's own signal (its `cancel`) also stops its port calls.
        const stop = () => controller.abort();
        run.controller.signal.addEventListener('abort', stop, { once: true });
        callControllers.set(message.callId, controller);
        run.calls.add(message.callId);
        type Body = Parameters<typeof reply>[0];
        void callPort(message, run, controller.signal)
            .then<Body, Body>(
                value => ({ ok: true, value }),
                (error: unknown) => ({ ok: false, error: error instanceof WireError ? error.error : portBody(message.port, error, String(message.args[0])) })
            )
            .then(body => {
                // The worker stopped waiting when the call was aborted: no answer is needed.
                if (!controller.signal.aborted) reply(body);
            })
            .finally(() => {
                run.controller.signal.removeEventListener('abort', stop);
                callControllers.delete(message.callId);
                run.calls.delete(message.callId);
            });
    }

    endpoint.addEventListener('message', event => {
        const data = event.data;
        if (!isBridgeMessage(data)) return;
        const message = data as FromWorker;
        switch (message.type) {
            case 'result': {
                const pending = requests.get(message.id);
                if (!pending) return;
                requests.delete(message.id);
                if (message.ok) pending.resolve(message.value);
                else pending.reject(message.error);
                return;
            }
            case 'port-call':
                onPortCall(message);
                return;
            case 'cancel-call':
                callControllers.get(message.callId)?.abort();
                return;
            case 'event':
                for (const listener of [...eventListeners]) {
                    try {
                        listener(message.name, message.payload);
                    } catch {
                        // A listener that throws must not stop the others.
                    }
                }
                return;
        }
    });
    // A worker that fails to load or crashes: every waiting request fails with a code.
    (endpoint as { addEventListener(type: string, listener: () => void): void }).addEventListener('error', () => breakAll(bridgeError('the worker stopped')));
    endpoint.start?.();

    const created = request({ v: BRIDGE_VERSION, type: 'create', id: nextId('r'), options: runtimeOptions }).then(
        () => undefined,
        (failure: unknown) => {
            throw new Error(failure instanceof BridgeFailure ? failure.error.message : toMinabError(failure).message);
        }
    );
    // A host developer sees the failure on the first `prepare`. Without this, an unused runtime would report an unhandled rejection.
    created.catch(() => {});

    function wrap(programId: string, info: PreparedInfo, types: InputTypes): WorkerPreparedProgram {
        let released = false;
        const resultType = resultWireType(info.resultType);
        return {
            diagnostics: info.diagnostics,
            ok: info.ok,
            kind: info.kind,
            ...(info.resultType === undefined ? {} : { resultType: info.resultType }),
            analysis: info.analysis,
            dependsOn: field => dependsOnField(info.analysis, field),
            async compile() {
                if (released || disposed) return { ok: false, error: bridgeError('the program was released') };
                try {
                    return (await request({ v: BRIDGE_VERSION, type: 'compile', id: nextId('r'), programId })) as CompileResult;
                } catch (failure) {
                    return { ok: false, error: failure instanceof BridgeFailure ? failure.error : toMinabError(failure) };
                }
            },
            async run(inputs: RunInputs = {}, ports: RunPorts = {}, runOptions: RunOptions = {}): Promise<RunResult> {
                if (released || disposed) return { ok: false, error: bridgeError('the program was released') };
                if (runOptions.signal?.aborted) return { ok: false, error: runError('cancelled', undefined) };
                let encoded;
                try {
                    encoded = encodeInputs(inputs, types);
                } catch (error) {
                    return { ok: false, error: toMinabError(error) };
                }
                const id = nextId('r');
                const controller = new AbortController();
                activeRuns.set(id, { ports, controller, calls: new Set() });
                const offered: PortName[] = [];
                if (ports.data) offered.push('data');
                if (ports.hostFunctions) offered.push('functions');
                if (ports.clock) offered.push('clock');
                if (ports.events) offered.push('events');
                const onAbort = () => {
                    controller.abort();
                    post({ v: BRIDGE_VERSION, type: 'cancel', id });
                };
                runOptions.signal?.addEventListener('abort', onAbort, { once: true });
                try {
                    const answer = (await request({
                        v: BRIDGE_VERSION,
                        type: 'run',
                        id,
                        programId,
                        inputs: encoded,
                        ports: offered,
                        ...(runOptions.limits ? { limits: runOptions.limits } : {})
                    })) as RunAnswer;
                    return { ok: true, value: decodeBy(answer.value, resultType), logs: answer.logs, stats: answer.stats };
                } catch (failure) {
                    return { ok: false, error: failure instanceof BridgeFailure ? failure.error : toMinabError(failure) };
                } finally {
                    runOptions.signal?.removeEventListener('abort', onAbort);
                    activeRuns.delete(id);
                }
            },
            release() {
                if (released) return;
                released = true;
                if (!disposed) post({ v: BRIDGE_VERSION, type: 'release', programId });
            }
        };
    }

    async function editor(method: EditorMethod, source: string, offset: number, ruleContext: PrepareOptions['ruleContext']): Promise<unknown> {
        if (disposed) throw new Error('this Minab runtime was disposed');
        if (typeof source !== 'string') throw new TypeError(`${method} needs the program source as a string`);
        await created;
        try {
            return await request({ v: BRIDGE_VERSION, type: 'editor', id: nextId('r'), method, source, offset, ...(ruleContext ? { ruleContext } : {}) });
        } catch (failure) {
            throw new Error(failure instanceof BridgeFailure ? failure.error.message : toMinabError(failure).message);
        }
    }

    return {
        async request<T>(name: string, payload?: unknown, requestOptions: { signal?: AbortSignal } = {}): Promise<T> {
            if (disposed) throw new Error('this Minab runtime was disposed');
            const { signal } = requestOptions;
            if (signal?.aborted) throw new Error(runError('cancelled', undefined).message);
            const id = nextId('r');
            const answered = request({ v: BRIDGE_VERSION, type: 'request', id, name, ...(payload === undefined ? {} : { payload }) });
            let onAbort: (() => void) | undefined;
            const cancelled = new Promise<never>((_, reject) => {
                onAbort = () => {
                    requests.delete(id);
                    post({ v: BRIDGE_VERSION, type: 'cancel', id });
                    reject(new Error(runError('cancelled', undefined).message));
                };
                signal?.addEventListener('abort', onAbort, { once: true });
            });
            cancelled.catch(() => {});
            try {
                return (await Promise.race([answered, cancelled])) as T;
            } catch (failure) {
                if (failure instanceof BridgeFailure) throw new Error(failure.error.message);
                throw failure;
            } finally {
                if (onAbort) signal?.removeEventListener('abort', onAbort);
            }
        },
        onEvent(listener) {
            eventListeners.add(listener);
            return () => eventListeners.delete(listener);
        },
        complete: async (source, offset, o) => (await editor('complete', source, offset, o?.ruleContext)) as CompletionResult,
        hover: async (source, offset, o) => ((await editor('hover', source, offset, o?.ruleContext)) as HoverResult | null) ?? undefined,
        signatureHelp: async (source, offset, o) =>
            ((await editor('signatureHelp', source, offset, o?.ruleContext)) as SignatureHelpResult | null) ?? undefined,
        async prepare(source, prepareOptions = {}) {
            if (disposed) throw new Error('this Minab runtime was disposed');
            if (typeof source !== 'string') throw new TypeError('prepare needs the program source as a string');
            await created;
            const programId = nextId('p');
            const ruleContext = prepareOptions.ruleContext ?? options.ruleContext ?? DEFAULT_RULE_CONTEXT;
            try {
                const info = (await request({
                    v: BRIDGE_VERSION,
                    type: 'prepare',
                    id: nextId('r'),
                    programId,
                    source,
                    options: { ruleContext: prepareOptions.ruleContext, expect: prepareOptions.expect }
                })) as PreparedInfo;
                return wrap(programId, info, { schema: options.schema, inputs: options.inputs, ruleContext });
            } catch (failure) {
                throw new Error(failure instanceof BridgeFailure ? failure.error.message : toMinabError(failure).message);
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const run of activeRuns.values()) run.controller.abort();
            eventListeners.clear();
            // The worker gets `dispose`, then the thread is stopped. Pending requests end with an error code.
            endpoint.postMessage({ v: BRIDGE_VERSION, type: 'dispose', id: nextId('r') } satisfies ToWorker);
            breakAll(bridgeError('the runtime was disposed'));
            endpoint.terminate?.();
        }
    };
}
