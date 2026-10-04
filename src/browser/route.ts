/**
 * `routeByTier`: one `run` for app code, wherever the program runs (phase H5, decision D30).
 *
 * A program is prepared locally (in the worker), because the analysis says where it can run:
 *  - tier `local`: it needs no data, so it runs in the browser worker, with zero network calls;
 *  - tier `data`: it needs data, so it goes to the server by program id and version.
 *
 * SQL and the schema never leave the browser (decision D28).
 *
 * Nothing here may touch Node or the DOM.
 */

import type { EventSink } from '../runtime/ports.js';
import type { MinabDiagnostic, PrepareOptions, ProgramAnalysis, ProgramKind, RunInputs, RunOptions, RunPorts, RunResult } from '../runtime/types.js';
import type { WorkerPreparedProgram } from './index.js';
import type { RemoteMinab } from './remote.js';

/** A program as the host stores it (decision D34). `source` is what the browser checks and runs locally. */
export interface StoredProgram {
    id: string;
    version: string;
    source: string;
}

/** What the router needs from the local side: `createWorkerMinab` gives it. */
export interface LocalMinab {
    /** Parses and checks the program in the worker. */
    prepare(source: string, options?: PrepareOptions): Promise<WorkerPreparedProgram>;
}

/** Options of `routeByTier`. */
export interface RouteOptions {
    local: LocalMinab;
    remote: RemoteMinab;
    /** Default sink for the logs of local and remote runs. A run can give its own in `ports.events`. */
    events?: EventSink;
}

/** A program that was prepared in the worker. `run` goes to the worker or to the server, as its tier says. */
export interface RoutedProgram {
    readonly id: string;
    readonly version: string;
    readonly diagnostics: readonly MinabDiagnostic[];
    readonly ok: boolean;
    readonly kind: ProgramKind;
    readonly resultType?: string;
    readonly analysis: ProgramAnalysis;
    /** Where `run` goes: `local` (the worker) or `remote` (the server). */
    readonly route: 'local' | 'remote';
    /**
     * Runs the program where its tier says. Data, host function and write ports are used by local runs only:
     * a remote run uses the ports of the server.
     */
    run(inputs?: RunInputs, ports?: RunPorts, options?: RunOptions): Promise<RunResult>;
    /** Frees the local program. */
    release(): void;
}

/** Prepares programs and decides where each one runs. */
export interface TierRouter {
    /** Prepares the source in the worker and reads its analysis. Tier `local` runs in the worker; tier `data` runs on the server by id and version. */
    prepare(program: StoredProgram, options?: PrepareOptions): Promise<RoutedProgram>;
}

/** Makes a router. A program that needs no data runs in the worker. A program that needs data goes to the server by id and version. SQL and the schema are never sent. */
export function routeByTier(options: RouteOptions): TierRouter {
    return {
        async prepare(program, prepareOptions) {
            const prepared = await options.local.prepare(program.source, prepareOptions);
            // A program that failed its check never goes to the server: the local run gives the same error.
            const route = prepared.ok && prepared.analysis.tier === 'data' ? 'remote' : 'local';
            return {
                id: program.id,
                version: program.version,
                diagnostics: prepared.diagnostics,
                ok: prepared.ok,
                kind: prepared.kind,
                ...(prepared.resultType === undefined ? {} : { resultType: prepared.resultType }),
                analysis: prepared.analysis,
                route,
                run(inputs, ports = {}, runOptions = {}) {
                    const events = ports.events ?? options.events;
                    if (route === 'local') return prepared.run(inputs, { ...ports, ...(events ? { events } : {}) }, runOptions);
                    return options.remote.run({ id: program.id, version: program.version }, inputs, {
                        ...(runOptions.signal ? { signal: runOptions.signal } : {}),
                        ...(runOptions.limits ? { limits: runOptions.limits } : {}),
                        ...(prepared.resultType === undefined ? {} : { resultType: prepared.resultType }),
                        ...(events ? { events } : {})
                    });
                },
                release: () => prepared.release()
            };
        }
    };
}
