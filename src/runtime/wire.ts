/**
 * Wire format v1 (ADR 0002, section 9; decisions D34, D17, D21, D36).
 *
 * One JSON contract for "run these programs with these inputs" and its answer.
 * The server (H2) and the browser client (H5) are both built against it.
 *
 * - `parseRequest` and `parseResponse` check the shape by hand and return a coded error.
 * - `encodeValue` and `decodeValue` turn a Minab value into JSON and back, by its type.
 *
 * No transport, no authentication here. Nothing here may touch Node or the DOM.
 * An error never holds the value that was wrong, only where it is (no data in logs).
 */

import { type DiagnosticCode, type ParamsArgs } from '../language/diagnostics/codes.js';
import type { LogicalTypeBase, ScalarType } from '../language/minab-types.js';
import { Big, decimalText } from '../language/values.js';
import { runError } from './errors.js';
import { DEFAULT_LIMITS, type Limits } from './limits.js';
import type { MinabError, RunStats } from './types.js';

/** The wire versions this code reads and writes. */
export const WIRE_VERSIONS: readonly number[] = [1];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A JSON value, as `JSON.parse` makes it. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A stored program, found by the host's program store (D34). */
export interface WireProgramRef {
    ref: { id: string; version: string };
}

/** Program text. A server accepts it only in development mode (D34). */
export interface WireProgramSource {
    source: string;
}

/** Options of one run in a wire request. */
export interface WireRunOptions {
    /** Limits for this run. They can only make the host's limits tighter. */
    limits?: Partial<Limits>;
    /** Ask for the log entries. The host decides whether it sends them (D37). */
    logs?: boolean;
}

/** One program to run. Values in `inputs`, `record` and `fieldValue` use the value encoding. */
export interface WireRun {
    /** Chosen by the client, echoed back. Unique in the request. */
    id: string;
    program: WireProgramRef | WireProgramSource;
    /** Values of the declared host inputs, by name. */
    inputs?: Record<string, Json>;
    /** The record under validation. */
    record?: Record<string, Json>;
    /** The value of `$`. */
    fieldValue?: Json;
    options?: WireRunOptions;
}

/** A wire format v1 request: a batch of runs of stored programs. */
export interface WireRequest {
    v: 1;
    runs: WireRun[];
}

/** The answer to one run of a request. Failed runs are normal answers: the request is still successful. */
export type WireResult =
    | { id: string; ok: true; value: Json; logs?: string[]; stats: RunStats }
    | { id: string; ok: false; error: MinabError; logs?: string[]; stats?: RunStats };

/** A wire format v1 response: one result for each run, in the same order. */
export interface WireResponse {
    v: 1;
    results: WireResult[];
}

/** The answer to a request that failed as a whole (bad version, bad shape, too many runs). */
export interface WireErrorResponse {
    v: 1;
    error: MinabError;
}

/** The result of a check of a request or a response: the value, or a coded error. */
export type WireParse<T> = { ok: true; value: T } | { ok: false; error: MinabError };

/**
 * The Minab type of a value, for `encodeValue` and `decodeValue`.
 * A scalar type is the checker's own `ScalarType` (`array: true` is a list of the base type).
 * A record is a query row or the record under validation. A list holds one item type.
 */
export type WireType = ScalarType | { kind: 'record'; fields: Record<string, WireType> } | { kind: 'list'; item: WireType };

