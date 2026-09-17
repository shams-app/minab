/**
 * The CLI's configuration file (roadmap Phase 6).
 *
 * Everything Minab source deliberately doesn't say has to come from
 * somewhere: the table/column contract (`MinabSchema`, see `schema.ts`),
 * whether this program is a field rule and what `$`/`.` mean inside it
 * (`MinabRuleContext`), the record under validation, and a data source.
 * Inside the host application those are all supplied in-process. On a
 * command line there is no host, so this file stands in for one.
 *
 * The on-disk shape is deliberately *not* the internal one. A hand-written
 * `MinabSchema` literal spells one `UUID` column as a five-field nested
 * object, which is fine for a TypeScript fixture and miserable in JSON, so
 * columns accept a shorthand (`"UUID"`, `"TEXT?"`, `"INTEGER[]"`,
 * `{"ref": "Customer", "foreignKey": "customer_id"}`) that this module
 * expands. Every rejection names the JSON path that caused it, since a
 * config typo is the most likely first thing a new user hits.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Row, SqlQuery } from '../language/minab-executor.js';
import {
    scalarType,
    type ColumnType,
    type MinabColumnSchema,
    type MinabRuleContext,
    type MinabSchema,
    type MinabTableSchema
} from '../language/schema.js';
import type { LogicalTypeBase, MinabType, ScalarType } from '../language/minab-types.js';

/** A config file that can't be used — always reported as a plain message, never a stack trace. */
export class ConfigError extends Error {}

/** One canned answer for the fixture data source (see `FixtureExecutor`). */
export interface FixtureResponse {
    /** Substring of the generated SQL this response answers; absent matches anything. */
    match?: string;
    rows: Row[];
}

/** A loaded, validated config — the CLI's whole view of the host. */
export interface LoadedConfig {
    /** Where it came from, for error messages. `undefined` when no config file was used. */
    path?: string;
    schema: MinabSchema;
    ruleContext: MinabRuleContext;
    record?: Row;
    fieldValue?: unknown;
    responses: FixtureResponse[];
    database?: string;
}

export const DEFAULT_CONFIG_NAME = 'minab.config.json';

const LOGICAL_BASES: ReadonlySet<string> = new Set<LogicalTypeBase>([
    'TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN',
    'DATE', 'TIME', 'DATETIME', 'UUID', 'JSON'
]);

/**
 * `BASE`, `BASE?` (nullable), `BASE[]` (array), `BASE?[]?` (nullable
 * elements in a nullable array) — the same four flags `ScalarType` carries,
 * written the way spec §7.2 writes them.
 */
const SCALAR_SHORTHAND = /^([A-Z]+)(\?)?(\[\])?(\?)?$/;

function parseScalar(text: string, at: string): ScalarType {
    const match = SCALAR_SHORTHAND.exec(text.trim());
    if (!match) {
        throw new ConfigError(`${at}: "${text}" is not a type — expected something like "TEXT", "TEXT?", "INTEGER[]" or "TEXT?[]?"`);
    }
    const [, base, nullable, array, arrayNullable] = match;
    if (!LOGICAL_BASES.has(base)) {
        throw new ConfigError(`${at}: unknown type "${base}" — expected one of ${[...LOGICAL_BASES].join(', ')} (spec §7.2)`);
    }
    if (arrayNullable && !array) {
        throw new ConfigError(`${at}: "${text}" marks an array nullable but declares no array — write "${base}?" or "${base}?[]?"`);
    }
    return scalarType(base as LogicalTypeBase, {
        nullable: nullable !== undefined,
        array: array !== undefined,
        arrayNullable: arrayNullable !== undefined
    });
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, at: string): string {
    if (typeof value !== 'string') throw new ConfigError(`${at}: expected a string, got ${describe(value)}`);
    return value;
}

function describe(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    return typeof value;
}

