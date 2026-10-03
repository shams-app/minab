/**
 * From a Minab host schema to real Postgres tables.
 *
 * Minab source never declares tables — the host supplies a `MinabSchema`
 * describing tables that already exist. The playground *is* the host, so
 * it has to make those tables exist: this turns the schema into DDL, and
 * seed rows into INSERTs. The same text is what "Run it locally" exports as
 * `seed.sql`, so the in-browser database and a real one start identical.
 *
 * Two host-side storage choices, both invisible to Minab source:
 *  - `UUID` columns are stored as `text`, so demo ids stay readable
 *    (`cus-ada`, `ord-104`). Minab only compares UUIDs for equality, which
 *    text supports the same way.
 *  - No foreign-key constraints. A `ref`'s `foreignKey` is what makes a
 *    traversal *compilable*; enforcing it is the host database's business,
 *    and leaving it off keeps seed order free.
 */

import type { Row } from '../language/minab-executor.js';
import type { ScalarType } from '../language/minab-types.js';
import type { MinabSchema, MinabTableSchema } from '../language/schema.js';

export interface PhysicalColumn {
    name: string;
    /** The Postgres type, e.g. `numeric`, `text[]`. */
    sqlType: string;
    /** The Minab type as written in a config, e.g. `DECIMAL?`. */
    minabType: string;
    nullable: boolean;
    primaryKey: boolean;
    /** Set when this column exists to back a `ref` or `collection` — the relation's name. */
    backs?: string;
}

export interface PhysicalTable {
    name: string;
    columns: PhysicalColumn[];
}

const SQL_TYPES: Record<ScalarType['base'], string> = {
    TEXT: 'text',
    CITEXT: 'citext',
    INTEGER: 'bigint',
    DECIMAL: 'numeric',
    BOOLEAN: 'boolean',
    DATE: 'date',
    TIME: 'time',
    DATETIME: 'timestamptz',
    UUID: 'text',
    JSON: 'jsonb'
};

function scalarSql(type: ScalarType): string {
    return SQL_TYPES[type.base] + (type.array ? '[]' : '');
}

function scalarMinab(type: ScalarType): string {
    let s = type.base + (type.nullable ? '?' : '');
    if (type.array) s += '[]' + (type.arrayNullable ? '?' : '');
    return s;
}

/** A column's own nullability: for an array, whether the array itself may be null. */
function columnNullable(type: ScalarType): boolean {
    return type.array ? type.arrayNullable : type.nullable;
}

function primaryKeyType(table: MinabTableSchema | undefined): ScalarType | undefined {
    if (!table?.primaryKey) return undefined;
    const column = table.columns.find(c => c.name === table.primaryKey);
    return column?.type.kind === 'scalar' ? column.type.type : undefined;
}

/**
 * The columns each table really has. Scalar columns map one to one; a
 * `ref` becomes its foreign-key column (typed like the target's primary
 * key); a `collection` adds its foreign key to the *other* table when that
 * table doesn't already declare it.
 */
export function physicalTables(schema: MinabSchema): PhysicalTable[] {
    const byName = new Map(schema.tables.map(t => [t.name, t]));
    const tables = new Map<string, PhysicalTable>();
    for (const table of schema.tables) tables.set(table.name, { name: table.name, columns: [] });

    const add = (tableName: string, column: PhysicalColumn) => {
        const table = tables.get(tableName);
        if (!table || table.columns.some(c => c.name === column.name)) return;
        table.columns.push(column);
    };

    for (const table of schema.tables) {
        for (const column of table.columns) {
            if (column.type.kind === 'scalar') {
                add(table.name, {
                    name: column.name,
                    sqlType: scalarSql(column.type.type),
                    minabType: scalarMinab(column.type.type),
                    nullable: columnNullable(column.type.type),
                    primaryKey: table.primaryKey === column.name
                });
            }
        }
    }
    for (const table of schema.tables) {
        for (const column of table.columns) {
            const type = column.type;
            if (type.kind === 'ref' && type.foreignKey) {
                const keyType = primaryKeyType(byName.get(type.table));
                add(table.name, {
                    name: type.foreignKey,
                    sqlType: keyType ? scalarSql(keyType) : 'text',
                    minabType: keyType ? scalarMinab({ ...keyType, nullable: type.nullable }) : 'UUID',
                    nullable: type.nullable,
                    primaryKey: false,
                    backs: column.name
                });
            } else if (type.kind === 'collection' && type.foreignKey) {
                const keyType = primaryKeyType(table);
                add(type.table, {
                    name: type.foreignKey,
                    sqlType: keyType ? scalarSql(keyType) : 'text',
                    minabType: keyType ? scalarMinab({ ...keyType, nullable: true }) : 'UUID?',
                    nullable: true,
                    primaryKey: false,
                    backs: `${table.name}.${column.name}`
                });
            }
        }
    }
    return [...tables.values()];
}

