/**
 * The messages between the page and the Minab worker (production plan H4).
 *
 * The bridge works both ways. The page sends requests (`create`, `prepare`,
 * `run`, `cancel`, `dispose`). While a run is going, the worker can ask the
 * page to call one of the app's ports (`port-call`) and waits for the answer
 * (`port-result`).
 *
 * Rules:
 * - Every message has `v` (the bridge version). A message with another
 *   version is refused with `wire.badMessage`.
 * - Every request has an `id`. Its answer carries the same `id`.
 * - Errors cross as `{ code, message, range?, params }`, never as `Error` objects.
 * - Values cross with `toWire` and `fromWire` (below). A port call has no
 *   type information, so these two functions tag what plain JSON cannot hold:
 *   decimals travel as text, dates as ISO text (the same text as wire format v1).
 *
 * This file has no import of Node or the DOM. It must stay that way: the
 * runtime import guard checks the browser entries.
 */

import { Big, decimalText } from '../language/values.js';
import { runError } from '../runtime/errors.js';
import type { Limits } from '../runtime/limits.js';
import { WireError } from '../runtime/wire.js';
import type { CompileResult, MinabError, MinabOptions, PrepareOptions, ProgramAnalysis, ProgramKind, MinabDiagnostic } from '../runtime/types.js';

/** The version of the messages in this file. */
export const BRIDGE_VERSION = 1;

/** The ports the worker can ask the page to call. */
export type PortName = 'data' | 'functions' | 'clock' | 'events';

export const PORT_NAMES: readonly PortName[] = ['data', 'functions', 'clock', 'events'];

/** What `create` needs. All of it is plain data, so it survives `postMessage`. */
export type CreateOptions = Pick<MinabOptions, 'schema' | 'functions' | 'inputs' | 'ruleContext' | 'limits' | 'serviceCacheSize' | 'mode'>;

/** A value that went through `toWire`. It is safe for `postMessage` and for JSON. */
export type Crossing = unknown;

// ---- page to worker ------------------------------------------------------

export type BridgeRequest =
    | { v: 1; type: 'create'; id: number; options: CreateOptions }
    | { v: 1; type: 'prepare'; id: number; source: string; options?: PrepareOptions }
    | {
          v: 1;
          type: 'run';
          id: number;
          /** The number the worker gave in the answer to `prepare`. */
          program: number;
          inputs: Crossing;
          /** The ports the page has for this run. The worker may have its own for the others. */
          ports: PortName[];
          limits?: Partial<Limits>;
      }
    | { v: 1; type: 'dispose'; id: number }
    /** Stop the request with this id: abort the run and its pending port calls. */
    | { v: 1; type: 'cancel'; id: number }
    | { v: 1; type: 'port-result'; callId: number; ok: true; value: Crossing }
    | {
          v: 1;
          type: 'port-result';
          callId: number;
          ok: false;
          error: MinabError;
          /**
           * `true`: the port threw something that is not a `PortError`. The worker throws a plain error
           * with the SQLSTATE (if any), so the runtime maps it like the failure of a local port.
           */
          raw?: boolean;
      };

// ---- worker to page ------------------------------------------------------

export type BridgeResponse =
    | { v: 1; type: 'response'; id: number; ok: true; value: Crossing }
    | { v: 1; type: 'response'; id: number; ok: false; error: MinabError }
    | {
          v: 1;
          type: 'port-call';
          callId: number;
          /** The id of the `run` request this call belongs to. */
          runId: number;
          port: PortName;
          method: string;
          args: Crossing[];
          /** `true`: nobody waits for an answer (the events port). */
          oneWay?: boolean;
      }
    /** The worker stopped waiting for this call (the run ended or was aborted). The page aborts the port call. */
    | { v: 1; type: 'port-cancel'; callId: number };

