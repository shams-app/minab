import { describe, test } from 'vitest';
import type { Row } from '../../src/language/minab-executor.js';
import type { MinabTableSchema } from '../../src/language/schema.js';
import type { TestDatabase } from '../support/database.js';
import { errorKind, loadSchema, sameOutcome, sameValue, showOutcome, type Outcome, type SchemaSpec } from '../support/minab.js';

/** One expression, answered by the interpreter and by Postgres. */
export interface DifferentialCase {
    name: string;
    /** The Minab expression, for example `1 + 2` or `.price * .qty`. */
    expr: string;
    /** The tables the expression may use. Without it, the case has one table `One` with one row. */
    schema?: SchemaSpec;
    /** The record the expression sees as `.`. Needs `schema`. */
    record?: Row;
    /** The table of `record`. Defaults to the first table of `schema`. */
    table?: string;
    /** The answer both runtimes must give: a value, or `{ error: 'division-by-zero' }`. */
    expect?: unknown;
    /** A known bug: the two answers differ today. The card that fixes it removes this. */
    knownGap?: { card: string; note: string };
}

/**
 * A table with one column of every common type. Case files may share it, which
 * keeps the suite fast (the language services are built once for each distinct schema).
 */
export const ITEM_SCHEMA: SchemaSpec = {
    tables: [
        {
            name: 'Item',
            primaryKey: 'id',
            columns: {
                id: 'INTEGER',
                a: 'INTEGER',
                b: 'INTEGER',
                n: 'INTEGER?',
                m: 'INTEGER?',
                x: 'DECIMAL',
                y: 'DECIMAL',
                z: 'DECIMAL',
                s: 'TEXT',
                t: 'TEXT?',
                ci: 'CITEXT',
                yes: 'BOOLEAN',
                no: 'BOOLEAN'
            }
        }
    ]
};

const ONE_SCHEMA: SchemaSpec = { tables: [{ name: 'One', primaryKey: 'id', columns: { id: 'INTEGER' } }] };

function literal(value: unknown): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function isErrorExpectation(expected: unknown): expected is { error: string } {
    return typeof expected === 'object' && expected !== null && 'error' in expected;
}

async function settle(run: () => Promise<{ ok: true; value: unknown } | { ok: false; reason: string }>): Promise<Outcome> {
    try {
        const result = await run();
        return result.ok ? result : { ok: false, kind: errorKind(result.reason), message: result.reason };
    } catch (e) {
        const message = (e as Error).message;
        return { ok: false, kind: errorKind(message), message };
    }
}

const DEFAULTS: Record<string, unknown> = { INTEGER: 0, DECIMAL: 0, TEXT: '', CITEXT: '', BOOLEAN: false };

/** A record may name only the columns it cares about. The other columns get a neutral value (`null` when the column is nullable). */
function withDefaults(table: MinabTableSchema, record: Row): Row {
    const row: Row = { ...record };
    for (const column of table.columns) {
        if (column.type.kind !== 'scalar' || column.name in row) continue;
        row[column.name] = column.type.type.nullable ? null : (DEFAULTS[column.type.type.base] ?? null);
    }
    return row;
}

/** Runs the case on both runtimes. */
export async function answers(db: TestDatabase, c: DifferentialCase): Promise<{ interpreted: Outcome; sql: Outcome; sqlText?: string }> {
    if (c.record && !c.schema) throw new Error(`case "${c.name}": a record needs a schema`);
    const loaded = loadSchema(c.schema ?? ONE_SCHEMA);
    const table = c.record ? (c.table ?? loaded.schema.tables[0]?.name) : 'One';
    const key = loaded.schema.tables.find(t => t.name === table)?.primaryKey;
    if (!key) throw new Error(`case "${c.name}": table "${table}" needs a primaryKey`);
    const row = withDefaults(
        loaded.schema.tables.find(t => t.name === table)!,
        c.record ?? { id: 1 }
    );

    return await db.isolated(loaded.script({ [table]: [row] }), async () => {
        const program = await loaded.parse(c.expr);
        const interpreted = await settle(() => loaded.run(program.model, db.executor, c.record ? { table, row } : undefined));

        const parsed = await loaded.parse(`FROM ${table} WHERE .${key} == ${literal(row[key])} SELECT ${c.expr} AS v`);
        let sqlText: string | undefined;
        const spy = {
            execute: async (q: { text: string; params: unknown[] }) => {
                sqlText = q.text;
                return await db.executor.execute(q);
            }
        };
        const sql = await settle(async () => {
            const result = await loaded.run(parsed.model, spy);
            if (!result.ok) return result;
            return { ok: true as const, value: (result.value as Row[])[0]?.v ?? null };
        });
        return { interpreted, sql, sqlText };
    });
}

function matchesExpectation(outcome: Outcome, expected: unknown): boolean {
    if (isErrorExpectation(expected)) return !outcome.ok && outcome.kind === expected.error;
    return outcome.ok && sameValue(outcome.value, expected);
}

/** Runs one case and throws when it fails. */
export async function checkCase(db: TestDatabase, c: DifferentialCase): Promise<void> {
    const { interpreted, sql, sqlText } = await answers(db, c);
    const report = `${c.expr}\n  interpreter: ${showOutcome(interpreted)}\n  postgres:    ${showOutcome(sql)}${sqlText ? `\n  sql: ${sqlText}` : ''}`;
    if (c.knownGap) {
        if (sameOutcome(interpreted, sql)) throw new Error(`gap fixed? remove knownGap (${c.knownGap.card}: ${c.knownGap.note})\n${report}`);
        return;
    }
    if (!sameOutcome(interpreted, sql)) throw new Error(`the runtimes disagree\n${report}`);
    if ('expect' in c && !matchesExpectation(interpreted, c.expect)) {
        throw new Error(`both runtimes agree, but not with the expected answer ${JSON.stringify(c.expect)}\n${report}`);
    }
}

/** Registers one test per case. Case files are listed by `differential.test.ts`. */
export function defineDifferentialCases(file: string, cases: DifferentialCase[], database: () => TestDatabase): void {
    describe(file, () => {
        for (const c of cases) {
            test(c.name + (c.knownGap ? ` [known gap, ${c.knownGap.card}]` : ''), async () => {
                await checkCase(database(), c);
            });
        }
    });
}
