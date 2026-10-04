/**
 * `consoleEventSink`: shows Minab events in the browser console (phase H5).
 *
 * A local run gives its events to `RunPorts.events`. A remote run gives back the text of its `LOG`
 * entries. Both end in the same sink, so a developer sees logs the same way. Use `emitLogs` to
 * pass the logs of a remote result to a sink.
 *
 * Nothing here may touch Node or the DOM. It only needs an object with `log` and `debug`.
 */

import type { EventSink, MinabEvent } from '../runtime/ports.js';

/** The part of `console` that the sink uses. */
export interface ConsoleLike {
    log(...args: unknown[]): void;
    debug(...args: unknown[]): void;
}

export interface ConsoleSinkOptions {
    /** Where to write. Default: the global `console`. */
    console?: ConsoleLike;
    /** Also show the SQL of each statement (as `debug`). Default `false`. */
    statements?: boolean;
}

/** Writes `LOG` output with `console.log`, and the SQL of statements with `console.debug` when asked. */
export function consoleEventSink(options: ConsoleSinkOptions = {}): EventSink {
    const target = options.console ?? console;
    return {
        emit(event: MinabEvent) {
            if (event.kind === 'log') target.log(`[minab] ${event.message}`);
            else if (event.kind === 'statement' && options.statements) target.debug(`[minab] ${event.sql}`, event.params);
        }
    };
}

/** Gives the log entries of a remote result to a sink, as `log` events. A sink that throws is ignored. */
export function emitLogs(sink: EventSink | undefined, logs: readonly string[] | undefined): void {
    if (!sink || !logs) return;
    for (const message of logs) {
        try {
            sink.emit({ kind: 'log', message });
        } catch {
            // dropped on purpose: a sink must not stop a run
        }
    }
}
