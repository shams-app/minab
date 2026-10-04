/**
 * The UI thread's handle on the engine worker: every `EngineApi` method as
 * a promise, plus status events (is Postgres booted yet?).
 *
 * It is a thin layer over `createWorkerMinab` from the browser entry: one host
 * request (`engine`) carries the calls, one host event (`status`) carries the status.
 *
 * If the worker dies — an out-of-memory WASM heap, a bug — pending calls
 * reject and `restart()` brings up a fresh one; the store replays the
 * current host into it, so the user loses nothing but a moment.
 */

import { createWorkerMinab, type WorkerMinab } from '../../../src/browser/index.js';
import type { BridgeEndpoint } from '../../../src/browser/protocol.js';
import { ENGINE_REQUEST, ENGINE_STATUS_EVENT, type EngineApi, type EngineMethod, type EngineRequest, type EngineStatus } from '../engine/protocol.js';

/** What the client needs of a worker. A `Worker` fits. */
export type EngineWorker = BridgeEndpoint & {
    terminate(): void;
    addEventListener(type: 'error', listener: (event: { message?: string; preventDefault?(): void }) => void): void;
};

export class EngineClient {
    private minab!: WorkerMinab;
    private generation = 0;
    private readonly statusListeners = new Set<(status: EngineStatus) => void>();
    status: EngineStatus = { phase: 'starting' };

    constructor(private readonly spawn: () => EngineWorker = defaultSpawn) {
        this.start();
    }

    private start(): void {
        this.setStatus({ phase: 'starting' });
        const worker = this.spawn();
        worker.addEventListener('error', event => {
            event.preventDefault?.();
            this.setStatus({ phase: 'failed', error: event.message || 'the engine stopped unexpectedly' });
        });
        // The engine has no schema of its own: every host is set with `setHost`, so the bridge runtime stays empty.
        this.minab = createWorkerMinab({ worker: () => worker, schema: { tables: [] } });
        this.minab.onEvent((name, payload) => {
            if (name === ENGINE_STATUS_EVENT) this.setStatus(payload as EngineStatus);
        });
    }

    private setStatus(status: EngineStatus): void {
        this.status = status;
        for (const listener of this.statusListeners) listener(status);
    }

    onStatus(listener: (status: EngineStatus) => void): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => this.statusListeners.delete(listener);
    }

    /** Replaces the worker; in-flight calls fail with "restarted". */
    restart(): void {
        this.generation++;
        this.minab.dispose();
        this.start();
    }

    call<M extends EngineMethod>(method: M, ...args: Parameters<EngineApi[M]>): ReturnType<EngineApi[M]> {
        return this.send(method, args) as ReturnType<EngineApi[M]>;
    }

    /** Runs a program. Aborting `signal` ends the run in the worker at its next check and rejects at once. */
    run(source: string, runId: number, signal?: AbortSignal): ReturnType<EngineApi['run']> {
        return this.send('run', [source, runId], signal);
    }

    private async send(method: EngineMethod, args: unknown[], signal?: AbortSignal): Promise<never> {
        const generation = this.generation;
        const request = { method, args } as EngineRequest;
        try {
            return await this.minab.request(ENGINE_REQUEST, request, signal ? { signal } : {});
        } catch (error) {
            // A call that was in flight when the engine restarted says so, not "the runtime was disposed".
            throw generation === this.generation ? error : new Error('the engine was restarted');
        }
    }
}

function defaultSpawn(): EngineWorker {
    return new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module', name: 'minab-engine' }) as unknown as EngineWorker;
}

let shared: EngineClient | undefined;

/** The one engine the app uses — created on first use, so the landing page can warm it up on idle. */
export function engineClient(): EngineClient {
    shared ??= new EngineClient();
    return shared;
}
