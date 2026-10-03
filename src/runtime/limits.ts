/**
 * Limits and the budget of one run (ADR 0002, section 6; decision D36).
 *
 * Limits are always on. A host sets them in `createMinab({ limits })`. One
 * `run` may only make them tighter. `RunBudget` counts what one run uses and
 * stops it at a limit or when the host aborts.
 *
 * Nothing here may touch Node or the DOM.
 */

import { coded, type DiagnosticCode, type ParamsArgs } from '../language/diagnostics/codes.js';
import type { SourceRange } from './types.js';

export interface Limits {
    /** UTF-8 bytes of the source. Checked at `prepare`. */
    sourceLength: number;
    /** Nesting depth of expressions. Checked at `prepare`. */
    nestingDepth: number;
    /** Wall time of one run, in milliseconds. */
    wallTimeMs: number;
    /** Statements sent to the data port in one run. */
    statements: number;
    /** Rows one statement may return. */
    rowsPerStatement: number;
    /** Loop iterations in one run, over all loops. */
    loopIterations: number;
    /** Depth of user function calls. */
    callDepth: number;
    /** Log entries kept in one run. Extra entries are dropped and counted (L7). */
    logEntries: number;
    /** Runs in one wire request. The run endpoint checks it (H2). */
    batchRuns: number;
}

/** The defaults of D36. */
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
    sourceLength: 64 * 1024,
    nestingDepth: 200,
    wallTimeMs: 1_000,
    statements: 100,
    rowsPerStatement: 10_000,
    loopIterations: 100_000,
    callDepth: 64,
    logEntries: 100,
    batchRuns: 100
});

const LIMIT_NAMES = Object.keys(DEFAULT_LIMITS) as (keyof Limits)[];

function checkLimits(given: Partial<Limits> | undefined, where: string): Partial<Limits> {
    if (given === undefined) return {};
    if (typeof given !== 'object' || given === null) throw new TypeError(`${where}: limits must be an object`);
    for (const [name, value] of Object.entries(given)) {
        if (!(LIMIT_NAMES as string[]).includes(name)) throw new TypeError(`${where}: "${name}" is not a limit (${LIMIT_NAMES.join(', ')})`);
        if (value === undefined) continue;
        if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) throw new TypeError(`${where}: the limit "${name}" must be a number above zero`);
    }
    return given;
}

/** The host's limits: the defaults, with the values the host gave. A host may raise or lower each one. */
export function resolveLimits(host: Partial<Limits> | undefined): Limits {
    const given = checkLimits(host, 'createMinab');
    const limits = { ...DEFAULT_LIMITS };
    for (const name of LIMIT_NAMES) {
        const value = given[name];
        if (value !== undefined) limits[name] = value;
    }
    return limits;
}

/** The limits of one run: each one is the smaller of the host's value and the run's value. A run never raises a limit. */
export function tightenLimits(host: Limits, run: Partial<Limits> | undefined): Limits {
    const given = checkLimits(run, 'run');
    const limits = { ...host };
    for (const name of LIMIT_NAMES) {
        const value = given[name];
        if (value !== undefined) limits[name] = Math.min(host[name], value);
    }
    return limits;
}

/**
 * Why a run stopped: a limit (`limit.*`) or the host's abort (`cancelled`).
 * The interpreter and the runtime throw it. `prepare.run` turns it into a result.
 */
export class RunStopped extends Error {
    range?: SourceRange;

    constructor(
        readonly code: string,
        message: string,
        readonly params: Record<string, string | number> = {}
    ) {
        super(message);
        this.name = 'RunStopped';
    }
}

/** A stop with a code from the registry: its English text and parameters come from there. */
export function stop<C extends DiagnosticCode>(code: C, ...args: ParamsArgs<C>): RunStopped {
    const message = coded(code, ...args);
    return new RunStopped(message.code, message.reason, message.params as Record<string, string | number>);
}

/** What the run counted. */
export interface RunCounts {
    statements: number;
    rows: number;
    loopIterations: number;
}

/**
 * The budget of one run. It owns an internal abort signal, joined from the
 * host's signal and the wall-time timer. Call `dispose()` when the run ends.
 */