/** What the worker answers to `prepare`. */
export interface PreparedSnapshot {
    program: number;
    diagnostics: MinabDiagnostic[];
    kind: ProgramKind;
    resultType?: string;
    analysis: ProgramAnalysis;
    /** Found in the worker at prepare time, so `compile()` stays a plain call on the page. */
    compile: Crossing;
}

/** The methods the page lets the worker call on each port. Anything else is `wire.badMessage`. */
export const PORT_METHODS: Readonly<Record<PortName, readonly string[]>> = {
    data: ['execute'],
    functions: ['call'],
    clock: ['now', 'timeZone'],
    events: ['emit']
};

// ---- messages the two sides share ---------------------------------------

/** The smallest part of a `Worker` or a `MessagePort` the bridge needs. */
export interface Endpoint {
    postMessage(message: unknown): void;
    onmessage: ((event: { data: unknown }) => void) | null;
}

export function isMessage(value: unknown): value is { v: number; type: string } {
    return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function badMessage(reason: string): MinabError {
    return runError('wire.badMessage', undefined, { reason });
}

export function compileSnapshot(result: CompileResult): Crossing {
    return result.ok ? { ok: true, sql: { text: result.sql.text, params: toWire(result.sql.params) } } : { ok: false, error: result.error };
}

// ---- values --------------------------------------------------------------

const TAG = '$minab';

function invalid(path: string, expected: string): WireError {
    return new WireError(runError('wire.invalidValue', undefined, { path: path === '' ? '(root)' : path, expected }));
}

/** Sets an own property. A key such as `__proto__` stays plain data and never changes the prototype. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function isPlain(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * A Minab value for `postMessage`. A `Big` becomes `{ $minab: 'decimal', v: '24.9' }`, a `Date` becomes
 * `{ $minab: 'datetime', v: '2026-10-02T08:30:00.000Z' }`. An object that has its own `$minab` key is
 * wrapped, so a value can never pretend to be a tag. Throws a `WireError` (`wire.invalidValue`) for a
 * function, a symbol, a class instance and so on.
 */
export function toWire(value: unknown, path = ''): Crossing {
    if (value === undefined) return undefined;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw invalid(path, 'a finite number');
        return value;
    }
    if (value instanceof Big) return { [TAG]: 'decimal', v: decimalText(value) };
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw invalid(path, 'a valid DATETIME');
        return { [TAG]: 'datetime', v: value.toISOString() };
    }
    if (Array.isArray(value)) return value.map((item, i) => toWire(item, `${path}[${i}]`));
    if (typeof value === 'object' && isPlain(value)) {
        const out: Record<string, Crossing> = {};
        for (const [key, item] of Object.entries(value)) {
            const encoded = toWire(item, path === '' ? key : `${path}.${key}`);
            if (encoded !== undefined) put(out, key, encoded);
        }
        return TAG in out ? { [TAG]: 'object', v: out } : out;
    }
    throw invalid(path, 'a Minab value');
}

/** The reverse of `toWire`. Throws a `WireError` for a tag it does not know. */
export function fromWire(json: Crossing, path = ''): unknown {
    if (json === undefined || json === null || typeof json !== 'object') return json;
    if (Array.isArray(json)) return json.map((item, i) => fromWire(item, `${path}[${i}]`));
    const object = json as Record<string, unknown>;
    if (TAG in object) {
        const { v } = object;
        switch (object[TAG]) {
            case 'decimal':
                if (typeof v === 'string') {
                    try {
                        return new Big(v);
                    } catch {
                        break;
                    }
                }
                break;
            case 'datetime':
                if (typeof v === 'string' && !Number.isNaN(new Date(v).getTime())) return new Date(v);
                break;
            case 'object':
                if (typeof v === 'object' && v !== null && !Array.isArray(v)) return decodeFields(v as Record<string, unknown>, path);
                break;
        }
        throw invalid(path, 'a Minab value');
    }
    return decodeFields(object, path);
}

function decodeFields(object: Record<string, unknown>, path: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) put(out, key, fromWire(item, path === '' ? key : `${path}.${key}`));
    return out;
}
