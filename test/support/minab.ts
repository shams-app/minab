import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { Diagnostic } from 'vscode-languageserver-types';
import { parseConfig } from '../../src/host/config.js';
import { databaseScript } from '../../src/host/ddl.js';
import type { Model } from '../../src/language/generated/ast.js';
import type { QueryExecutor, Row } from '../../src/language/minab-executor.js';
import { createMinabServices } from '../../src/language/minab-module.js';
import type { MinabSchema } from '../../src/language/schema.js';
import { Decimal } from './database.js';

/** The clock of one run: the instant (ISO 8601) and the time zone (an IANA name). */
export interface TestClock {
    now: string;
    timeZone: string;
}

/** A schema as a JSON config writes it (the same shape as `schema` in a host config). */
export type SchemaSpec = { tables: unknown[] };

export interface Loaded {
    schema: MinabSchema;
    /** `CREATE TABLE` and `INSERT` text for this schema and these rows. */
    script(rows?: Record<string, Row[]>): string;
    /** Parses and checks a program. `errors` holds the messages of every error. */
    parse(source: string): Promise<{ model: Model; errors: string[] }>;
    /** Runs the program with the real interpreter. */
    run(
        model: Model,
        executor: QueryExecutor,
        record?: { table: string; row: Row },
        clock?: TestClock
    ): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }>;
}

const cache = new Map<string, Loaded>();

/** Services are built once for each distinct schema. */
export function loadSchema(spec: SchemaSpec, recordTable?: string): Loaded {
    const key = JSON.stringify([spec, recordTable]);
    const cached = cache.get(key);
    if (cached) return cached;
    const schema = parseConfig({ schema: spec }).schema;
    const services = createMinabServices(EmptyFileSystem, schema, recordTable ? { isFieldRule: false, recordTable } : undefined);
    const parse = parseHelper<Model>(services.Minab);
    const loaded: Loaded = {
        schema,
        script: rows => databaseScript(schema, rows),
        async parse(source) {
            const document = await parse(source, { validation: true });
            const text = (d: Diagnostic) => (typeof d.message === 'string' ? d.message : (d.message as { value: string }).value);
            const errors = [...document.parseResult.parserErrors.map(e => e.message), ...(document.diagnostics ?? []).filter(d => d.severity === 1).map(text)];
            return { model: document.parseResult.value, errors };
        },
        run: (model, executor, record, clock) =>
            services.Minab.interpreter.evaluate(model, {
                executor,
                record: record?.row,
                recordTable: record?.table,
                now: clock ? new Date(clock.now) : undefined,
                timeZone: clock?.timeZone
            })
    };
    cache.set(key, loaded);
    return loaded;
}

// ---- comparing answers ---------------------------------------------------

/** What a runtime answered: a value, or an error with its meaning. */
export type Outcome = { ok: true; value: unknown } | { ok: false; kind: ErrorKind; message: string };

export type ErrorKind = 'division-by-zero' | 'cast-failed' | 'other';

export function errorKind(message: string): ErrorKind {
    if (/division by zero|divide by zero|modulo by zero/i.test(message)) return 'division-by-zero';
    // Ours is "cannot cast ..."; Postgres says "invalid input syntax" (22P02) or "out of range" (22003).
    if (/^cannot cast |invalid input syntax|out of range|invalid input value|date\/time field value|malformed/i.test(message)) return 'cast-failed';
    return 'other';
}

/** The exact text of a number, so `0.30` and `0.3` are the same decimal. */
function canonicalDecimal(text: string): string {
    if (!text.includes('.') && !/e/i.test(text)) return text;
    if (/e/i.test(text)) return String(Number(text));
    return text.replace(/0+$/, '').replace(/\.$/, '');
}

const INSTANT_TEXT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** Postgres prints `2026-03-20 21:00:00+00`; `Date.parse` wants `T` and a full offset. */
function isoOf(text: string): string {
    return text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
}

/**
 * Whether two answers are the same, by type. A `DECIMAL` from the database
 * (a `Decimal`) equals a JS number only when their exact texts match, so
 * `0.30000000000000004` is not `0.3`.
 */
export function sameValue(a: unknown, b: unknown): boolean {
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    if (a instanceof Decimal || b instanceof Decimal) {
        const text = (v: unknown) => (v instanceof Decimal ? v.text : typeof v === 'number' || typeof v === 'string' ? String(v) : undefined);
        const [x, y] = [text(a), text(b)];
        return x !== undefined && y !== undefined && canonicalDecimal(x) === canonicalDecimal(y);
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
    }
    // A date time is an instant: `2026-03-20 21:00:00+00` and `2026-03-20T21:00:00.000Z` are the same one.
    if (typeof a === 'string' && typeof b === 'string' && INSTANT_TEXT.test(a) && INSTANT_TEXT.test(b)) return Date.parse(isoOf(a)) === Date.parse(isoOf(b));
    if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(sortedJson(a)) === JSON.stringify(sortedJson(b));
    return a === b;
}

export function sameOutcome(a: Outcome, b: Outcome): boolean {
    if (a.ok && b.ok) return sameValue(a.value, b.value);
    if (!a.ok && !b.ok) return a.kind === b.kind;
    return false;
}

export function showOutcome(o: Outcome): string {
    if (!o.ok) return `error (${o.kind}): ${o.message}`;
    return JSON.stringify(o.value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v)) ?? 'undefined';
}

/** A JSON value with its object keys sorted: jsonb does not keep key order. */
function sortedJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortedJson);
    if (typeof value !== 'object' || value === null || value instanceof Decimal) return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(k => [k, sortedJson((value as Record<string, unknown>)[k])])
    );
}

/** A row as plain JSON, so rows compare by value. */
export function plainRow(row: Row): string {
    return JSON.stringify(
        Object.keys(row)
            .sort()
            .map(k => [
                k,
                row[k] instanceof Decimal
                    ? canonicalDecimal((row[k] as Decimal).text)
                    : typeof row[k] === 'number'
                      ? canonicalDecimal(String(row[k]))
                      : sortedJson(row[k])
            ])
    );
}
