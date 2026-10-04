/**
 * `MinabService`: prepare and run programs with the request's ports (phase H2, ADR 0002 section 8.2).
 *
 * - The schema comes from `schemaLoader(context)`, for each request. One runtime is kept for each schema
 *   version, so two tenants with different schemas get different runtimes.
 * - `runStored` finds the program in the `ProgramStore` and keeps the prepared program by
 *   schema version, id and version (D34). A program with an id and a version never changes.
 * - Every run gets a `MinabLogger` (off in production, D37).
 */

import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createMinab } from '../runtime/minab.js';
import type { EventSink } from '../runtime/ports.js';
import type { MinabRuleContext } from '../language/schema.js';
import type { Minab, PrepareOptions, PreparedProgram, RunInputs, RunOptions, RunPorts, RunResult } from '../runtime/types.js';
import { MinabException } from './exception.js';
import { MinabLogger } from './logger.js';
import { MINAB_OPTIONS, type MinabContext, type MinabModuleOptions, type StoredProgram, type VersionedSchema } from './options.js';

/** A prepared program, with what the caller needs to decode inputs and encode the answer. */
export interface LoadedProgram {
    prepared: PreparedProgram;
    schema: VersionedSchema;
    ruleContext: MinabRuleContext;
    /** Set when the program came from the store. */
    stored?: StoredProgram;
}

/** Options of `MinabService.run`: the run options, and tags for the log lines. */
export interface MinabRunOptions extends RunOptions {
    /** Tags the log lines. */
    programId?: string;
    requestId?: string;
}

/** Options for loading a program: the request context (for the schema loader) and an abort signal. */
export interface MinabLoadOptions {
    context?: MinabContext;
    signal?: AbortSignal;
}

interface RuntimeEntry {
    minab: Minab;
    schema: VersionedSchema;
}

/** A least-recently-used map of promises. A failed promise is removed, so a failure is not cached. */
class LruCache<V> {
    private readonly map = new Map<string, Promise<V>>();
    constructor(private readonly size: number) {}

    get(key: string): Promise<V> | undefined {
        const found = this.map.get(key);
        if (found) {
            this.map.delete(key);
            this.map.set(key, found);
        }
        return found;
    }

    set(key: string, value: Promise<V>): void {
        this.map.set(key, value);
        value.catch(() => {
            if (this.map.get(key) === value) this.map.delete(key);
        });
        while (this.map.size > this.size) this.map.delete(this.map.keys().next().value as string);
    }

    async values(): Promise<V[]> {
        return (await Promise.allSettled([...this.map.values()])).flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
    }

    clear(): void {
        this.map.clear();
    }
}

function both(a: EventSink, b: EventSink): EventSink {
    return {
        emit(event) {
            for (const sink of [a, b]) {
                try {
                    sink.emit(event);
                } catch {
                    // A sink must not throw. A throw is dropped, like the runtime does.
                }
            }
        }
    };
}

/** Prepares and runs programs inside a NestJS app. It keeps one runtime for each schema version, and one prepared program for each stored program version. */
@Injectable()
export class MinabService implements OnModuleDestroy {
    private readonly runtimes: LruCache<RuntimeEntry>;
    private readonly programs: LruCache<LoadedProgram>;

    constructor(@Inject(MINAB_OPTIONS) private readonly options: MinabModuleOptions) {
        this.runtimes = new LruCache(options.runtimeCacheSize ?? 16);
        this.programs = new LruCache(options.programCacheSize ?? 500);
    }

    /** The runtime for the schema of this request. The loader runs every time. The runtime is cached by schema version. */
    private async runtimeFor(context: MinabContext): Promise<RuntimeEntry> {
        const schema = await this.options.schemaLoader(context);
        if (typeof schema?.version !== 'string' || schema.version === '') {
            throw new TypeError('MinabModule: schemaLoader must return a schema with a non-empty "version"');
        }
        const cached = this.runtimes.get(schema.version);
        if (cached) return cached;
        const created = Promise.resolve({
            schema,
            minab: createMinab({
                schema,
                functions: this.options.functions,
                inputs: this.options.inputs,
                ruleContext: this.options.ruleContext,
                limits: this.options.limits,
                mode: this.options.mode
            })
        });
        this.runtimes.set(schema.version, created);
        return created;
    }

