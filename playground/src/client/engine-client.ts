/**
 * The UI thread's handle on the engine worker: every `EngineApi` method as
 * a promise, plus status events (is Postgres booted yet?).
 *
 * If the worker dies — an out-of-memory WASM heap, a bug — pending calls
 * reject and `restart()` brings up a fresh one; the store replays the
 * current host into it, so the user loses nothing but a moment.
 */

import type { EngineApi, EngineMessage, EngineMethod, EngineRequest, EngineStatus } from '../engine/protocol.js';

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

export class EngineClient {
    private worker!: Worker;
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private readonly statusListeners = new Set<(status: EngineStatus) => void>();
    status: EngineStatus = { phase: 'starting' };

    constructor(private readonly spawn: () => Worker = defaultSpawn) {
        this.start();
    }

    private start(): void {
        this.setStatus({ phase: 'starting' });
        this.worker = this.spawn();
        this.worker.onmessage = (event: MessageEvent<EngineMessage>) => {
            const message = event.data;
            if ('event' in message) {
                this.setStatus(message.status);
                return;
            }
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.ok) pending.resolve(message.value);
            else pending.reject(new Error(message.error));
        };
        this.worker.onerror = event => {
            event.preventDefault();
            const error = new Error(event.message || 'the engine stopped unexpectedly');
            for (const pending of this.pending.values()) pending.reject(error);
            this.pending.clear();
            this.setStatus({ phase: 'failed', error: error.message });
        };
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
        this.worker.terminate();
        for (const pending of this.pending.values()) pending.reject(new Error('the engine was restarted'));
        this.pending.clear();
        this.start();
    }

    call<M extends EngineMethod>(method: M, ...args: Parameters<EngineApi[M]>): ReturnType<EngineApi[M]> {
        const id = this.nextId++;
        const request: EngineRequest<M> = { id, method, args };
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage(request);
        }) as ReturnType<EngineApi[M]>;
    }
}

function defaultSpawn(): Worker {
    return new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module', name: 'minab-engine' });
}

let shared: EngineClient | undefined;

/** The one engine the app uses — created on first use, so the landing page can warm it up on idle. */
export function engineClient(): EngineClient {
    shared ??= new EngineClient();
    return shared;
}
