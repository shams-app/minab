/**
 * The host-config format, parsed without touching a file system.
 *
 * Everything Minab source deliberately doesn't say has to come from
 * somewhere: the table/column contract (`MinabSchema`, see `schema.ts`),
 * whether this program is a field rule and what `$`/`.` mean inside it
 * (`MinabRuleContext`), the record under validation, and a data source.
 * Inside a host application those are all supplied in-process. The CLI
 * reads them from `minab.config.json` (`src/cli/config.ts`); the web
 * playground edits the same JSON in the browser. This module is the part
 * both share, so a config means the same thing wherever it's written.
 *
 * The JSON shape is deliberately *not* the internal one. A hand-written
 * `MinabSchema` literal spells one `UUID` column as a five-field nested
 * object, which is fine for a TypeScript fixture and miserable in JSON, so
 * columns accept a shorthand (`"UUID"`, `"TEXT?"`, `"INTEGER[]"`,
 * `{"ref": "Customer", "foreignKey": "customer_id"}`) that this module
 * expands. Every rejection names the JSON path that caused it, since a
 * config typo is the most likely first thing a new user hits.
 */

import type { Row, SqlQuery } from '../language/minab-executor.js';
import { scalarType, type ColumnType, type MinabColumnSchema, type MinabRuleContext, type MinabSchema, type MinabTableSchema } from '../language/schema.js';
import type { LogicalTypeBase, ScalarType } from '../language/minab-types.js';

/** A config that can't be used — always reported as a plain message, never a stack trace. */
export class ConfigError extends Error {}

/** One canned answer for the fixture data source (see `FixtureExecutor`). */
export interface FixtureResponse {
    /** Substring of the generated SQL this response answers; absent matches anything. */
    match?: string;
    rows: Row[];
}

/** One user of the fixture directory: the fixed columns, and any other key is an attribute (text or `null`). `left: true` is someone who left the workspace (P10). */
export interface FixtureUser {
    id: string;
    name: string;
    left?: boolean;
    [attribute: string]: string | boolean | null | undefined;
}

/** One group of the fixture directory. `includes` names groups nested in this one (flattened); `tags` are for routes (P7). */
export interface FixtureGroup {
    name: string;
    members: string[];
    includes: string[];
    tags: string[];
}

/** A route written in Minab (P7). `body` reads its user as `u`. */
export interface FixtureRoute {
    name: string;
    returns: 'USERGROUP' | 'USER?';
    body: string;
}

/** The `directory` section of a config: a small directory the CLI and the playground run users and groups against (MN.2). */
export interface DirectoryConfig {
    users: FixtureUser[];
    groups: FixtureGroup[];
    routes: FixtureRoute[];
    /** The user ids of the special users of the run (`@currentUser`); `null` is "nobody". */
    specialUsers: Record<string, string | null>;
}

/** A parsed, validated config — a host's whole answer to what the source leaves unsaid. */
export interface HostConfig {
    schema: MinabSchema;
    ruleContext: MinabRuleContext;
    record?: Row;
    fieldValue?: unknown;
    responses: FixtureResponse[];
    database?: string;
    directory?: DirectoryConfig;
}

export interface ParseConfigOptions {
    /**
     * Reads the JSON file a string-valued `schema`, `record` or `data`
     * names. The CLI resolves it relative to the config file; a host with
     * no file system leaves this out, and a path is then rejected.
     */
    readJson?: (path: string, at: string) => Record<string, unknown>;
}

const LOGICAL_BASES: ReadonlySet<string> = new Set<LogicalTypeBase>([
    'TEXT',
    'CITEXT',
    'INTEGER',
    'DECIMAL',
    'BOOLEAN',
    'DATE',
    'TIME',
    'DATETIME',
    'UUID',
    'JSON'
]);

/**
 * `BASE`, `BASE?` (nullable), `BASE[]` (array), `BASE?[]?` (nullable
 * elements in a nullable array) — the same four flags `ScalarType` carries,
 * written the way spec §7.2 writes them.
 */
const SCALAR_SHORTHAND = /^([A-Z]+)(\?)?(\[\])?(\?)?$/;

