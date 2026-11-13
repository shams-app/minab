/**
 * Ports: everything a program needs from outside goes through one of these
 * (ADR 0002, section 4). They are plain interfaces. None of them names a
 * Node, DOM or driver type. The host implements them and gives them to each
 * `run`.
 *
 * - `DataPort`: SQL text and parameters (D28).
 * - `WritePort`: one transaction for the writes of a run (X5). The Node adapters are in `src/node/`.
 * - `DirectoryPort`: the workspace's users and groups (MN.2, P11).
 * - `HostFunctions`: the host's implementation of the functions it declared (D27).
 * - `ClockPort`: the instant of the run and the time zone.
 * - `EventSink`: one stream for statements, logs and timing (D33).
 */

import type { Row, SqlQuery } from '../language/minab-executor.js';
import type { DirectoryRuntime } from '../language/directory-values.js';
import type { DirectorySchema } from '../language/schema.js';
import type { SourceRange } from './types.js';

/**
 * `QueryExecutor` is the name the code used before R3. It has no second
 * argument, and it still fits `DataPort`: a function that takes fewer
 * arguments is accepted. R7 and R8 move the CLI and the playground to `DataPort`.
 */
export type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';
export type { HostDeclarations, HostFunctionDeclaration, HostInputType } from '../language/host-declarations.js';

// ---- data ----------------------------------------------------------------

/** What the runtime gives to every data port call. */
export interface DataContext {
    /** R4 makes it stop the run. A port should pass it to its driver when it can. */
    signal: AbortSignal;
}

/** The host's database, seen from Minab. It runs SQL text with `$1`-style parameters and returns rows. Minab never opens a connection itself. */
export interface DataPort {
    /** Runs one statement and returns its rows. Pass `context.signal` to the driver when it can cancel. */
    execute(query: SqlQuery, context: DataContext): Promise<Row[]>;
}

// ---- directory -----------------------------------------------------------

/** What the runtime gives to every directory port call. A port should pass the signal to its driver when it can. */
export interface DirectoryContext {
    signal: AbortSignal;
}

/** What a route call gets: how many route calls are open around it (the first one is `0`). A host that runs a route body passes it on. */
export interface RouteContext extends DirectoryContext {
    depth: number;
}

/**
 * A user as the directory gives it: `id` and `name`, and a column for each of `schema()`.
 * A person who left the workspace keeps `id` and `name`; every other column is `null` (P10).
 */
export type DirectoryUser = Row & { id: string; name: string | null };

/** A group as the directory gives it: `id`, `name` and `tags`. */
export type DirectoryGroup = Row & { id: string; name: string; tags: string[] };

/** The text of a filter over `@@everyone` (`.city == 'Marand'`), for a host that can answer it faster than a full list. */
export interface DirectoryFilter {
    source: string;
}

/**
 * The workspace's users and groups, seen from Minab (P11). A set of users stays a tree in the interpreter and asks
 * the port only what the program needs: `u IN A + B` is `isMember` for each side, and `members` is read only to
 * list a set (`COUNT`, a loop, a result, `single`), at most `limits.maxUsers` users. Minab never opens a connection.
 */
export interface DirectoryPort {
    /** One answer for each id, in any order. An id the directory does not know has `name: null` and no other column (P10). */
    resolveUsers(ids: string[], context: DirectoryContext): Promise<DirectoryUser[]>;
    /** The id of the user with this id, e-mail or phone (normalized like sign-in), or `null`. */
    findUser(key: string, context: DirectoryContext): Promise<string | null>;
    /** The group with this name, or `null`. */
    findGroup(name: string, context: DirectoryContext): Promise<DirectoryGroup | null>;
    /** One page of the member ids of a group, nested groups flattened. `next` is the cursor of the next page. */
    members(groupId: string, cursor: string | undefined, context: DirectoryContext): Promise<{ ids: string[]; next?: string }>;
    /** Is the user in the group, directly or through nesting? Someone who left is in no group. */
    isMember(userId: string, groupId: string, context: DirectoryContext): Promise<boolean>;
    /** The groups the user is in, directly or through nesting. */
    groupsOf(userId: string, context: DirectoryContext): Promise<DirectoryGroup[]>;
    /** Runs the route `name` for one user: the ids of the users it answers (a `USER?` route answers none or one). */
    callRoute(name: string, userId: string, context: RouteContext): Promise<string[]>;
    /** Optional. The members of `@@everyone` that match a filter, at most `limit`; `null` when the port cannot tell. Without it the interpreter lists `everyone` and filters. */
    findUsers?(filter: DirectoryFilter, limit: number, context: DirectoryContext): Promise<DirectoryUser[] | null>;
    /** The columns of `USER` and `GROUP`, for the host's schema. */
    schema(): DirectorySchema;
}

/** The default directory port: it refuses. A host gives a real one to run programs that read users and groups. */
export const NO_DIRECTORY_PORT: DirectoryPort = (() => {
    const refuse = (): never => {
        throw new PortError('eval.failed', 'this program reads users and groups, and the run has no directory port');
    };
    return {
        resolveUsers: refuse,
        findUser: refuse,
        findGroup: refuse,
        members: refuse,
        isMember: refuse,
        groupsOf: refuse,
        callRoute: refuse,
        schema: () => ({})
    };
})();

// ---- write ---------------------------------------------------------------

/** The host's way to run writes in one transaction. The interface is fixed (R3). */
export interface WritePort {
    /**
     * Run `work` in one transaction. Commit when it resolves, roll back when it throws or the signal aborts.
     * A host that already has a transaction (a TypeORM `QueryRunner`) gives a port whose `transaction` only
     * calls `work` inside it: the host commits or rolls back, Minab only executes.
     */
    transaction<T>(work: (tx: WriteTransaction) => Promise<T>, context: DataContext): Promise<T>;
}

/** A transaction a `WritePort` hands to the work it runs. It can read and write. */
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
    /** Runs the host function `name`. The runtime checks the argument count and the types of the result. */
    call(name: string, args: unknown[], context: HostCallContext): unknown | Promise<unknown>;
}

/** What a host function gets with each call. */
export interface HostCallContext {
    signal: AbortSignal;
    /** The run's view of the directory (MN.2): the directory host functions read special users and list sets through it. */
    directory?: DirectoryRuntime;
}

// ---- clock ---------------------------------------------------------------

/** The clock of a run. The runtime reads it once per run, so every `NOW()` in the run gives the same instant. */
export interface ClockPort {
    /** The instant the run started. The runtime calls it once for each run. */
    now(): Date;
    /** An IANA name such as `Asia/Tehran`. */
    readonly timeZone: string;
}

/** The default clock: the system clock, in UTC. */
export const SYSTEM_CLOCK: ClockPort = { now: () => new Date(), timeZone: 'UTC' };

// ---- events --------------------------------------------------------------

/** Something that happened during a run: a statement, a log line, or a timing. */
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

/** Where a run sends its events. One sink per host: stderr, a log, a tab. */
export interface EventSink {
    /** Must not throw. The runtime catches a throw and drops it. */
    emit(event: MinabEvent): void;
}
