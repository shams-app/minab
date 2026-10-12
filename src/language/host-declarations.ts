/**
 * What the host declares to Minab: typed inputs and typed functions (D27).
 *
 * The host gives them once, to `createMinab`. The checker needs the types,
 * so they are part of the language services (and of the service cache key).
 * `resolveHostDeclarations` checks the names and the type words and throws a
 * `HostDeclarationError` with a clear message for the host developer.
 */

import { AstUtils, GrammarAST } from 'langium';
import { MinabGrammar } from './generated/grammar.js';
import { DateError, parseDate, parseInstant, parseTime, normalizeDateTime } from './dates.js';
import { scalarType, type LogicalTypeBase, type MinabType, type ScalarType } from './minab-types.js';
import { Big, normalizeIn, NumberError } from './values.js';
import type { MinabColumnSchema, MinabSchema, MinabTableSchema } from './schema.js';

/** A typed host function. A program calls it by name. It runs in the interpreter, never in SQL. */
export interface HostFunctionDeclaration {
    /** Needs a lowercase letter (D10), for example `fxRate`. */
    name: string;
    params: { name: string; type: string }[];
    /** A Minab type word, for example `DECIMAL` or `TEXT[]`. */
    returns: string;
    /** `true`: safe to run in the browser. Default `false`: a program using it needs the server. */
    local?: boolean;
}

/** A type word (`TEXT`, `TEXT?`, `TEXT[]`), or an object of typed fields (`{ id: 'TEXT', roles: 'TEXT[]' }`). */
export type HostInputType = string | { [field: string]: string };

/** The host functions and host inputs a host declares to the checker. */
export interface HostDeclarations {
    functions?: readonly HostFunctionDeclaration[];
    inputs?: Readonly<Record<string, HostInputType>>;
}

export interface ResolvedHostFunction {
    name: string;
    params: { name: string; type: ScalarType }[];
    returns: ScalarType;
    local: boolean;
}

export interface ResolvedHost {
    functions: ReadonlyMap<string, ResolvedHostFunction>;
    /** A scalar or array input has a scalar type. A record input has a `record` type over a table in `inputTables`. */
    inputs: ReadonlyMap<string, MinabType>;
    /** One made-up table for each record input. Its name starts with `@`, so no program can name it. */
    inputTables: ReadonlyMap<string, MinabTableSchema>;
    /** Names the declarations for the service cache. */
    key: string;
}

export const EMPTY_HOST: ResolvedHost = { functions: new Map(), inputs: new Map(), inputTables: new Map(), key: '' };

/** Thrown by `createMinab` when a declared host function or input is wrong: a bad name or a bad type word. */
export class HostDeclarationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HostDeclarationError';
    }
}

