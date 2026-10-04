/**
 * The bridge protocol between the main thread and the Minab worker (phase H4).
 *
 * Both sides import this file and nothing else of each other. Every message
 * is plain data that `postMessage` can clone, and every message has `v`.
 *
 * - The main thread sends requests with an `id` (`create`, `prepare`, `compile`, `run`, `editor`, `request`, `dispose`),
 *   `cancel`, `release` and the answers to port calls (`port-result`).
 * - The worker answers each request with `result` and the same `id`. While a run is going, it can
 *   call back to a port on the main thread (`port-call`) and wait for the `port-result`.
 * - An error always crosses as `{ code, message, range?, params }`, never as an `Error` object.
 * - A value crosses with the encoding of `src/runtime/wire.ts`: a decimal is a string, a date is a string.
 *   Where the type is not known (rows from a data port, a list of records), `encodeLoose` is used: it
 *   turns `Big` and `Date` into strings and checks that the rest is JSON.
 *
 * Nothing here may touch Node or the DOM.
 */

import { parseTypeWord, type HostFunctionDeclaration, type HostInputType } from '../language/host-declarations.js';
import type { CompletionResult, HoverResult, SignatureHelpResult } from '../editor/types.js';
import type { MinabRuleContext, MinabSchema } from '../language/schema.js';
import { Big, decimalText } from '../language/values.js';
import { runError } from '../runtime/errors.js';
import type { Limits } from '../runtime/limits.js';
import type { ExpectedType, MinabDiagnostic, MinabError, ProgramAnalysis, ProgramKind, RunStats } from '../runtime/types.js';
import { decodeValue, encodeValue, WireError, type Json, type WireType } from '../runtime/wire.js';

/** The bridge versions this code reads and writes. */
export const BRIDGE_VERSION = 1;

/** The ports a program can call. `events` calls are one way: the main thread does not answer them. */
export type PortName = 'data' | 'functions' | 'clock' | 'events';

/** What the worker needs to build its runtime. Plain data. */
export interface WorkerRuntimeOptions {
    schema: MinabSchema;
    functions?: HostFunctionDeclaration[];
    inputs?: Record<string, HostInputType>;
    ruleContext?: MinabRuleContext;
    limits?: Partial<Limits>;
    serviceCacheSize?: number;
    mode?: 'development' | 'production';
}

/** Run inputs after encoding. */
export interface WireInputs {
    record?: Record<string, Json>;
    fieldValue?: Json;
    hostInputs?: Record<string, Json>;
}

/** The editor questions a worker answers. Each is computed by `src/editor/`. */
export type EditorMethod = 'complete' | 'hover' | 'signatureHelp';

/** The answer type of each editor method. `undefined` crosses as `null`. */
export interface EditorAnswers {
    complete: CompletionResult;
    hover: HoverResult | null;
    signatureHelp: SignatureHelpResult | null;
}

// ---- main thread to worker -----------------------------------------------

export type ToWorker =
    | { v: 1; type: 'create'; id: string; options: WorkerRuntimeOptions }
    | { v: 1; type: 'prepare'; id: string; programId: string; source: string; options?: { ruleContext?: MinabRuleContext; expect?: ExpectedType } }
    | { v: 1; type: 'compile'; id: string; programId: string }
    /** `ports` names the ports the main thread can answer. */
    | { v: 1; type: 'run'; id: string; programId: string; inputs: WireInputs; ports: PortName[]; limits?: Partial<Limits> }
    | { v: 1; type: 'dispose'; id: string }
    /** Editor services (phase E5). They read the text: no program is kept. `offset` is a UTF-16 offset into `source`. */
    | { v: 1; type: 'editor'; id: string; method: EditorMethod; source: string; offset: number; ruleContext?: MinabRuleContext }
    /** A request to a handler the host app put in `serveMinab` (`requests`). `cancel` with the same `id` aborts it. */
    | { v: 1; type: 'request'; id: string; name: string; payload?: unknown }
    /** Aborts the run (or request) with this id and its pending port calls. */
    | { v: 1; type: 'cancel'; id: string }
    /** Frees a prepared program in the worker. */
    | { v: 1; type: 'release'; programId: string }
    | { v: 1; type: 'port-result'; callId: string; ok: true; value: Json }
    | { v: 1; type: 'port-result'; callId: string; ok: false; error: MinabError };

// ---- worker to main thread -----------------------------------------------

export type FromWorker =
    | { v: 1; type: 'result'; id: string; ok: true; value: unknown }
    | { v: 1; type: 'result'; id: string; ok: false; error: MinabError }
    /** Asks the main thread to call a port. `runId` is the `id` of the run that needs it. */
    | { v: 1; type: 'port-call'; callId: string; runId: string; port: PortName; method: string; args: Json[] }
    /** The worker stopped waiting for this call (cancel or timeout). The main thread aborts the port's signal. */
    | { v: 1; type: 'cancel-call'; callId: string }
    /** An event the host app's worker code sent with `emit` (see `serveMinab`). */
    | { v: 1; type: 'event'; name: string; payload: unknown };

/** What `prepare` answers, besides the program id kept on both sides. */
export interface PreparedInfo {
    diagnostics: MinabDiagnostic[];
    ok: boolean;
    kind: ProgramKind;
    resultType?: string;
    analysis: ProgramAnalysis;
}

/** What a finished run answers. `value` is encoded. */
export interface RunAnswer {
    value: Json;
    logs: string[];
    stats: RunStats;
}

/** The message ends of both sides. A `Worker`, a `MessagePort` and a worker's `self` all fit. */
export interface BridgeEndpoint {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    /** A `MessagePort` needs it. */
    start?(): void;
    /** A `Worker` has it. */
    terminate?(): void;
}