function parseColumnType(spec: unknown, at: string): ColumnType {
    if (typeof spec === 'string') {
        return { kind: 'scalar', type: parseScalar(spec, at) };
    }
    if (!isRecordValue(spec)) {
        throw new ConfigError(`${at}: expected a type string or an object, got ${describe(spec)}`);
    }
    if ('ref' in spec) {
        return {
            kind: 'ref',
            table: requireString(spec.ref, `${at}.ref`),
            nullable: spec.nullable !== false,
            foreignKey: spec.foreignKey === undefined ? undefined : requireString(spec.foreignKey, `${at}.foreignKey`)
        };
    }
    if ('collection' in spec) {
        return {
            kind: 'collection',
            table: requireString(spec.collection, `${at}.collection`),
            foreignKey: spec.foreignKey === undefined ? undefined : requireString(spec.foreignKey, `${at}.foreignKey`)
        };
    }
    if ('type' in spec) {
        return { kind: 'scalar', type: parseScalar(requireString(spec.type, `${at}.type`), `${at}.type`) };
    }
    throw new ConfigError(`${at}: expected "type", "ref" or "collection"`);
}

/** Columns as either `{"id": "UUID"}` or `[{"name": "id", "type": "UUID"}]` — the map reads better, the array preserves the internal shape. */
function parseColumns(spec: unknown, at: string): MinabColumnSchema[] {
    if (Array.isArray(spec)) {
        return spec.map((entry, index) => {
            const entryAt = `${at}[${index}]`;
            if (!isRecordValue(entry)) throw new ConfigError(`${entryAt}: expected an object`);
            return {
                name: requireString(entry.name, `${entryAt}.name`),
                type: parseColumnType(entry.type, `${entryAt}.type`)
            };
        });
    }
    if (isRecordValue(spec)) {
        return Object.entries(spec).map(([name, type]) => ({
            name,
            type: parseColumnType(type, `${at}.${name}`)
        }));
    }
    throw new ConfigError(`${at}: expected an object of column names or an array of columns, got ${describe(spec)}`);
}

function parseTables(spec: unknown, at: string): MinabTableSchema[] {
    if (!Array.isArray(spec)) throw new ConfigError(`${at}: expected an array of tables, got ${describe(spec)}`);
    return spec.map((entry, index) => {
        const entryAt = `${at}[${index}]`;
        if (!isRecordValue(entry)) throw new ConfigError(`${entryAt}: expected an object`);
        return {
            name: requireString(entry.name, `${entryAt}.name`),
            primaryKey: entry.primaryKey === undefined ? undefined : requireString(entry.primaryKey, `${entryAt}.primaryKey`),
            columns: parseColumns(entry.columns ?? {}, `${entryAt}.columns`)
        };
    });
}

function parseFunctions(spec: unknown, at: string): MinabSchema['functions'] {
    if (spec === undefined) return [];
    if (!Array.isArray(spec)) throw new ConfigError(`${at}: expected an array of functions, got ${describe(spec)}`);
    return spec.map((entry, index) => {
        const entryAt = `${at}[${index}]`;
        if (!isRecordValue(entry)) throw new ConfigError(`${entryAt}: expected an object`);
        const params = entry.params ?? [];
        if (!Array.isArray(params)) throw new ConfigError(`${entryAt}.params: expected an array, got ${describe(params)}`);
        return {
            name: requireString(entry.name, `${entryAt}.name`),
            paramTypes: params.map((p, i) => parseScalar(requireString(p, `${entryAt}.params[${i}]`), `${entryAt}.params[${i}]`) as MinabType),
            returnType: parseScalar(requireString(entry.returns, `${entryAt}.returns`), `${entryAt}.returns`) as MinabType
        };
    });
}

function parseSchema(spec: unknown, at: string): MinabSchema {
    if (spec === undefined) return { tables: [], functions: [] };
    if (!isRecordValue(spec)) throw new ConfigError(`${at}: expected an object, got ${describe(spec)}`);
    return {
        tables: parseTables(spec.tables ?? [], `${at}.tables`),
        functions: parseFunctions(spec.functions, `${at}.functions`)
    };
}