/** The wire type of one scalar. Short way to write `{ kind: 'scalar', ... }`. */
export function wireScalar(base: LogicalTypeBase, options: { array?: boolean } = {}): ScalarType {
    return { kind: 'scalar', base, nullable: true, array: options.array ?? false, arrayNullable: true };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown by `encodeValue` and `decodeValue`. `error` is the coded form. */
export class WireError extends Error {
    constructor(readonly error: MinabError) {
        super(error.message);
        this.name = 'WireError';
    }
}

function fail<C extends DiagnosticCode>(code: C, ...args: ParamsArgs<C>): WireError {
    return new WireError(runError(code, undefined, ...args));
}

// ---------------------------------------------------------------------------
// Value encoding
// ---------------------------------------------------------------------------

const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_TEXT = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,6})?$/;
const DATETIME_TEXT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,3})?Z$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function validDate(year: number, month: number, day: number): boolean {
    const d = new Date(Date.UTC(year, month - 1, day));
    return year >= 1 && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function validDateText(text: string): boolean {
    const m = DATE_TEXT.exec(text);
    return m !== null && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** `2026-10-02T08:30:00Z` or with milliseconds. Gives the instant, or `undefined`. */
function parseInstant(text: string): Date | undefined {
    const m = DATETIME_TEXT.exec(text);
    if (!m || !validDate(Number(m[1]), Number(m[2]), Number(m[3]))) return undefined;
    return new Date(text);
}

function isJson(value: unknown): value is Json {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJson);
    if (isPlainObject(value)) return Object.values(value).every(isJson);
    return false;
}

function describeType(type: WireType): string {
    if (type.kind === 'record') return 'record';
    if (type.kind === 'list') return `list of ${describeType(type.item)}`;
    return type.array ? `${type.base}[]` : type.base;
}

function at(path: string, key: string | number): string {
    return typeof key === 'number' ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`;
}

function badValue(path: string, type: WireType): WireError {
    return fail('wire.invalidValue', { path: path === '' ? '(root)' : path, expected: describeType(type) });
}

/** One scalar (not an array) to JSON. `null` is always allowed. */
function encodeScalar(value: unknown, base: LogicalTypeBase, path: string, type: WireType): Json {
    if (value === null || value === undefined) return null;
    switch (base) {
        case 'TEXT':
        case 'CITEXT':
        case 'UUID':
            if (typeof value === 'string') return value;
            break;
        case 'INTEGER':
            if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
            break;
        case 'DECIMAL':
            if (value instanceof Big) return decimalText(value);
            if (typeof value === 'number' && Number.isFinite(value)) return decimalText(new Big(value));
            if (typeof value === 'string' && DECIMAL_TEXT.test(value)) return decimalText(new Big(value));
            break;
        case 'BOOLEAN':
            if (typeof value === 'boolean') return value;
            break;
        case 'DATE':
            if (typeof value === 'string' && validDateText(value)) return value;
            break;
        case 'TIME':
            if (typeof value === 'string' && TIME_TEXT.test(value)) return value;
            break;
        case 'DATETIME': {
            if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
            const instant = typeof value === 'string' ? parseInstant(value) : undefined;
            if (instant) return instant.toISOString();
            break;
        }
        case 'JSON':
            if (isJson(value)) return value;
            break;
    }
    throw badValue(path, type);
}

/** One scalar (not an array) from JSON. `null` is always allowed. */
function decodeScalar(json: unknown, base: LogicalTypeBase, path: string, type: WireType): unknown {
    if (json === null) return null;
    switch (base) {
        case 'TEXT':
        case 'CITEXT':
        case 'UUID':
            if (typeof json === 'string') return json;
            break;
        case 'INTEGER':
            if (typeof json === 'number' && Number.isSafeInteger(json)) return json;
            break;
        case 'DECIMAL':
            // A JSON number is refused on purpose: a client's number may already have lost digits.
            if (typeof json === 'string' && DECIMAL_TEXT.test(json)) return new Big(json);
            break;
        case 'BOOLEAN':
            if (typeof json === 'boolean') return json;
            break;
        case 'DATE':
            if (typeof json === 'string' && validDateText(json)) return json;
            break;
        case 'TIME':
            if (typeof json === 'string' && TIME_TEXT.test(json)) return json;
            break;
        case 'DATETIME': {
            const instant = typeof json === 'string' ? parseInstant(json) : undefined;
            if (instant) return instant;
            break;
        }
        case 'JSON':
            if (isJson(json)) return json;
            break;
    }
    throw badValue(path, type);
}

/**
 * A Minab value as JSON, by its type (decision D17, D21).
 * `DECIMAL` is a string in its shortest exact form ("24.9", never "24.90"). `INTEGER` is a number in the
 * safe range. `DATE` and `TIME` are text. `DATETIME` is an instant, always UTC with `Z`. `null` is `null`.
 * It throws a `WireError` (`wire.invalidValue`) for a value that does not fit its type.
 */
export function encodeValue(value: unknown, type: WireType): Json {
    return encode(value, type, '');
}

function encode(value: unknown, type: WireType, path: string): Json {
    if (value === null || value === undefined) return null;
    if (type.kind === 'list') {
        if (!Array.isArray(value)) throw badValue(path, type);
        return value.map((item, i) => encode(item, type.item, at(path, i)));
    }
    if (type.kind === 'record') {
        if (!isPlainObject(value)) throw badValue(path, type);
        const out: { [key: string]: Json } = {};
        for (const [key, item] of Object.entries(value)) {
            const fieldType = Object.hasOwn(type.fields, key) ? type.fields[key] : undefined;
            if (!fieldType) throw badValue(at(path, key), type);
            if (item !== undefined) out[key] = encode(item, fieldType, at(path, key));
        }
        return out;
    }
    if (type.array) {
        if (!Array.isArray(value)) throw badValue(path, type);
        return value.map((item, i) => encodeScalar(item, type.base, at(path, i), type));
    }
    return encodeScalar(value, type.base, path, type);
}

/**
 * The reverse of `encodeValue`: JSON to a Minab value. `DECIMAL` becomes a `Big`, `DATETIME` a `Date`,
 * and `DATE` and `TIME` stay text. It does not guess: `"24.90"` for an `INTEGER` is an error.
 * It throws a `WireError` (`wire.invalidValue`, with `params.path`).
 */
export function decodeValue(json: unknown, type: WireType): unknown {
    return decode(json, type, '');
}

function decode(json: unknown, type: WireType, path: string): unknown {
    if (json === null) return null;
    if (type.kind === 'list') {
        if (!Array.isArray(json)) throw badValue(path, type);
        return json.map((item, i) => decode(item, type.item, at(path, i)));
    }
    if (type.kind === 'record') {
        if (!isPlainObject(json)) throw badValue(path, type);
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(json)) {
            const fieldType = Object.hasOwn(type.fields, key) ? type.fields[key] : undefined;
            if (!fieldType) throw badValue(at(path, key), type);
            out[key] = decode(item, fieldType, at(path, key));
        }
        return out;
    }
    if (type.array) {
        if (!Array.isArray(json)) throw badValue(path, type);
        return json.map((item, i) => decodeScalar(item, type.base, at(path, i), type));
    }
    return decodeScalar(json, type.base, path, type);
}

// ---------------------------------------------------------------------------
// Shape checks
// ---------------------------------------------------------------------------

type Issue = { path: string; reason: string };

/** Thrown inside the parsers. Never leaves this file. */
class ShapeIssue extends Error {
    constructor(readonly issue: Issue) {
        super(issue.reason);
    }
}

function bad(path: string, reason: string): never {
    throw new ShapeIssue({ path: path === '' ? '(root)' : path, reason });
}

function object(value: unknown, path: string): Record<string, unknown> {
    if (!isPlainObject(value)) bad(path, 'must be an object');
    return value;
}

function text(value: unknown, path: string, options: { nonEmpty?: boolean } = {}): string {
    if (typeof value !== 'string') bad(path, 'must be a string');
    if (options.nonEmpty && value === '') bad(path, 'must not be empty');
    return value;
}

function flag(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') bad(path, 'must be true or false');
    return value;
}

function count(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) bad(path, 'must be a number, zero or more');
    return value;
}

function jsonValue(value: unknown, path: string): Json {
    if (!isJson(value)) bad(path, 'must be a JSON value');
    return value;
}

function jsonObject(value: unknown, path: string): Record<string, Json> {
    const obj = object(value, path);
    for (const [key, item] of Object.entries(obj)) jsonValue(item, at(path, key));
    return obj as Record<string, Json>;
}

const LIMIT_NAMES = Object.keys(DEFAULT_LIMITS);

function limits(value: unknown, path: string): Partial<Limits> {
    const obj = object(value, path);
    for (const [name, item] of Object.entries(obj)) {
        if (!LIMIT_NAMES.includes(name)) bad(at(path, name), `is not a limit (${LIMIT_NAMES.join(', ')})`);
        if (typeof item !== 'number' || Number.isNaN(item) || item <= 0) bad(at(path, name), 'must be a number above zero');
    }
    return obj as Partial<Limits>;
}

function runOptions(value: unknown, path: string): WireRunOptions {
    const obj = object(value, path);
    const out: WireRunOptions = {};
    if (obj.limits !== undefined) out.limits = limits(obj.limits, at(path, 'limits'));
    if (obj.logs !== undefined) out.logs = flag(obj.logs, at(path, 'logs'));
    return out;
}

function program(value: unknown, path: string, allowSource: boolean): WireProgramRef | WireProgramSource {
    const obj = object(value, path);
    if (obj.ref !== undefined && obj.source !== undefined) bad(path, 'must have "ref" or "source", not both');
    if (obj.ref !== undefined) {
        const ref = object(obj.ref, at(path, 'ref'));
        return {
            ref: {
                id: text(ref.id, at(at(path, 'ref'), 'id'), { nonEmpty: true }),
                version: text(ref.version, at(at(path, 'ref'), 'version'), { nonEmpty: true })
            }
        };
    }
    if (obj.source !== undefined) {
        if (!allowSource) bad(at(path, 'source'), 'is not accepted by this server: it runs stored programs only');
        return { source: text(obj.source, at(path, 'source')) };
    }
    bad(path, 'needs "ref" (a stored program) or "source"');
}

function run(value: unknown, path: string, allowSource: boolean): WireRun {
    const obj = object(value, path);
    const out: WireRun = {
        id: text(obj.id, at(path, 'id'), { nonEmpty: true }),
        program: program(obj.program, at(path, 'program'), allowSource)
    };
    if (obj.inputs !== undefined) out.inputs = jsonObject(obj.inputs, at(path, 'inputs'));
    if (obj.record !== undefined) out.record = jsonObject(obj.record, at(path, 'record'));
    if (obj.fieldValue !== undefined) out.fieldValue = jsonValue(obj.fieldValue, at(path, 'fieldValue'));
    if (obj.options !== undefined) out.options = runOptions(obj.options, at(path, 'options'));
    return out;
}

function versionError(obj: Record<string, unknown>): MinabError | undefined {
    if (obj.v === undefined || (typeof obj.v === 'number' && WIRE_VERSIONS.includes(obj.v))) return undefined;
    const shown = typeof obj.v === 'number' || typeof obj.v === 'string' || typeof obj.v === 'boolean' ? String(obj.v).slice(0, 20) : typeof obj.v;
    return runError('wire.unsupportedVersion', undefined, { version: shown, supported: WIRE_VERSIONS.join(', ') });
}

/** Options of `parseRequest`. */
export interface ParseRequestOptions {
    /** The most runs in one request. Default: `DEFAULT_LIMITS.batchRuns` (100, D36). */
    maxRuns?: number;
    /** Accept `program.source`. Only a server in development mode sets this (D34). Default `false`. */
    allowSource?: boolean;
}

/**
 * Checks the shape of a request (already parsed from JSON) and returns it, or a coded error:
 * `wire.unsupportedVersion`, `wire.tooManyRuns` or `wire.invalidRequest`.
 * Unknown fields are ignored (so a later v1 can add optional fields). A known field with a bad shape is refused.
 */
export function parseRequest(json: unknown, options: ParseRequestOptions = {}): WireParse<WireRequest> {
    const maxRuns = options.maxRuns ?? DEFAULT_LIMITS.batchRuns;
    try {
        const obj = object(json, '');
        const unsupported = versionError(obj);
        if (unsupported) return { ok: false, error: unsupported };
        if (obj.v === undefined) bad('v', 'is missing');
        if (!Array.isArray(obj.runs)) bad('runs', 'must be a list');
        if (obj.runs.length === 0) bad('runs', 'must have at least one run');
        if (obj.runs.length > maxRuns) return { ok: false, error: runError('wire.tooManyRuns', undefined, { limit: maxRuns, used: obj.runs.length }) };
        const seen = new Set<string>();
        const runs = obj.runs.map((item, i) => {
            const parsed = run(item, `runs[${i}]`, options.allowSource ?? false);
            if (seen.has(parsed.id)) bad(`runs[${i}].id`, 'is used by an earlier run: every id must be unique');
            seen.add(parsed.id);
            return parsed;
        });
        return { ok: true, value: { v: 1, runs } };
    } catch (error) {
        if (error instanceof ShapeIssue) return { ok: false, error: runError('wire.invalidRequest', undefined, error.issue) };
        throw error;
    }
}

// --- the response ---

function range(value: unknown, path: string): MinabError['range'] {
    const obj = object(value, path);
    const position = (v: unknown, p: string) => {
        const o = object(v, p);
        return { line: count(o.line, at(p, 'line')), character: count(o.character, at(p, 'character')) };
    };
    return { start: position(obj.start, at(path, 'start')), end: position(obj.end, at(path, 'end')) };
}

function errorBody(value: unknown, path: string): MinabError {
    const obj = object(value, path);
    const out: MinabError = { code: text(obj.code, at(path, 'code'), { nonEmpty: true }), message: text(obj.message, at(path, 'message')), params: {} };
    if (obj.range !== undefined && obj.range !== null) out.range = range(obj.range, at(path, 'range'));
    const params = object(obj.params, at(path, 'params'));
    for (const [key, item] of Object.entries(params)) {
        if (typeof item !== 'string' && typeof item !== 'number') bad(at(at(path, 'params'), key), 'must be a string or a number');
        out.params[key] = item;
    }
    return out;
}

function stats(value: unknown, path: string): RunStats {
    const obj = object(value, path);
    return {
        ...(obj as object),
        statements: count(obj.statements, at(path, 'statements')),
        rows: count(obj.rows, at(path, 'rows')),
        durationMs: count(obj.durationMs, at(path, 'durationMs'))
    };
}

function logs(value: unknown, path: string): string[] {
    if (!Array.isArray(value)) bad(path, 'must be a list');
    return value.map((item, i) => text(item, at(path, i)));
}

function result(value: unknown, path: string): WireResult {
    const obj = object(value, path);
    const id = text(obj.id, at(path, 'id'), { nonEmpty: true });
    const extra: { logs?: string[] } = obj.logs === undefined ? {} : { logs: logs(obj.logs, at(path, 'logs')) };
    if (obj.ok === true) {
        if (!('value' in obj)) bad(at(path, 'value'), 'is missing');
        return { id, ok: true, value: jsonValue(obj.value, at(path, 'value')), ...extra, stats: stats(obj.stats, at(path, 'stats')) };
    }
    if (obj.ok === false) {
        return {
            id,
            ok: false,
            error: errorBody(obj.error, at(path, 'error')),
            ...extra,
            ...(obj.stats === undefined ? {} : { stats: stats(obj.stats, at(path, 'stats')) })
        };
    }
    return bad(at(path, 'ok'), 'must be true or false');
}

/**
 * Checks the shape of a response (already parsed from JSON). It gives the results, or the error body of a
 * request that failed as a whole. A bad shape is `wire.invalidResponse`; an unknown `v` is `wire.unsupportedVersion`.
 * Unknown fields are ignored: a client must not break when the server adds one.
 */
export function parseResponse(json: unknown): WireParse<WireResponse | WireErrorResponse> {
    try {
        const obj = object(json, '');
        const unsupported = versionError(obj);
        if (unsupported) return { ok: false, error: unsupported };
        if (obj.v === undefined) bad('v', 'is missing');
        if (obj.error !== undefined) return { ok: true, value: { v: 1, error: errorBody(obj.error, 'error') } };
        if (!Array.isArray(obj.results)) bad('results', 'must be a list');
        return { ok: true, value: { v: 1, results: obj.results.map((item, i) => result(item, `results[${i}]`)) } };
    } catch (error) {
        if (error instanceof ShapeIssue) return { ok: false, error: runError('wire.invalidResponse', undefined, error.issue) };
        throw error;
    }
}

/** The request-level error body for a coded error, ready to send with `JSON.stringify`. */
export function wireErrorResponse(error: MinabError): WireErrorResponse {
    return { v: 1, error };
}
