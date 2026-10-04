/**
 * The public types of the runtime API (ADR 0002, section 3).
 *
 * R2 builds the driving side: `createMinab`, `prepare`, `run`. R3 adds the
 * ports (`ports.ts`): data, write, host functions, clock and events, and the
 * host's declared inputs and functions.
 */

import type { MinabRuleContext, MinabSchema } from '../language/schema.js';
import type { SqlQuery } from '../language/minab-executor.js';
import type { HostFunctionDeclaration, HostInputType } from '../language/host-declarations.js';
import type { ClockPort, DataPort, EventSink, HostFunctions, WritePort } from './ports.js';
import type { Limits } from './limits.js';
import type { ProgramKind } from './program-kind.js';

export type { ProgramKind } from './program-kind.js';

/** 0-based line and character, like the language server protocol. */
export interface SourceRange {
    start: { line: number; character: number };
    end: { line: number; character: number };
}

/** How serious a diagnostic is. Only `error` makes a program invalid. */
export type MinabSeverity = 'error' | 'warning' | 'info' | 'hint';

/** A problem found when a program is prepared: a syntax error, a type error, a warning. Hosts map it to an editor marker by `code`. */
export interface MinabDiagnostic {
    severity: MinabSeverity;
    /** A stable code, for example `type.implicitCoercion`. Hosts translate by code. */
    code: string;
    /** English text. */
    message: string;
    range: SourceRange;
    /** The values the message was built from, for example `{ expected: 'INTEGER', actual: 'TEXT' }`. */
    params: Record<string, string | number>;
}

/** The type the host wants back. Shamsine uses the six words. */
export type ExpectedType = 'text' | 'number' | 'boolean' | 'date' | 'dateTime' | 'list' | { minab: string };

/** What a host gives to `createMinab`. Everything except `schema` is optional. */
export interface MinabOptions {
    /** The whole read surface of every program (D29). Give `version` so services can be cached by it. */
    schema: MinabSchema;
    /**
     * Typed functions the host implements (D27), for example `fxRate`. A name needs a
     * lowercase letter. The implementation comes with each run (`RunPorts.hostFunctions`).
     * They run in the interpreter, never in SQL.
     */
    functions?: HostFunctionDeclaration[];
    /**
     * Typed read-only names the host gives to each run (D27), for example
     * `{ currentUser: { id: 'TEXT', roles: 'TEXT[]' }, url: 'JSON' }`. The values come with
     * each run (`RunInputs.hostInputs`).
     */
    inputs?: Record<string, HostInputType>;
    /** The default rule context of `prepare`. A call can give its own. */
    ruleContext?: MinabRuleContext;
    /**
     * Limits for source and runs (D36). Each one you leave out has its default. A host may raise or
     * lower each one. There is no "unlimited": give a large number instead.
     */
    limits?: Partial<Limits>;
    /** How many service sets to keep, least recently used out. Default 16. */
    serviceCacheSize?: number;
    /** `development` re-checks the grammar on every parser build and is slow. Default `production`. */
    mode?: 'development' | 'production';
}

/** Options for one `prepare` call. */
export interface PrepareOptions {
    /** Where the program sits: which table `.` means, and whether `$` exists. */
    ruleContext?: MinabRuleContext;
    /**
     * The type of the answer the host needs. A different type is `type.unexpectedResultType`.
     * Leave it out when the program may return anything (a formula field): nothing is
     * checked, and `resultType` still tells the host the type.
     */
    expect?: ExpectedType;
}

/** Given, never asked: the record under validation, `$`, and the values of the declared host inputs. */
export interface RunInputs {
    record?: Record<string, unknown>;
    fieldValue?: unknown;
    /** One value for each declared input. A missing one is the run error `eval.missingInput`. */
    hostInputs?: Record<string, unknown>;
}

/** Asked, never given: what the program needs from outside (ADR 0002, section 4). */
export interface RunPorts {
    /** Without it, a statement fails with `data.noPort`. */
    data?: DataPort;
    /** Needed to apply writes (`writes: 'apply'`). Without it, applying fails with `eval.writesNotSupported`. A dry run needs no port. */
    write?: WritePort;
    hostFunctions?: HostFunctions;
    /** Default: the system clock, in UTC. Read once for each run. */
    clock?: ClockPort;
    events?: EventSink;
}

/** Options for one `run` call. */
export interface RunOptions {
    /**
     * Aborts the run. The interpreter checks it between steps, and every port call gets it.
     * An aborted run ends with the error `cancelled`. A signal that is already aborted ends it
     * before any port is called.
     */
    signal?: AbortSignal;
    /** Limits for this run. Each one is the smaller of this value and the host's: a run never raises a limit. */
    limits?: Partial<Limits>;
    /**
     * What a program that writes does (D26). There is no default: a host must choose, and a program
     * that writes with no choice fails with `eval.writeModeMissing` before any port is called.
     * `dry-run`: reads run, writes are collected in `RunResult.writes` and not run.
     * `apply`: all writes of the run run in one transaction of `RunPorts.write`.
     * A program that does not write ignores it.
     */
    writes?: WriteMode;
}

export type WriteMode = 'dry-run' | 'apply';

