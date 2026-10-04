/**
 * The engine's Web Worker entry: `serveMinab` (the browser entry's worker side) with the engine as its
 * one host request. Langium parsing and PGlite's WebAssembly both stay off the UI thread, so typing never
 * stutters while a query runs.
 *
 * `serveEngine` takes the endpoint as an argument so a test can serve the engine on a `MessageChannel`.
 */

import { serveMinab, type MinabServer } from '../../../src/browser/worker.js';
import type { BridgeEndpoint } from '../../../src/browser/protocol.js';
import { Engine } from './engine.js';
import { ENGINE_REQUEST, ENGINE_STATUS_EVENT, type EngineRequest } from './protocol.js';

export function serveEngine(endpoint: BridgeEndpoint): { engine: Engine; server: MinabServer } {
    // The engine reports its status through the server, and the server needs the engine: close the loop with a variable.
    let server: MinabServer | undefined;
    const engine = new Engine(status => server?.emit(ENGINE_STATUS_EVENT, status));
    server = serveMinab(endpoint, {
        requests: {
            [ENGINE_REQUEST]: (payload, { signal }) => {
                const { method, args } = payload as EngineRequest;
                const handler = engine[method] as ((...a: unknown[]) => Promise<unknown>) | undefined;
                if (typeof handler !== 'function') throw new Error(`unknown engine method ${String(method)}`);
                return handler.apply(engine, method === 'run' ? [...(args as unknown[]).slice(0, 2), signal] : (args as unknown[]));
            }
        }
    });
    engine.start();
    return { engine, server };
}

// In a Web Worker this file starts itself. In a test it only exports `serveEngine`.
const scope = globalThis as { WorkerGlobalScope?: new () => unknown };
if (typeof scope.WorkerGlobalScope === 'function' && globalThis instanceof scope.WorkerGlobalScope) {
    serveEngine(globalThis as unknown as BridgeEndpoint);
}
