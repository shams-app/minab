/**
 * The public types of the runtime API (ADR 0002, section 3).
 *
 * R2 builds the driving side: `createMinab`, `prepare`, `run`. Today `run`
 * takes the existing `QueryExecutor` as its data port and returns the
 * interpreter's answer. R3 replaces `RunPorts` and `RunResult` with the full
 * set (write, clock, host functions, events, stats).
 */

import type { MinabRuleContext, MinabSchema } from '../language/schema.js';
import type { QueryExecutor, SqlQuery } from '../language/minab-executor.js';
import type { ProgramKind } from './program-kind.js';

export type { ProgramKind } from './program-kind.js';

/** 0-based line and character, like the language server protocol. */
export interface SourceRange {
    start: { line: number; character: number };
    end: { line: number; character: number };
}

export type MinabSeverity = 'error' | 'warning' | 'info' | 'hint';

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

export interface MinabOptions {
    /** The whole read surface of every program (D29). Give `version` so services can be cached by it. */
    schema: MinabSchema;
    /** The default rule context of `prepare`. A call can give its own. */
    ruleContext?: MinabRuleContext;
    /** Limits for runs. Stored now, enforced by R4. */
    limits?: Readonly<Record<string, number>>;
    /**
     * Host functions that run in the browser and need no data. A program that calls any
     * other host function is tier `data`. R3 replaces this with the host function declarations.
     */
    localHostFunctions?: readonly string[];
    /** How many service sets to keep, least recently used out. Default 16. */
    serviceCacheSize?: number;
    /** `development` re-checks the grammar on every parser build and is slow. Default `production`. */
    mode?: 'development' | 'production';
}

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

/** Given, never asked: the record under validation and `$`. */
export interface RunInputs {
    record?: Record<string, unknown>;
    fieldValue?: unknown;
}

/** Today a data port is a `QueryExecutor`. R3 widens this. */
export interface RunPorts {
    data?: QueryExecutor;
}

export interface RunOptions {
    /** Reserved. R4 makes it stop a run. */
    signal?: AbortSignal;
}

export interface MinabError {
    /** A stable code, for example `eval.failed` or `data.noPort`. */
    code: string;
    /** English text. */
    message: string;
    params: Record<string, string | number>;
}

export type RunResult = { ok: true; value: unknown } | { ok: false; error: MinabError };

export type CompileResult = { ok: true; query: SqlQuery } | { ok: false; error: MinabError };

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

export interface Minab {
    /** Parses and checks. Resolves with diagnostics for a bad program. Rejects only for a bad call. */
    prepare(source: string, options?: PrepareOptions): Promise<PreparedProgram>;
    cacheStats(): CacheStats;
    /** Frees the caches. A disposed runtime throws on use. */
    dispose(): void;
}