/** One `INSERT`, `UPDATE` or `DELETE` of a run. */
export interface WriteStatement {
    sql: string;
    params: unknown[];
    range?: SourceRange;
    /** Rows the database changed. Only when the run applied the write. */
    rowCount?: number;
}

/** A run error or a compile error. A host maps it by `code`, never by `message`. */
export interface MinabError {
    /** A stable code from the registry, for example `eval.divisionByZero` or `limit.timeout`. */
    code: string;
    /** English text. It never holds SQL. */
    message: string;
    /** Where in the source, when known. */
    range?: SourceRange;
    /** The values the message was built from, for example `{ limit: 100 }`. A driver error gives `{ sqlstate }`. */
    params: Record<string, string | number>;
}

/** What a run used. */
export interface RunStats {
    /** Statements sent to the data port, writes included. */
    statements: number;
    /** Rows read, over all statements. */
    rows: number;
    /** Writes of the run (a run on this side of the wire always sets it). In a dry run `rows` is 0, because nothing ran. */
    writes?: { statements: number; rows: number };
    durationMs: number;
}

/** What `run` answers. It never throws for a failed program: look at `ok`. */
export type RunResult =
    | {
          ok: true;
          value: unknown;
          /** The lines of `LOG` (L7), in order: `label: value`, one line each. At most the `logEntries` limit. */
          logs: string[];
          /** `true` when more entries were logged than the limit allows. The extra ones were dropped. It is not an error. */
          logsTruncated?: boolean;
          /** The mode of the run, and its write statements in order. Empty when the program did not write. */
          writes?: { mode: WriteMode | null; statements: WriteStatement[] };
          stats: RunStats;
      }
    | { ok: false; error: MinabError };

/** What `compile` answers: the program as one SQL statement, or the reason it is not one. */
export type CompileResult = { ok: true; sql: SqlQuery } | { ok: false; error: MinabError };

/**
 * What a program touches, found before it runs (ADR 0002, section 7).
 * It is conservative: when unsure it says `needsData` and tier `data`.
 * Every list is sorted and has no duplicates.
 */
export interface ProgramAnalysis {
    /** Tables the program can read: `#T`, `FROM T`, joins, relation columns. */
    tables: string[];
    /** First steps of the paths read from the record under validation (`.a`, `.customer.name` gives `customer`). */
    recordFields: string[];
    /** `recordFields` plus the foreign key columns of the relations read. A change to one of these can change the result. */
    dependencies: string[];
    /** The program reads the whole record (`.` or `^` alone), so any field can matter. */
    readsWholeRecord: boolean;
    /** The program reads `$`. */
    readsFieldValue: boolean;
    /** Names the host must give: names that are not a local variable, parameter, alias or loop variable. */
    inputs: string[];
    /** Called names that are not built-ins and not declared in the program. */
    hostFunctions: string[];
    /** Functions declared in the program and called (also through other functions). */
    userFunctions: string[];
    /** Built-in functions called. */
    builtins: string[];
    /** The program can reach the data port. `false`: a run never calls it. */
    needsData: boolean;
    /** The program has INSERT, UPDATE or DELETE, or assigns to a record path. */
    writes: boolean;
    /** `local`: safe to run in the browser with no data. `data`: needs the server. */
    tier: 'local' | 'data';
}

/** A program that was parsed and checked once. It can run many times, also at the same time. */
export interface PreparedProgram {
    /** Syntax errors, type errors, warnings, and `expect` mismatches. Empty when the program is valid. */
    readonly diagnostics: readonly MinabDiagnostic[];
    /** `false` when any diagnostic is an error. `run` and `compile` then refuse. */
    readonly ok: boolean;
    readonly kind: ProgramKind;
    /** The type of the last expression, for example `BOOLEAN`, when it has one. */
    readonly resultType?: string;
    /** What the program touches, and where it can run. Found at prepare time. */
    readonly analysis: ProgramAnalysis;
    /** Does a change of this record field change the result? Use it to re-run only the rules a change affects. */
    dependsOn(field: string): boolean;
    /** The whole program as one SQL statement, or the reason it is not one. */
    compile(): CompileResult;
    /** Never throws for a failed program: the answer says `ok: false`. */
    run(inputs?: RunInputs, ports?: RunPorts, options?: RunOptions): Promise<RunResult>;
}

/** Numbers about the service cache. Useful in tests and in a health check. */
export interface CacheStats {
    /** Service sets in the cache now. */
    size: number;
    /** Service sets created since the start. */
    created: number;
    /** `prepare` calls that found their service set in the cache. */
    hits: number;
    /** Documents in the shared workspaces. Zero between `prepare` calls. */
    openDocuments: number;
}

/** The runtime a host holds. Make it once with `createMinab`. */
export interface Minab {
    /** Parses and checks. Resolves with diagnostics for a bad program. Rejects only for a bad call. */
    prepare(source: string, options?: PrepareOptions): Promise<PreparedProgram>;
    /** How full the service cache is, and how often it was hit. */
    cacheStats(): CacheStats;
    /** Frees the caches. A disposed runtime throws on use. */
    dispose(): void;
}