export function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

function quoteString(text: string): string {
    return `'${text.replace(/'/g, "''")}'`;
}

/** A JS value as a Postgres literal of the given column type. */
export function sqlLiteral(value: unknown, sqlType: string): string {
    if (value === null || value === undefined) return 'NULL';
    if (sqlType.endsWith('[]')) {
        if (!Array.isArray(value)) throw new Error(`expected an array for a ${sqlType} column, got ${JSON.stringify(value)}`);
        const element = sqlType.slice(0, -2);
        return `ARRAY[${value.map(v => sqlLiteral(v, element)).join(', ')}]::${sqlType}`;
    }
    switch (sqlType) {
        case 'jsonb':
            return `${quoteString(JSON.stringify(value))}::jsonb`;
        case 'boolean':
            if (typeof value !== 'boolean') throw new Error(`expected true or false, got ${JSON.stringify(value)}`);
            return value ? 'TRUE' : 'FALSE';
        case 'numeric':
        case 'bigint':
            // Exact decimals come as text (D17): a JSON number cannot hold 20 digits.
            if (sqlType === 'numeric' && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return value;
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                throw new Error(`expected a number, got ${JSON.stringify(value)}`);
            }
            return String(value);
        case 'date':
        case 'time':
        case 'timestamptz':
            return `${quoteString(String(value))}::${sqlType}`;
        default:
            return quoteString(typeof value === 'string' ? value : JSON.stringify(value));
    }
}

export function createTableSql(table: PhysicalTable): string {
    const lines = table.columns.map(c => `  ${quoteIdent(c.name)} ${c.sqlType}${c.primaryKey ? ' PRIMARY KEY' : c.nullable ? '' : ' NOT NULL'}`);
    return `CREATE TABLE ${quoteIdent(table.name)} (\n${lines.join(',\n')}\n);`;
}

export function insertSql(table: PhysicalTable, rows: Row[]): string | undefined {
    if (rows.length === 0) return undefined;
    const columns = table.columns;
    const unknown = new Set<string>();
    for (const row of rows)
        for (const key of Object.keys(row)) {
            if (!columns.some(c => c.name === key)) unknown.add(key);
        }
    if (unknown.size > 0) {
        throw new Error(
            `seed.${table.name}: ${[...unknown].map(k => `"${k}"`).join(', ')} ${unknown.size === 1 ? 'is not a column' : 'are not columns'} of ${table.name}`
        );
    }
    const values = rows.map((row, index) => {
        try {
            return `  (${columns.map(c => sqlLiteral(row[c.name], c.sqlType)).join(', ')})`;
        } catch (e) {
            throw new Error(`seed.${table.name}[${index}]: ${(e as Error).message}`);
        }
    });
    return `INSERT INTO ${quoteIdent(table.name)} (${columns.map(c => quoteIdent(c.name)).join(', ')}) VALUES\n${values.join(',\n')};`;
}

/** The whole database for a host: extensions, tables, rows. */
export function databaseScript(schema: MinabSchema, seed: Record<string, Row[]> = {}): string {
    const tables = physicalTables(schema);
    for (const name of Object.keys(seed)) {
        if (!tables.some(t => t.name === name)) throw new Error(`seed: "${name}" is not a table in the schema`);
    }
    const parts: string[] = [];
    if (tables.some(t => t.columns.some(c => c.sqlType.startsWith('citext')))) {
        parts.push('CREATE EXTENSION IF NOT EXISTS citext;');
    }
    for (const table of tables) parts.push(createTableSql(table));
    for (const table of tables) {
        const insert = insertSql(table, seed[table.name] ?? []);
        if (insert) parts.push(insert);
    }
    return parts.join('\n\n') + '\n';
}