export function parseScalar(text: string, at: string): ScalarType {
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

/** `sqlName` (the physical database name), when the entry has one. Must be a non-empty string. */
function optionalSqlName(entry: Record<string, unknown>, at: string): { sqlName?: string } {
    if (entry.sqlName === undefined) return {};
    const sqlName = requireString(entry.sqlName, `${at}.sqlName`);
    if (sqlName === '') throw new ConfigError(`${at}.sqlName: expected a non-empty string`);
    return { sqlName };
}

/** Columns as either `{"id": "UUID"}` or `[{"name": "id", "type": "UUID"}]` — the map reads better, the array preserves the internal shape. */
function parseColumns(spec: unknown, at: string): MinabColumnSchema[] {
    if (Array.isArray(spec)) {
        return spec.map((entry, index) => {
            const entryAt = `${at}[${index}]`;
            if (!isRecordValue(entry)) throw new ConfigError(`${entryAt}: expected an object`);
            return {
                name: requireString(entry.name, `${entryAt}.name`),
                ...optionalSqlName(entry, entryAt),
                type: parseColumnType(entry.type, `${entryAt}.type`)
            };
        });
    }
    if (isRecordValue(spec)) {
        return Object.entries(spec).map(([name, type]) => {
            // `{"type": ..., "sqlName": ...}` is the long form of one column.
            const sqlName = isRecordValue(type) ? optionalSqlName(type, `${at}.${name}`) : {};
            return { name, ...sqlName, type: parseColumnType(type, `${at}.${name}`) };
        });
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
            ...optionalSqlName(entry, entryAt),
            primaryKey: entry.primaryKey === undefined ? undefined : requireString(entry.primaryKey, `${entryAt}.primaryKey`),
            columns: parseColumns(entry.columns ?? {}, `${entryAt}.columns`)
        };
    });
}

export function parseSchema(spec: unknown, at: string): MinabSchema {
    if (spec === undefined) return { tables: [] };
    if (!isRecordValue(spec)) throw new ConfigError(`${at}: expected an object, got ${describe(spec)}`);
    if (spec.functions !== undefined) {
        throw new ConfigError(
            `${at}.functions: a schema no longer has functions. Host functions are declared with the "functions" option of createMinab (spec §8.7). Remove this key.`
        );
    }
    return { tables: parseTables(spec.tables ?? [], `${at}.tables`) };
}

export function parseRuleContext(spec: unknown, at: string): MinabRuleContext {
    if (spec === undefined) return { isFieldRule: false };
    if (!isRecordValue(spec)) throw new ConfigError(`${at}: expected an object, got ${describe(spec)}`);
    if (spec.isFieldRule !== undefined && typeof spec.isFieldRule !== 'boolean') {
        throw new ConfigError(`${at}.isFieldRule: expected true or false, got ${describe(spec.isFieldRule)}`);
    }
    const fieldType = spec.fieldType === undefined ? undefined : parseScalar(requireString(spec.fieldType, `${at}.fieldType`), `${at}.fieldType`);
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

/** A string names a JSON file (only when the host can read one); an inline object is used as-is. */
function parseInlineOrFile(spec: unknown, options: ParseConfigOptions, at: string): Record<string, unknown> | undefined {
    if (spec === undefined) return undefined;
    if (typeof spec === 'string') return readReferenced(spec, options, at);
    if (isRecordValue(spec)) return spec;
    throw new ConfigError(`${at}: expected an object or a path to a JSON file, got ${describe(spec)}`);
}

function readReferenced(path: string, options: ParseConfigOptions, at: string): Record<string, unknown> {
    if (!options.readJson) {
        throw new ConfigError(`${at}: "${path}" names a file, and this host has no files — write the value inline`);
    }
    return options.readJson(path, at);
}

/** Parses JSON text that must hold an object, naming `source` in the error when it doesn't. */
export function parseJsonObject(text: string, source: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new ConfigError(`${source}: invalid JSON — ${(e as Error).message}`);
    }
    if (!isRecordValue(parsed)) throw new ConfigError(`${source}: expected a JSON object at the top level`);
    return parsed;
}

function stringList(value: unknown, at: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
        throw new ConfigError(`${at}: expected an array of strings, got ${describe(value)}`);
    return value as string[];
}

