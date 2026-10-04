/**
 * The options and types of the NestJS integration (phase H2, ADR 0002 sections 4.6 and 8.2).
 */

import type { CanActivate } from '@nestjs/common';
import type { HostFunctionDeclaration, HostInputType } from '../language/host-declarations.js';
import type { MinabRuleContext, MinabSchema } from '../language/schema.js';
import type { Limits } from '../runtime/limits.js';
import type { ExpectedType, RunPorts } from '../runtime/types.js';

/** What the host knows about one request. The module gives it to the loaders. The fields are the host's. */
export interface MinabContext {
    /** Tags the logs of the run. The run endpoint takes it from the `x-request-id` header, or makes one. */
    requestId?: string;
    /** The framework request, when there is one (the run endpoint gives it). */
    request?: unknown;
    [key: string]: unknown;
}

/** A schema with the version that caches use. Two schemas with the same version must be the same schema. */
export type VersionedSchema = MinabSchema & { version: string };

/** A program the host keeps (D34). */
export interface StoredProgram {
    id: string;
    version: string;
    source: string;
    languageVersion: string;
    ruleContext?: MinabRuleContext;
    expect?: ExpectedType;
}

/** The host's store of programs. Find one by id and version. `undefined` means it does not exist. */
export interface ProgramStore {
    /** Finds a stored program, or `undefined` when there is none. A program with an id and a version must never change its source. */
    get(id: string, version: string, context: { signal: AbortSignal }): Promise<StoredProgram | undefined>;
}

/** How the run logs are written. */
export interface MinabLogOptions {
    /** Write `log` events. Default: on, except when `NODE_ENV` is `production` (D37). */
    enabled?: boolean;
    /** Also write one line for each statement, at debug level. The SQL text is written, the parameter values are not. Default: off. */
    statements?: boolean;
    /** The most entries for one run. Default: the `logEntries` limit (100, D36). */
    maxEntries?: number;
}

/** Settings of the run endpoint. The server decides the ports, the host inputs and the guards. The client decides none of them. */
export interface MinabEndpointOptions {
    /** The route of `POST`. Default `minab/run`. */
    path?: string;
    /**
     * Accept `program.source` (program text from the client). For development only (D34).
     * Default `false`: the endpoint runs stored programs only.
     */
    allowSource?: boolean;
    /** The ports of a request: the data port (usually the request's transaction), host functions, the clock. Never from the client. */
    ports?(context: MinabContext): RunPorts | Promise<RunPorts>;
    /** Host inputs from the server's own session (for example `currentUser`). They replace any value of the same name from the client. */
    hostInputs?(context: MinabContext): Record<string, unknown> | Promise<Record<string, unknown>>;
    /** Guards of the route. Without one, anyone who can reach the route can run stored programs: use the app's guards. */
    guards?: (CanActivate | (new (...args: never[]) => CanActivate))[];
}

/** What a host gives to `MinabModule`. */
export interface MinabModuleOptions {
    /** The schema for one request (per tenant or application). It is called for each request. Its result is cached by `version`. */
    schemaLoader(context: MinabContext): VersionedSchema | Promise<VersionedSchema>;
    functions?: HostFunctionDeclaration[];
    inputs?: Record<string, HostInputType>;
    limits?: Partial<Limits>;
    /** The rule context of programs that have none of their own. */
    ruleContext?: MinabRuleContext;
    mode?: 'development' | 'production';
    /** Needed by `runStored` and the run endpoint. */
    programStore?: ProgramStore;
    /** `false` turns logging off. Default: see `MinabLogOptions.enabled`. */
    logs?: boolean | MinabLogOptions;
    /** Mounts the run endpoint. Without it there is no route. */
    endpoint?: MinabEndpointOptions;
    /** Prepared programs kept, least recently used out. Default 500. */
    programCacheSize?: number;
    /** Runtimes kept (one for each schema version). Default 16. */
    runtimeCacheSize?: number;
}

/** The token the options go under. */
export const MINAB_OPTIONS = Symbol('MINAB_OPTIONS');
