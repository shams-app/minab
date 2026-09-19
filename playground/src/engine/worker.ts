/**
 * The engine's Web Worker entry: a thin message router around `Engine`.
 * Langium parsing and PGlite's WebAssembly both stay off the UI thread, so
 * typing never stutters while a query runs.
 */

import { Engine } from './engine.js';
import type { EngineMessage, EngineRequest } from './protocol.js';

const scope = self as unknown as {
    postMessage(message: EngineMessage): void;
    onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
};

const engine = new Engine(status => scope.postMessage({ event: 'status', status }));

scope.onmessage = async ({ data }) => {
    const { id, method, args } = data;
    try {
        const handler = engine[method] as (...a: unknown[]) => Promise<unknown>;
        const value = await handler.apply(engine, args as unknown[]);
        scope.postMessage({ id, ok: true, value });
    } catch (e) {
        scope.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
};

engine.start();