const BASES: ReadonlySet<string> = new Set(['TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'UUID', 'JSON']);
const TYPE_WORD = /^([A-Z]+)(\?)?(?:(\[\])(\?)?)?$/;
const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** `TEXT`, `TEXT?`, `TEXT[]`, `TEXT?[]?`: the same words as in a program. */
export function parseTypeWord(word: string): ScalarType | undefined {
    const match = TYPE_WORD.exec(word);
    if (!match || !BASES.has(match[1])) return undefined;
    return scalarType(match[1] as LogicalTypeBase, { nullable: match[2] === '?', array: match[3] === '[]', arrayNullable: match[4] === '?' });
}

function typeWord(word: unknown, where: string): ScalarType {
    const type = typeof word === 'string' ? parseTypeWord(word) : undefined;
    if (!type) {
        throw new HostDeclarationError(
            `${where}: "${String(word)}" is not a Minab type. Use one of TEXT, CITEXT, INTEGER, DECIMAL, BOOLEAN, DATE, TIME, DATETIME, UUID, JSON, with an optional ? or [].`
        );
    }
    return type;
}

let grammarKeywords: ReadonlySet<string> | undefined;

/** Every word keyword of the grammar (`from`, `loop`, `FROM`, ...). Taken from the generated grammar, so a new keyword is covered. */
export function keywordsOfGrammar(): ReadonlySet<string> {
    grammarKeywords ??= new Set(
        AstUtils.streamAst(MinabGrammar())
            .filter(GrammarAST.isKeyword)
            .map(k => k.value)
            .filter(word => NAME.test(word))
    );
    return grammarKeywords;
}

/**
 * A host name is read by programs next to built-ins and keywords. It must be a plain
 * identifier with a lowercase letter (D10), so a new built-in can never take it.
 */
function checkName(name: string, kind: string, schema: MinabSchema): void {
    if (!NAME.test(name)) {
        throw new HostDeclarationError(`host ${kind} "${name}": a name starts with a letter or "_" and has only letters, digits and "_".`);
    }
    if (keywordsOfGrammar().has(name)) {
        throw new HostDeclarationError(`host ${kind} "${name}": this is a keyword of the language, so a program cannot use it as a name. Pick another name.`);
    }
    if (!/\p{Ll}/u.test(name)) {
        throw new HostDeclarationError(
            `host ${kind} "${name}": a name needs at least one lowercase letter. ALL-CAPS names are kept for built-in functions (D10). Try "${name.toLowerCase()}".`
        );
    }
    if (schema.tables.some(t => t.name === name)) {
        throw new HostDeclarationError(`host ${kind} "${name}": this is the name of a table in the schema. Pick another name (D11).`);
    }
}

export function resolveHostDeclarations(declarations: HostDeclarations | undefined, schema: MinabSchema): ResolvedHost {
    if (!declarations || (!declarations.functions?.length && Object.keys(declarations.inputs ?? {}).length === 0)) return EMPTY_HOST;

    const functions = new Map<string, ResolvedHostFunction>();
    for (const declaration of declarations.functions ?? []) {
        const name = declaration.name;
        checkName(name, 'function', schema);
        if (functions.has(name)) throw new HostDeclarationError(`host function "${name}" is declared twice.`);
        const seen = new Set<string>();
        const params = declaration.params.map(param => {
            if (seen.has(param.name)) throw new HostDeclarationError(`host function "${name}": the parameter "${param.name}" is declared twice.`);
            seen.add(param.name);
            return { name: param.name, type: typeWord(param.type, `host function "${name}", parameter "${param.name}"`) };
        });
        functions.set(name, {
            name,
            params,
            returns: typeWord(declaration.returns, `host function "${name}", return type`),
            local: declaration.local ?? false
        });
    }

    const inputs = new Map<string, MinabType>();
    const inputTables = new Map<string, MinabTableSchema>();
    for (const [name, type] of Object.entries(declarations.inputs ?? {})) {
        checkName(name, 'input', schema);
        if (functions.has(name)) throw new HostDeclarationError(`"${name}" is declared as a host function and as a host input. Use two names.`);
        if (typeof type === 'string') {
            inputs.set(name, typeWord(type, `host input "${name}"`));
            continue;
        }
        const fields = Object.entries(type);
        if (fields.length === 0) throw new HostDeclarationError(`host input "${name}": a record needs at least one field.`);
        const columns: MinabColumnSchema[] = fields.map(([field, word]) => ({
            name: field,
            type: { kind: 'scalar', type: typeWord(word, `host input "${name}", field "${field}"`) }
        }));
        const table = `@${name}`;
        inputTables.set(table, { name: table, columns });
        inputs.set(name, { kind: 'record', table });
    }

    const key = JSON.stringify([
        [...functions.values()].map(f => [f.name, f.params.map(p => [p.name, p.type]), f.returns, f.local]),
        [...inputs].map(([name, type]) => [name, type, inputTables.get(type.kind === 'record' ? type.table : '')?.columns])
    ]);
    return { functions, inputs, inputTables, key };
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_TEXT = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/** One value (not a list) of a base type, in the form the interpreter keeps. `undefined` when the value is not of that type. */
function hostScalar(value: unknown, base: LogicalTypeBase): unknown {
    try {
        switch (base) {
            case 'TEXT':
            case 'CITEXT':
                return typeof value === 'string' ? value : undefined;
            case 'BOOLEAN':
                return typeof value === 'boolean' ? value : undefined;
            case 'INTEGER':
                if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
                return typeof value === 'bigint' ? normalizeIn(value, 'INTEGER') : undefined;
            case 'DECIMAL':
                // A number stays a number (the interpreter reads it as an exact value). Text and `bigint` become a `Big`.
                if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
                if (value instanceof Big) return value;
                if (typeof value === 'bigint' || (typeof value === 'string' && NUMBER_TEXT.test(value))) return normalizeIn(value, 'DECIMAL');
                return undefined;
            case 'DATE':
                parseDate(value);
                return value;
            case 'TIME':
                parseTime(value);
                return value;
            case 'DATETIME':
                parseInstant(value);
                return normalizeDateTime(value);
            case 'UUID':
                return typeof value === 'string' && UUID_TEXT.test(value) ? value : undefined;
            case 'JSON':
                return value;
        }
    } catch (error) {
        if (error instanceof DateError || error instanceof NumberError) return undefined;
        throw error;
    }
}

/**
 * Checks the result of a host function against its declared type (ADR 0002 section 4.3): the base type, and
 * whether `null` is allowed (for a list: the list and each item). `undefined` counts as `null`.
 * It gives the value in the form the interpreter keeps, or `{ ok: false }` when the value is not of the type.
 */
export function checkHostResult(value: unknown, type: ScalarType): { ok: true; value: unknown } | { ok: false } {
    if (value === undefined || value === null) return (type.array ? type.arrayNullable : type.nullable) ? { ok: true, value: null } : { ok: false };
    if (!type.array) {
        const checked = hostScalar(value, type.base);
        return checked === undefined ? { ok: false } : { ok: true, value: checked };
    }
    if (!Array.isArray(value)) return { ok: false };
    const items: unknown[] = [];
    for (const item of value) {
        if (item === undefined || item === null) {
            if (!type.nullable) return { ok: false };
            items.push(null);
            continue;
        }
        const checked = hostScalar(item, type.base);
        if (checked === undefined) return { ok: false };
        items.push(checked);
    }
    return { ok: true, value: items };
}