/** Validates the `directory` section: users, groups with tags, routes in Minab, and the special users. */
export function parseDirectory(spec: unknown, at: string): DirectoryConfig {
    if (!isRecordValue(spec)) throw new ConfigError(`${at}: expected an object, got ${describe(spec)}`);
    const entries = (value: unknown, name: string): Record<string, unknown>[] => {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.some(item => !isRecordValue(item))) throw new ConfigError(`${at}.${name}: expected an array of objects`);
        return value as Record<string, unknown>[];
    };
    const users = entries(spec.users, 'users').map((entry, index): FixtureUser => {
        const where = `${at}.users[${index}]`;
        for (const [key, value] of Object.entries(entry)) {
            if (key !== 'left' && value !== null && typeof value !== 'string')
                throw new ConfigError(`${where}.${key}: expected text or null, got ${describe(value)}`);
        }
        return { ...(entry as FixtureUser), id: requireString(entry.id, `${where}.id`), name: requireString(entry.name, `${where}.name`) };
    });
    const ids = new Set<string>();
    for (const user of users) {
        if (ids.has(user.id)) throw new ConfigError(`${at}.users: the id "${user.id}" is used twice`);
        ids.add(user.id);
    }
    const groups = entries(spec.groups, 'groups').map((entry, index): FixtureGroup => {
        const where = `${at}.groups[${index}]`;
        const members = stringList(entry.members, `${where}.members`);
        for (const id of members) if (!ids.has(id)) throw new ConfigError(`${where}.members: no user "${id}"`);
        return {
            name: requireString(entry.name, `${where}.name`),
            members,
            includes: stringList(entry.includes, `${where}.includes`),
            tags: stringList(entry.tags, `${where}.tags`)
        };
    });
    const names = new Set(groups.map(group => group.name));
    if (names.size !== groups.length) throw new ConfigError(`${at}.groups: a group name is used twice`);
    for (const group of groups) {
        for (const included of group.includes)
            if (!names.has(included)) throw new ConfigError(`${at}.groups: "${group.name}" includes the unknown group "${included}"`);
    }
    const routes = entries(spec.routes, 'routes').map((entry, index): FixtureRoute => {
        const where = `${at}.routes[${index}]`;
        const name = requireString(entry.name, `${where}.name`);
        if (!/^[a-z][A-Za-z0-9_]*$/.test(name)) throw new ConfigError(`${where}.name: "${name}" is not a camelCase name`);
        const returns = entry.returns === undefined ? 'USERGROUP' : entry.returns;
        if (returns !== 'USERGROUP' && returns !== 'USER?') throw new ConfigError(`${where}.returns: expected "USERGROUP" or "USER?"`);
        return { name, returns, body: requireString(entry.body, `${where}.body`) };
    });
    const special = spec.specialUsers === undefined ? {} : spec.specialUsers;
    if (!isRecordValue(special)) throw new ConfigError(`${at}.specialUsers: expected an object of names and user ids`);
    const specialUsers: Record<string, string | null> = {};
    for (const [name, id] of Object.entries(special)) {
        if (id !== null && (typeof id !== 'string' || !ids.has(id))) throw new ConfigError(`${at}.specialUsers.${name}: expected the id of a user, or null`);
        specialUsers[name] = id;
    }
    return { users, groups, routes, specialUsers };
}

/** Validates and expands a config object (the parsed `minab.config.json`). Throws `ConfigError`. */
export function parseConfig(raw: Record<string, unknown>, options: ParseConfigOptions = {}): HostConfig {
    const schemaSpec = typeof raw.schema === 'string' ? readReferenced(raw.schema, options, 'schema') : raw.schema;
    return {
        schema: parseSchema(schemaSpec, 'schema'),
        ruleContext: parseRuleContext(raw.rule, 'rule'),
        record: parseInlineOrFile(raw.record, options, 'record') as Row | undefined,
        fieldValue: raw.fieldValue,
        responses: parseResponses(typeof raw.data === 'string' ? readReferenced(raw.data, options, 'data').responses : raw.data, 'data'),
        database: raw.database === undefined ? undefined : requireString(raw.database, 'database'),
        directory: raw.directory === undefined ? undefined : parseDirectory(raw.directory, 'directory')
    };
}

/** An empty host: no tables, no record, no data source. What `minab check` falls back to with no config file. */
export function emptyConfig(): HostConfig {
    return { schema: { tables: [] }, ruleContext: { isFieldRule: false }, responses: [] };
}

export function matchResponse(responses: FixtureResponse[], query: SqlQuery): FixtureResponse | undefined {
    return responses.find(r => r.match === undefined || query.text.includes(r.match));
}
