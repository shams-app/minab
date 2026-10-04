/**
 * The page side of the bridge (entry `@shamsine/minab/browser`, production plan H4).
 *
 * `createWorkerMinab({ worker, schema, ... })` runs Minab in a Web Worker and gives the
 * same shape as `createMinab`: `prepare` and `run`. The parser stays off the main thread.
 * While a program runs, the worker can call back to the ports you give to `run`
 * (data, host functions, clock, events). They run here, on the page.
 */

import { resolveHostDeclarations } from '../language/host-declarations.js';
import { dependsOnField } from '../runtime/analyze.js';
import { runError, sqlstateOf } from '../runtime/errors.js';
import { resolveLimits } from '../runtime/limits.js';
import { PortError } from '../runtime/ports.js';
import type { CompileResult, MinabError, MinabOptions, PrepareOptions, PreparedProgram, RunInputs, RunOptions, RunPorts, RunResult } from '../runtime/types.js';
import { WireError } from '../runtime/wire.js';
import {
    BRIDGE_VERSION,
    PORT_METHODS,
    PORT_NAMES,
    badMessage,
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

export type { Endpoint } from './protocol.js';
export { BRIDGE_VERSION, fromWire, toWire } from './protocol.js';

/** What a worker needs to look like. A `Worker` and a `MessagePort` both fit. */
export interface WorkerHandle extends Endpoint {
    /** A `Worker` has it. Called by `dispose`. */
    terminate?(): void;
    onerror?: ((event: unknown) => void) | null;
}

export interface WorkerMinabOptions extends MinabOptions {
    /**
     * Makes the worker, for example
     * `() => new Worker(new URL('@shamsine/minab/browser/worker', import.meta.url), { type: 'module' })`.
     * Called once. Give a worker file of your own when a port lives inside the worker.
     */
    worker: () => WorkerHandle;
}

/** Like `Minab`, without `cacheStats` (the cache lives in the worker). */
export interface WorkerMinab {
    prepare(source: string, options?: PrepareOptions): Promise<PreparedProgram>;
    /** Stops the worker. Requests still waiting fail with `wire.workerStopped`. */
    dispose(): void;
}

interface Waiting {
    resolve(value: Crossing): void;
    reject(error: unknown): void;
}

interface ActiveRun {
    ports: RunPorts;
    /** One controller for each port call in progress, so a `port-cancel` can abort it. */
    calls: Map<number, AbortController>;
}

/** A failure from the worker: it has the code, the message and the params of the error. */
export class BridgeError extends Error {
    constructor(readonly error: MinabError) {
        super(error.message);
        this.name = 'BridgeError';
    }
    get code(): string {
        return this.error.code;
    }
}

export function createWorkerMinab(options: WorkerMinabOptions): WorkerMinab {
    // Check the host's names and limits now, on the page, so a mistake shows at startup like `createMinab`.
    resolveHostDeclarations({ functions: options.functions, inputs: options.inputs }, options.schema);
    resolveLimits(options.limits);

    const { worker: makeWorker, ...createOptions } = options;
    const worker = makeWorker();
    const waiting = new Map<number, Waiting>();
    const runs = new Map<number, ActiveRun>();
    let nextId = 1;
    let disposed = false;

    const stopped = () => new BridgeError(runError('wire.workerStopped', undefined));

    function post(request: BridgeRequest): void {
        worker.postMessage(request);
    }

    function request(build: (id: number) => BridgeRequest): { id: number; reply: Promise<Crossing> } {
        if (disposed) return { id: 0, reply: Promise.reject(stopped()) };
        const id = nextId++;
        const reply = new Promise<Crossing>((resolve, reject) => {
            waiting.set(id, { resolve, reject });
            try {
                post(build(id));
            } catch (e) {
                waiting.delete(id);
                reject(e instanceof WireError ? new BridgeError(e.error) : e);
            }
        });
        return { id, reply };
    }

    // ---- ports on the page ----------------------------------------------

    async function callPort(runId: number, port: PortName, method: string, args: Crossing[], signal: AbortSignal): Promise<Crossing> {
        const ports = runs.get(runId)?.ports;
        if (!ports || !(PORT_NAMES as readonly string[]).includes(port) || !PORT_METHODS[port].includes(method)) {
            throw new WireError(badMessage(`no port call "${String(port)}.${String(method)}"`));
        }
        const decoded = args.map(a => fromWire(a));
        switch (port) {
            case 'data': {
                if (!ports.data) throw new PortError('data.noPort', 'this program needs data, and no data port was given');
                return toWire(await ports.data.execute(decoded[0] as never, { signal }));
            }
            case 'functions': {
                if (!ports.hostFunctions) throw new PortError('eval.hostFunctionMissing', 'no host functions were given');
                return toWire(await ports.hostFunctions.call(String(decoded[0]), decoded[1] as unknown[], { signal }));
            }
            case 'clock':
                if (!ports.clock) throw new PortError('wire.badMessage', 'no clock was given');
                return toWire(method === 'now' ? ports.clock.now() : ports.clock.timeZone);
            case 'events':
                ports.events?.emit(decoded[0] as never);
                return null;
        }
    }

    function toPortError(port: PortName, e: unknown): Extract<BridgeRequest, { type: 'port-result'; ok: false }> {
        if (e instanceof PortError) return { v: 1, type: 'port-result', callId: 0, ok: false, error: { code: e.code, message: e.message, params: {} } };
        if (e instanceof WireError) return { v: 1, type: 'port-result', callId: 0, ok: false, error: e.error };
        // Not a coded error: the text of a driver error may hold SQL or data, so it does not cross.
        const sqlstate = sqlstateOf(e);
        return {
            v: 1,
            type: 'port-result',
            callId: 0,
            ok: false,
            raw: true,
            error: { code: port === 'data' ? 'data.error' : 'eval.failed', message: 'the port failed', params: sqlstate ? { sqlstate } : {} }
        };
    }

    function onPortCall(message: Extract<BridgeResponse, { type: 'port-call' }>): void {
        const run = runs.get(message.runId);
        const controller = new AbortController();
        run?.calls.set(message.callId, controller);
        callPort(message.runId, message.port, message.method, message.args, controller.signal)
            .then(
                (value): BridgeRequest => ({ v: 1, type: 'port-result', callId: message.callId, ok: true, value }),
                (e: unknown): BridgeRequest => ({ ...toPortError(message.port, e), callId: message.callId })
            )
            .then(reply => {
                run?.calls.delete(message.callId);
                // Nobody waits when the call was cancelled, and nobody waits for a one-way call.
                if (!controller.signal.aborted && !message.oneWay) post(reply);
            })
            .catch(() => {
                // A value that cannot cross: tell the worker, so the run does not wait for nothing.
                run?.calls.delete(message.callId);
                if (!message.oneWay && !controller.signal.aborted) {
                    post({
                        v: 1,
                        type: 'port-result',
                        callId: message.callId,
                        ok: false,
                        error: runError('wire.invalidValue', undefined, { path: '(port answer)', expected: 'a Minab value' })
                    });
                }
            });
    }

    // ---- messages from the worker ----------------------------------------

    function fail(error: unknown): void {
        for (const entry of waiting.values()) entry.reject(error);
        waiting.clear();
    }

    worker.onmessage = event => {
        const message = event.data;
        if (!isMessage(message) || message.v !== BRIDGE_VERSION) return;
        const m = message as BridgeResponse;
        switch (m.type) {
            case 'response': {
                const entry = waiting.get(m.id);
                if (!entry) return;
                waiting.delete(m.id);
                if (m.ok) entry.resolve(m.value);
                else entry.reject(new BridgeError(m.error));
                return;
            }
            case 'port-call':
                return onPortCall(m);
            case 'port-cancel':
                for (const run of runs.values()) run.calls.get(m.callId)?.abort();
                return;
        }
    };
    worker.onerror = () => {
        disposed = true;
        fail(stopped());
    };

    // ---- a prepared program ------------------------------------------------

    class RemoteProgram implements PreparedProgram {
        readonly diagnostics: PreparedProgram['diagnostics'];
        readonly ok: boolean;
        readonly kind: PreparedProgram['kind'];
        readonly resultType?: string;
        readonly analysis: PreparedProgram['analysis'];
        private readonly compiled: CompileResult;

        constructor(private readonly snapshot: PreparedSnapshot) {
            this.diagnostics = snapshot.diagnostics;
            this.ok = !snapshot.diagnostics.some(d => d.severity === 'error');
            this.kind = snapshot.kind;
            if (snapshot.resultType !== undefined) this.resultType = snapshot.resultType;
            this.analysis = snapshot.analysis;
            this.compiled = decodeCompile(snapshot.compile);
        }

        dependsOn(field: string): boolean {
            return dependsOnField(this.analysis, field);
        }

        compile(): CompileResult {
            return this.compiled;
        }

        async run(inputs: RunInputs = {}, ports: RunPorts = {}, runOptions: RunOptions = {}): Promise<RunResult> {
            if (disposed) return { ok: false, error: stopped().error };
            if (runOptions.signal?.aborted) return { ok: false, error: runError('cancelled', undefined) };
            let encoded: Crossing;
            try {
                encoded = toWire(inputs);
            } catch (e) {
                if (e instanceof WireError) return { ok: false, error: e.error };
                throw e;
            }
            const present = PORT_NAMES.filter(name => (name === 'functions' ? ports.hostFunctions : ports[name]));
            let runId = 0;
            const { id, reply } = request(id => {
                runId = id;
                runs.set(id, { ports, calls: new Map() });
                return { v: 1, type: 'run', id, program: this.snapshot.program, inputs: encoded, ports: present, limits: runOptions.limits };
            });
            runId = id;
            const onAbort = () => post({ v: 1, type: 'cancel', id });
            runOptions.signal?.addEventListener('abort', onAbort, { once: true });
            try {
                const answer = (await reply) as { ok: boolean; value?: Crossing; logs?: string[]; stats?: RunResult & object; error?: MinabError };
                if (!answer.ok) return { ok: false, error: answer.error as MinabError };
                return { ok: true, value: fromWire(answer.value), logs: answer.logs ?? [], stats: answer.stats as never };
            } catch (e) {
                if (e instanceof BridgeError) return { ok: false, error: e.error };
                if (e instanceof WireError) return { ok: false, error: e.error };
                throw e;
            } finally {
                runOptions.signal?.removeEventListener('abort', onAbort);
                for (const call of runs.get(runId)?.calls.values() ?? []) call.abort();
                runs.delete(runId);
            }
        }
    }

    function decodeCompile(value: Crossing): CompileResult {
        const result = value as { ok: true; sql: { text: string; params: Crossing } } | { ok: false; error: MinabError };
        return result.ok ? { ok: true, sql: { text: result.sql.text, params: fromWire(result.sql.params) as unknown[] } } : result;
    }

    // `create` goes first. The worker handles messages in order, so every later request sees it.
    const created = request(id => ({ v: 1, type: 'create', id, options: createOptions })).reply;
    created.catch(() => {});

    return {
        async prepare(source: string, prepareOptions?: PrepareOptions): Promise<PreparedProgram> {
            if (disposed) throw stopped();
            if (typeof source !== 'string') throw new TypeError('prepare needs the program source as a string');
            await created;
            const snapshot = (await request(id => ({ v: 1, type: 'prepare', id, source, options: prepareOptions })).reply) as PreparedSnapshot;
            return new RemoteProgram(snapshot);
        },
        dispose(): void {
            if (disposed) return;
            post({ v: 1, type: 'dispose', id: nextId++ });
            disposed = true;
            fail(stopped());
            worker.onmessage = null;
            worker.terminate?.();
        }
    };
}