    /** The limits the host set (the defaults where it set none). */
    get hostLimits(): Partial<NonNullable<MinabModuleOptions['limits']>> {
        return this.options.limits ?? {};
    }

    /** Prepares program text with the schema of this request. It does not throw for a bad program: read `prepared.diagnostics`. */
    async loadSource(source: string, options: PrepareOptions & MinabLoadOptions = {}): Promise<LoadedProgram> {
        const { context = {}, ...prepareOptions } = options;
        const runtime = await this.runtimeFor(context);
        const prepared = await runtime.minab.prepare(source, prepareOptions);
        const ruleContext = prepareOptions.ruleContext ?? this.options.ruleContext ?? { isFieldRule: false };
        return { prepared, schema: runtime.schema, ruleContext };
    }

    /** Parses and checks a program. It does not throw for a bad program: read `diagnostics`. */
    async prepare(source: string, options: PrepareOptions & MinabLoadOptions = {}): Promise<PreparedProgram> {
        return (await this.loadSource(source, options)).prepared;
    }

    /**
     * Finds a stored program and prepares it, or takes it from the cache.
     * It throws a `MinabException`: `wire.programNotFound` when the store has none, `eval.programInvalid` when the program has errors.
     */
    async loadStored(id: string, version: string, options: MinabLoadOptions = {}): Promise<LoadedProgram> {
        const store = this.options.programStore;
        if (!store) throw new TypeError('MinabModule: this call needs a programStore');
        const context = options.context ?? {};
        const runtime = await this.runtimeFor(context);
        const key = JSON.stringify([runtime.schema.version, id, version]);
        let loaded = this.programs.get(key);
        if (!loaded) {
            loaded = (async (): Promise<LoadedProgram> => {
                const stored = await store.get(id, version, { signal: options.signal ?? new AbortController().signal });
                if (!stored) throw MinabException.programNotFound(id, version);
                const prepared = await runtime.minab.prepare(stored.source, { ruleContext: stored.ruleContext, expect: stored.expect });
                const ruleContext = stored.ruleContext ?? this.options.ruleContext ?? { isFieldRule: false };
                return { prepared, schema: runtime.schema, ruleContext, stored };
            })();
            this.programs.set(key, loaded);
        }
        const found = await loaded;
        if (!found.prepared.ok) throw MinabException.invalidProgram(found.prepared.diagnostics);
        return found;
    }

    /** Runs a prepared program. It never throws for a failed program: read `ok`. */
    async run(prepared: PreparedProgram, inputs: RunInputs = {}, ports: RunPorts = {}, options: MinabRunOptions = {}): Promise<RunResult> {
        const { programId, requestId, ...runOptions } = options;
        const logger = new MinabLogger(this.options.logs, { programId, requestId });
        const events = !logger.isEnabled ? ports.events : ports.events ? both(ports.events, logger) : logger;
        try {
            return await prepared.run(inputs, { ...ports, events }, runOptions);
        } finally {
            logger.finish();
        }
    }

    /** Finds a stored program (see `loadStored`) and runs it. */
    async runStored(
        programId: string,
        version: string,
        inputs: RunInputs = {},
        ports: RunPorts = {},
        options: MinabRunOptions & MinabLoadOptions = {}
    ): Promise<RunResult> {
        const { context, ...runOptions } = options;
        const loaded = await this.loadStored(programId, version, { context, signal: options.signal });
        return this.run(loaded.prepared, inputs, ports, { programId, requestId: context?.requestId, ...runOptions });
    }

    /** Frees the runtimes when the Nest app closes. */
    async onModuleDestroy(): Promise<void> {
        for (const entry of await this.runtimes.values()) entry.minab.dispose();
        this.runtimes.clear();
        this.programs.clear();
    }
}