export class RunBudget {
    readonly counts: RunCounts = { statements: 0, rows: 0, loopIterations: 0 };
    private readonly controller = new AbortController();
    private readonly deadline: number;
    private readonly timer: ReturnType<typeof setTimeout> | undefined;
    private readonly onHostAbort: () => void;
    private timedOut = false;
    private depth = 0;

    constructor(
        readonly limits: Limits,
        private readonly hostSignal?: AbortSignal
    ) {
        this.deadline = performance.now() + limits.wallTimeMs;
        // The timer aborts the signal that ports see. The deadline check in `check()` covers a
        // run that never gives the event loop a turn, where a timer cannot fire.
        // A limit of `Infinity` is for the old `evaluate` entry, which has no wall time.
        this.timer = Number.isFinite(limits.wallTimeMs) ? setTimeout(() => this.expire(), limits.wallTimeMs) : undefined;
        this.onHostAbort = () => this.controller.abort();
        if (hostSignal?.aborted) this.controller.abort();
        else hostSignal?.addEventListener('abort', this.onHostAbort, { once: true });
    }

    /** The signal every port call gets. */
    get signal(): AbortSignal {
        return this.controller.signal;
    }

    /** Stops the timer and lets go of the host's signal. */
    dispose(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.hostSignal?.removeEventListener('abort', this.onHostAbort);
    }

    private expire(): void {
        this.timedOut = true;
        this.controller.abort();
    }

    /** The error for the way this run was stopped: the timer (`limit.timeout`) or the host (`cancelled`). */
    private stopError(): RunStopped {
        if (this.timedOut || (!this.hostSignal?.aborted && performance.now() >= this.deadline)) {
            return stop('limit.timeout', { limit: this.limits.wallTimeMs });
        }
        return stop('cancelled');
    }

    /** Called between interpreter steps. Throws when the host aborted or the time is up. */
    check(): void {
        if (this.hostSignal?.aborted) throw stop('cancelled');
        if (this.timedOut || performance.now() >= this.deadline) throw this.stopError();
    }

    /**
     * Waits for a port call, but stops waiting when the run is aborted. A host function may
     * ignore the signal, and the run must still end on time. The call itself is not stopped:
     * the port sees the signal and may stop it.
     */
    race<T>(call: Promise<T>): Promise<T> {
        const { signal } = this.controller;
        if (signal.aborted) {
            call.catch(() => {});
            return Promise.reject(this.stopError());
        }
        return new Promise<T>((resolve, reject) => {
            const onAbort = () => reject(this.stopError());
            signal.addEventListener('abort', onAbort, { once: true });
            call.then(
                value => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(value);
                },
                error => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                }
            );
        });
    }

    /** Before each data call. */
    beforeStatement(): void {
        this.check();
        if (this.counts.statements >= this.limits.statements) {
            throw stop('limit.tooManyStatements', { limit: this.limits.statements });
        }
        this.counts.statements++;
    }

    /** After each data call. */
    afterStatement(rows: number): void {
        if (rows > this.limits.rowsPerStatement) {
            throw stop('limit.tooManyRows', { limit: this.limits.rowsPerStatement });
        }
        this.counts.rows += rows;
    }

    /** At each loop step. Statements that loop (X4) call it. */
    countIteration(): void {
        this.check();
        if (++this.counts.loopIterations > this.limits.loopIterations) {
            throw stop('limit.tooManyIterations', { limit: this.limits.loopIterations });
        }
    }

    /** At each user function call. Call the returned function when the call ends. */
    enterCall(): () => void {
        if (this.depth >= this.limits.callDepth) {
            throw stop('limit.callDepth', { limit: this.limits.callDepth });
        }
        this.depth++;
        return () => {
            this.depth--;
        };
    }
}

/** No limit at all. Only the old `evaluate` entry uses it, until R7 and R8 move the CLI and the playground to `run`. */
export const NO_LIMITS: Readonly<Limits> = Object.freeze({
    sourceLength: Infinity,
    nestingDepth: Infinity,
    wallTimeMs: Infinity,
    statements: Infinity,
    rowsPerStatement: Infinity,
    loopIterations: Infinity,
    callDepth: Infinity,
    logEntries: Infinity,
    batchRuns: Infinity
});
