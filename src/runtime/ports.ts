/**
 * Ports: everything a program needs from outside goes through one of these
 * (ADR 0002, section 4). They are plain interfaces. None of them names a
 * Node, DOM or driver type. The host implements them and gives them to each
 * `run`.
 *
 * - `DataPort`: SQL text and parameters (D28).
 * - `WritePort`: one transaction for the writes of a run (X5). The Node adapters are in `src/node/`.
 * - `HostFunctions`: the host's implementation of the functions it declared (D27).
 * - `ClockPort`: the instant of the run and the time zone.
 * - `EventSink`: one stream for statements, logs and timing (D33).
 */

import type { Row, SqlQuery } from '../language/minab-executor.js';
import type { SourceRange } from './types.js';

/**
 * `QueryExecutor` is the name the code used before R3. It has no second
 * argument, and it still fits `DataPort`: a function that takes fewer
 * arguments is accepted. R7 and R8 move the CLI and the playground to `DataPort`.
 */
export type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';
export type { HostDeclarations, HostFunctionDeclaration, HostInputType } from '../language/host-declarations.js';

// ---- data ----------------------------------------------------------------

export interface DataContext {
    /** R4 makes it stop the run. A port should pass it to its driver when it can. */
    signal: AbortSignal;
}

export interface DataPort {
    execute(query: SqlQuery, context: DataContext): Promise<Row[]>;
}

// ---- write ---------------------------------------------------------------

export interface WritePort {
    /**
     * Run `work` in one transaction. Commit when it resolves, roll back when it throws or the signal aborts.
     * A host that already has a transaction (a TypeORM `QueryRunner`) gives a port whose `transaction` only
     * calls `work` inside it: the host commits or rolls back, Minab only executes.
     */
    transaction<T>(work: (tx: WriteTransaction) => Promise<T>, context: DataContext): Promise<T>;
}

export interface WriteTransaction extends DataPort {
    /**
     * `INSERT`, `UPDATE` or `DELETE` text with parameters. `affected` is the row count the database reports.
     * Minab's own statements have no `RETURNING`, so `rows` is empty.
     */
    executeWrite(query: SqlQuery, context: DataContext): Promise<{ rows: Row[]; affected: number }>;
}

/** A failure of a port that has a stable code. */
export class PortError extends Error {
    constructor(
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'PortError';
    }
}

/** The default write port: it refuses. A host gives a real one to apply writes. */
export const REFUSING_WRITE_PORT: WritePort = {
    transaction: () => Promise.reject(new PortError('eval.writesNotSupported', 'this run has no write port, so the program cannot write'))
};

// ---- host functions ------------------------------------------------------

/** Implemented by the host, given per run. The declarations (names and types) go to `createMinab`. */
export interface HostFunctions {
    call(name: string, args: unknown[], context: { signal: AbortSignal }): unknown | Promise<unknown>;
}

// ---- clock ---------------------------------------------------------------

export interface ClockPort {
    /** The instant the run started. The runtime calls it once for each run. */
    now(): Date;
    /** An IANA name such as `Asia/Tehran`. */
    readonly timeZone: string;
}

/** The default clock: the system clock, in UTC. */
export const SYSTEM_CLOCK: ClockPort = { now: () => new Date(), timeZone: 'UTC' };

// ---- events --------------------------------------------------------------

export type MinabEvent =
    /** Sent just before the statement goes to the data port. The duration comes later, in a `timing` event. */
    | { kind: 'statement'; sql: string; params: unknown[]; range?: SourceRange }
    /**
     * `LOG(value, label?)` output (L7). `message` is the one-line text (`label: value`, newlines escaped, D37).
     * `value` is the value as a host sees it. `time` is the milliseconds since the run started.
     * After `logEntries` entries (D36) the run drops the rest and sends no more.
     */
    | { kind: 'log'; message: string; value?: unknown; label?: string; range?: SourceRange; time?: number }
    /**
     * A write that a dry run (`writes: 'dry-run'`) collected and did not run (X5). It comes at the moment the
     * program reaches the write, so a host can show it in order with the reads. An applied write sends `statement`.
     */
    | { kind: 'dryRun'; sql: string; params: unknown[]; range?: SourceRange }
    /** `data`: one call of the data port. `run`: the whole run. */
    | { kind: 'timing'; phase: 'prepare' | 'compile' | 'run' | 'data'; durationMs: number };

export interface EventSink {
    /** Must not throw. The runtime catches a throw and drops it. */
    emit(event: MinabEvent): void;
}
