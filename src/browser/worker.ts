/**
 * The Minab worker: it hosts a runtime and answers the bridge messages of `protocol.ts`.
 *
 * Use it in one of two ways:
 * - Point `createWorkerMinab` at this file (`@shamsine/minab/browser/worker`). In a Web Worker it starts itself.
 * - Write your own worker file and call `serveMinab(self, { ports })`, when a port must live inside
 *   the worker (the playground keeps its database there).
 *
 * A port can live on the main thread or in the worker. If the main thread says it has the port, the
 * worker calls it over the bridge and waits for the answer. Otherwise the worker uses its own port.
 *
 * Nothing here may touch Node or the DOM.
 */

import { complete, hover, parseDocument, signatureHelp } from '../editor/index.js';
import { coded } from '../language/diagnostics/codes.js';
import type { Row, SqlQuery } from '../language/minab-executor.js';
import { createMinab } from '../runtime/minab.js';
import { PortError, type ClockPort, type DataPort, type EventSink, type HostFunctions, type MinabEvent } from '../runtime/ports.js';
import { runError } from '../runtime/errors.js';
import type { Minab, MinabError, PreparedProgram, RunPorts } from '../runtime/types.js';
import { decodeValue, type Json } from '../runtime/wire.js';
import { parseTypeWord, resolveHostDeclarations, type ResolvedHost } from '../language/host-declarations.js';
import { DEFAULT_RULE_CONTEXT } from '../language/schema.js';
import { ServiceCache } from '../runtime/service-cache.js';
import {
    BRIDGE_VERSION,
    bridgeError,
    decodeInputs,
    encodeBy,
    encodeLoose,
    isBridgeMessage,
    resultWireType,
    toMinabError,
    type BridgeEndpoint,
    type FromWorker,
    type InputTypes,
    type PortName,
    type PreparedInfo,
    type RunAnswer,
    type ToWorker,
    type WorkerRuntimeOptions
} from './protocol.js';

/** Ports that live inside the worker. A port the main thread offers for a run is used instead. */
export interface WorkerPorts {
    data?: DataPort;
    hostFunctions?: HostFunctions;
    clock?: ClockPort;
    events?: EventSink;
}

export interface ServeOptions {
    ports?: WorkerPorts;
}

interface PendingCall {
    resolve(value: Json): void;
    reject(error: unknown): void;
}

/**
 * The error of a main-thread port, as the runtime should see it. A driver error keeps its SQLSTATE, so the
 * runtime maps it to the same code as on the server. Any other error keeps its code.
 */
function portFailure(error: MinabError): Error {
    const sqlstate = error.params.sqlstate;
    if (typeof sqlstate === 'string') return Object.assign(new Error(error.message), { code: sqlstate });
    return new PortError(error.code, error.message);
}