// ---- errors --------------------------------------------------------------

/** A failure of the bridge itself, for example a worker that stopped. */
export function bridgeError(reason: string): MinabError {
    return runError('wire.workerFailed', undefined, { reason });
}

/** Any thrown value as a coded error. Only the message of an `Error` is used. */
export function toMinabError(error: unknown): MinabError {
    if (error instanceof WireError) return error.error;
    return bridgeError(error instanceof Error ? error.message : 'unknown failure');
}

/** `true` for a message that is an object with the bridge version and a type. */
export function isBridgeMessage(data: unknown): data is { v: 1; type: string } {
    return typeof data === 'object' && data !== null && (data as { v?: unknown }).v === BRIDGE_VERSION && typeof (data as { type?: unknown }).type === 'string';
}

// ---- values ---------------------------------------------------------------

function badValue(path: string): WireError {
    return new WireError(runError('wire.invalidValue', undefined, { path: path === '' ? '(root)' : path, expected: 'JSON value' }));
}

/**
 * A value of unknown type as JSON: `Big` becomes its decimal text, `Date` its ISO text, a bigint its digits.
 * It never guesses back: the other side gets a string.
 */
export function encodeLoose(value: unknown, path = ''): Json {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw badValue(path);
        return value;
    }
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Big) return decimalText(value);
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw badValue(path);
        return value.toISOString();
    }
    if (Array.isArray(value)) return value.map((item, i) => encodeLoose(item, `${path}[${i}]`));
    if (typeof value === 'object') {
        const out: { [key: string]: Json } = {};
        for (const [key, item] of Object.entries(value)) {
            if (item !== undefined) out[key] = encodeLoose(item, path === '' ? key : `${path}.${key}`);
        }
        return out;
    }
    throw badValue(path);
}

/** The wire type of a host input declaration: a type word, or a record of type words. */
export function hostInputWireType(declaration: HostInputType): WireType | undefined {
    if (typeof declaration === 'string') return parseTypeWord(declaration);
    const fields: Record<string, WireType> = {};
    for (const [name, word] of Object.entries(declaration)) {
        const type = parseTypeWord(word);
        if (!type) return undefined;
        fields[name] = type;
    }
    return { kind: 'record', fields };
}

/** The scalar columns of a table, as wire types. A relation column has no entry. */
export function recordFieldTypes(schema: MinabSchema, table: string | undefined): Record<string, WireType> {
    const fields: Record<string, WireType> = {};
    const found = schema.tables.find(t => t.name === table);
    for (const column of found?.columns ?? []) if (column.type.kind === 'scalar') fields[column.name] = column.type.type;
    return fields;
}

/** Encodes one value by its type when the type is known, loosely when it is not. */
export function encodeBy(value: unknown, type: WireType | undefined): Json {
    return type ? encodeValue(value, type) : encodeLoose(value);
}

export function decodeBy(json: unknown, type: WireType | undefined): unknown {
    return type ? decodeValue(json, type) : json;
}

/** The fields of a record: a field with a known type is encoded by it, the others loosely. */
export function encodeFields(record: Record<string, unknown>, types: Record<string, WireType>): Record<string, Json> {
    const out: Record<string, Json> = {};
    for (const [key, item] of Object.entries(record)) {
        if (item !== undefined) out[key] = encodeBy(item, Object.hasOwn(types, key) ? types[key] : undefined);
    }
    return out;
}

export function decodeFields(record: Record<string, Json>, types: Record<string, WireType>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decodeBy(item, Object.hasOwn(types, key) ? types[key] : undefined);
    return out;
}

/** What both sides know about the types of a run's inputs. */
export interface InputTypes {
    schema: MinabSchema;
    inputs?: Record<string, HostInputType>;
    ruleContext: MinabRuleContext;
}

export function encodeInputs(
    inputs: { record?: Record<string, unknown>; fieldValue?: unknown; hostInputs?: Record<string, unknown> },
    types: InputTypes
): WireInputs {
    const out: WireInputs = {};
    if (inputs.record !== undefined) out.record = encodeFields(inputs.record, recordFieldTypes(types.schema, types.ruleContext.recordTable));
    if (inputs.fieldValue !== undefined) out.fieldValue = encodeBy(inputs.fieldValue, types.ruleContext.fieldType);
    if (inputs.hostInputs !== undefined) {
        const declared: Record<string, WireType> = {};
        for (const [name, declaration] of Object.entries(types.inputs ?? {})) {
            const type = hostInputWireType(declaration);
            if (type) declared[name] = type;
        }
        out.hostInputs = encodeFields(inputs.hostInputs, declared);
    }
    return out;
}

export function decodeInputs(
    wire: WireInputs,
    types: InputTypes
): { record?: Record<string, unknown>; fieldValue?: unknown; hostInputs?: Record<string, unknown> } {
    const out: ReturnType<typeof decodeInputs> = {};
    if (wire.record !== undefined) out.record = decodeFields(wire.record, recordFieldTypes(types.schema, types.ruleContext.recordTable));
    if (wire.fieldValue !== undefined) out.fieldValue = decodeBy(wire.fieldValue, types.ruleContext.fieldType);
    if (wire.hostInputs !== undefined) {
        const declared: Record<string, WireType> = {};
        for (const [name, declaration] of Object.entries(types.inputs ?? {})) {
            const type = hostInputWireType(declaration);
            if (type) declared[name] = type;
        }
        out.hostInputs = decodeFields(wire.hostInputs, declared);
    }
    return out;
}

/** The wire type of a run's answer, from the `resultType` word. A list or a record has none: it crosses loosely. */
export function resultWireType(resultType: string | undefined): WireType | undefined {
    return resultType === undefined ? undefined : parseTypeWord(resultType);
}