function parseRuleContext(spec: unknown, at: string): MinabRuleContext {
    if (spec === undefined) return { isFieldRule: false };
    if (!isRecordValue(spec)) throw new ConfigError(`${at}: expected an object, got ${describe(spec)}`);
    if (spec.isFieldRule !== undefined && typeof spec.isFieldRule !== 'boolean') {
        throw new ConfigError(`${at}.isFieldRule: expected true or false, got ${describe(spec.isFieldRule)}`);
    }
    const fieldType = spec.fieldType === undefined
        ? undefined
        : parseScalar(requireString(spec.fieldType, `${at}.fieldType`), `${at}.fieldType`);
    return {
        // `$` being legal at all is host-supplied (spec §6.2) — declaring a
        // field type is enough to mean it, so a config that names one
        // doesn't also have to say `isFieldRule` twice.
        isFieldRule: spec.isFieldRule === undefined ? fieldType !== undefined : spec.isFieldRule === true,
        fieldType,
        recordTable: spec.recordTable === undefined ? undefined : requireString(spec.recordTable, `${at}.recordTable`)
    };
}

function parseResponses(spec: unknown, at: string): FixtureResponse[] {
    if (spec === undefined) return [];
    const list = Array.isArray(spec) ? spec : isRecordValue(spec) && Array.isArray(spec.responses) ? spec.responses : undefined;
    if (!list) throw new ConfigError(`${at}: expected an array of responses, or an object with a "responses" array`);
    return list.map((entry, index) => {
        const entryAt = `${at}[${index}]`;
        if (!isRecordValue(entry)) throw new ConfigError(`${entryAt}: expected an object`);
        const match = entry.match === undefined ? undefined : requireString(entry.match, `${entryAt}.match`);
        if ('value' in entry) {
            // The interpreter reads a pushed-down subexpression back as a
            // single `value` column, so this shorthand is what most
            // validation-rule fixtures actually want.
            return { match, rows: [{ value: entry.value }] };
        }
        if (!Array.isArray(entry.rows)) {
            throw new ConfigError(`${entryAt}: expected "rows" (an array) or "value" (a single scalar)`);
        }
        return { match, rows: entry.rows as Row[] };
    });
}

/** `"record": "booking.json"` reads that file relative to the config; an inline object is used as-is. */
function parseInlineOrFile(spec: unknown, baseDir: string, at: string): Record<string, unknown> | undefined {
    if (spec === undefined) return undefined;
    if (typeof spec === 'string') return readJson(resolve(baseDir, spec), at);
    if (isRecordValue(spec)) return spec;
    throw new ConfigError(`${at}: expected an object or a path to a JSON file, got ${describe(spec)}`);
}

function readJson(path: string, at: string): Record<string, unknown> {
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        throw new ConfigError(`${at}: cannot read ${path}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new ConfigError(`${path}: invalid JSON — ${(e as Error).message}`);
    }
    if (!isRecordValue(parsed)) throw new ConfigError(`${path}: expected a JSON object at the top level`);
    return parsed;
}

/** An empty host: no tables, no record, no data source. What `minab check` falls back to with no config file. */
export function emptyConfig(): LoadedConfig {
    return { schema: { tables: [], functions: [] }, ruleContext: { isFieldRule: false }, responses: [] };
}

export function loadConfigFile(path: string): LoadedConfig {
    const raw = readJson(path, path);
    const baseDir = dirname(path);
    const schemaSpec = typeof raw.schema === 'string'
        ? readJson(resolve(baseDir, raw.schema), 'schema')
        : raw.schema;
    return {
        path,
        schema: parseSchema(schemaSpec, 'schema'),
        ruleContext: parseRuleContext(raw.rule, 'rule'),
        record: parseInlineOrFile(raw.record, baseDir, 'record') as Row | undefined,
        fieldValue: raw.fieldValue,
        responses: parseResponses(
            typeof raw.data === 'string' ? readJson(resolve(baseDir, raw.data), 'data').responses : raw.data,
            'data'
        ),
        database: raw.database === undefined ? undefined : requireString(raw.database, 'database')
    };
}

/** Reads a `--record`/`--data` file given on the command line, which overrides whatever the config said. */
export function loadRecordFile(path: string): Row {
    return readJson(path, path) as Row;
}

export function matchResponse(responses: FixtureResponse[], query: SqlQuery): FixtureResponse | undefined {
    return responses.find(r => r.match === undefined || query.text.includes(r.match));
}