/** Starts answering the messages that come in at `endpoint`. */
export function serveMinab(endpoint: BridgeEndpoint, options: ServeOptions = {}): { close(): void } {
    let minab: Minab | undefined;
    let runtimeOptions: WorkerRuntimeOptions | undefined;
    // The editor services (phase E5): their own small cache, because a document here is never checked or run.
    let editorServices: { cache: ServiceCache; host: ResolvedHost } | undefined;
    const programs = new Map<string, { program: PreparedProgram; types: InputTypes }>();
    const runs = new Map<string, AbortController>();
    const pending = new Map<string, PendingCall>();
    let calls = 0;
    let closed = false;

    const send = (message: FromWorker) => endpoint.postMessage(message);
    const answer = (id: string, value: unknown) => send({ v: BRIDGE_VERSION, type: 'result', id, ok: true, value });
    const fail = (id: string, error: MinabError) => send({ v: BRIDGE_VERSION, type: 'result', id, ok: false, error });

    /** Asks the main thread to call a port and waits for the answer. It stops waiting when `signal` aborts. */
    function remoteCall(runId: string, port: PortName, method: string, args: Json[], signal: AbortSignal): Promise<Json> {
        const callId = `c${calls++}`;
        return new Promise<Json>((resolve, reject) => {
            if (signal.aborted) {
                reject(new Error('the call was aborted'));
                return;
            }
            const onAbort = () => {
                if (!pending.delete(callId)) return;
                send({ v: BRIDGE_VERSION, type: 'cancel-call', callId });
                reject(new Error('the call was aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            pending.set(callId, {
                resolve: value => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(value);
                },
                reject: error => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                }
            });
            send({ v: BRIDGE_VERSION, type: 'port-call', callId, runId, port, method, args });
        });
    }

    function remotePorts(runId: string, offered: readonly PortName[]): RunPorts {
        const ports: RunPorts = {};
        const local = options.ports ?? {};
        if (offered.includes('data')) {
            ports.data = {
                async execute(query: SqlQuery, context): Promise<Row[]> {
                    // The signal of the run: it aborts on cancel and at the wall time.
                    const rows = await remoteCall(runId, 'data', 'execute', [{ text: query.text, params: encodeLoose(query.params) }], context.signal);
                    if (!Array.isArray(rows)) throw new PortError('data.error', coded('data.error').reason);
                    return rows as Row[];
                }
            };
        } else if (local.data) ports.data = local.data;

        if (offered.includes('functions')) {
            const declared = new Map((runtimeOptions?.functions ?? []).map(f => [f.name, f]));
            ports.hostFunctions = {
                async call(name, args, context) {
                    const declaration = declared.get(name);
                    const encoded = args.map((arg, i) => encodeBy(arg, declaration?.params[i] ? parseTypeWord(declaration.params[i].type) : undefined));
                    const value = await remoteCall(runId, 'functions', 'call', [name, ...encoded], context.signal);
                    return declaration ? decodeValue(value, parseTypeWord(declaration.returns)!) : value;
                }
            };
        } else if (local.hostFunctions) ports.hostFunctions = local.hostFunctions;

        if (offered.includes('events')) {
            ports.events = {
                emit(event: MinabEvent) {
                    try {
                        send({
                            v: BRIDGE_VERSION,
                            type: 'port-call',
                            callId: `c${calls++}`,
                            runId,
                            port: 'events',
                            method: 'emit',
                            args: [encodeLoose(event)]
                        });
                    } catch {
                        // An event that cannot be encoded is dropped, like a sink that throws.
                    }
                }
            };
        } else if (local.events) ports.events = local.events;

        if (!offered.includes('clock') && local.clock) ports.clock = local.clock;
        return ports;
    }

    /** The clock is read before the run starts: the runtime reads it once, and it must not wait. */
    async function remoteClock(runId: string, signal: AbortSignal): Promise<ClockPort> {
        const value = (await remoteCall(runId, 'clock', 'now', [], signal)) as { now: string; timeZone: string };
        const now = new Date(value.now);
        return { now: () => new Date(now), timeZone: value.timeZone };
    }

    async function handleRun(message: Extract<ToWorker, { type: 'run' }>): Promise<void> {
        const entry = programs.get(message.programId);
        if (!entry) return fail(message.id, bridgeError(`unknown program ${message.programId}`));
        const controller = new AbortController();
        runs.set(message.id, controller);
        try {
            const ports = remotePorts(message.id, message.ports);
            if (message.ports.includes('clock')) ports.clock = await remoteClock(message.id, controller.signal);
            const result = await entry.program.run(decodeInputs(message.inputs, entry.types), ports, { signal: controller.signal, limits: message.limits });
            if (!result.ok) return fail(message.id, result.error);
            const value = encodeBy(result.value, resultWireType(entry.program.resultType));
            const out: RunAnswer = { value, logs: result.logs, stats: result.stats };
            answer(message.id, out);
        } catch (error) {
            // A cancel during the clock call ends here. Anything else is a bridge failure.
            fail(message.id, controller.signal.aborted ? runError('cancelled', undefined) : toMinabError(error));
        } finally {
            runs.delete(message.id);
        }
    }

    async function handle(message: ToWorker): Promise<void> {
        switch (message.type) {
            case 'create':
                try {
                    runtimeOptions = message.options;
                    minab = createMinab(message.options);
                    editorServices = {
                        cache: new ServiceCache(4, message.options.mode ?? 'production'),
                        host: resolveHostDeclarations({ functions: message.options.functions, inputs: message.options.inputs }, message.options.schema)
                    };
                    answer(message.id, null);
                } catch (error) {
                    fail(message.id, toMinabError(error));
                }
                return;
            case 'prepare': {
                if (!minab || !runtimeOptions) return fail(message.id, bridgeError('the runtime was not created'));
                try {
                    const program = await minab.prepare(message.source, message.options);
                    const ruleContext = message.options?.ruleContext ?? runtimeOptions.ruleContext ?? { isFieldRule: false };
                    programs.set(message.programId, { program, types: { schema: runtimeOptions.schema, inputs: runtimeOptions.inputs, ruleContext } });
                    const info: PreparedInfo = {
                        diagnostics: [...program.diagnostics],
                        ok: program.ok,
                        kind: program.kind,
                        ...(program.resultType === undefined ? {} : { resultType: program.resultType }),
                        analysis: program.analysis
                    };
                    answer(message.id, info);
                } catch (error) {
                    fail(message.id, toMinabError(error));
                }
                return;
            }
            case 'compile': {
                const entry = programs.get(message.programId);
                if (!entry) return fail(message.id, bridgeError(`unknown program ${message.programId}`));
                answer(message.id, entry.program.compile());
                return;
            }
            case 'editor': {
                if (!runtimeOptions || !editorServices) return fail(message.id, bridgeError('the runtime was not created'));
                try {
                    const ruleContext = message.ruleContext ?? runtimeOptions.ruleContext ?? DEFAULT_RULE_CONTEXT;
                    const { services } = editorServices.cache.get(runtimeOptions.schema, ruleContext, editorServices.host);
                    const doc = parseDocument(services, message.source);
                    if (message.method === 'complete') answer(message.id, await complete(doc, message.offset));
                    else if (message.method === 'hover') answer(message.id, hover(doc, message.offset) ?? null);
                    else if (message.method === 'signatureHelp') answer(message.id, signatureHelp(doc, message.offset) ?? null);
                    else fail(message.id, bridgeError(`unknown editor method ${String(message.method)}`));
                } catch (error) {
                    fail(message.id, toMinabError(error));
                }
                return;
            }
            case 'run':
                return handleRun(message);
            case 'cancel':
                runs.get(message.id)?.abort();
                return;
            case 'release':
                programs.delete(message.programId);
                return;
            case 'dispose':
                minab?.dispose();
                minab = undefined;
                editorServices?.cache.clear();
                editorServices = undefined;
                programs.clear();
                for (const controller of runs.values()) controller.abort();
                answer(message.id, null);
                return;
            case 'port-result': {
                const call = pending.get(message.callId);
                if (!call) return; // the worker stopped waiting for this call
                pending.delete(message.callId);
                if (message.ok) call.resolve(message.value);
                else call.reject(portFailure(message.error));
                return;
            }
        }
    }

    endpoint.addEventListener('message', event => {
        if (closed) return;
        const data = event.data;
        if (!isBridgeMessage(data)) return;
        void handle(data as ToWorker).catch(error => {
            const id = (data as { id?: unknown }).id;
            if (typeof id === 'string') fail(id, toMinabError(error));
        });
    });
    endpoint.start?.();
    return {
        close() {
            closed = true;
            minab?.dispose();
        }
    };
}

// In a Web Worker this file starts itself. In Node or on the main thread it only exports `serveMinab`.
const scope = globalThis as { WorkerGlobalScope?: new () => unknown };
if (typeof scope.WorkerGlobalScope === 'function' && globalThis instanceof scope.WorkerGlobalScope) {
    serveMinab(globalThis as unknown as BridgeEndpoint);
}
