import { describe, test } from 'vitest';
import type { Row } from '../../src/language/minab-executor.js';
import type { MinabTableSchema } from '../../src/language/schema.js';
import { createMinab, type Minab } from '../../src/runtime/index.js';
import type { TestDatabase } from '../support/database.js';
import { errorKind, loadSchema, sameOutcome, sameValue, showOutcome, type Outcome, type SchemaSpec, type TestClock } from '../support/minab.js';

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
    /** The clock of the run: the instant and the time zone (default: the system clock, UTC). Both runtimes get the same one. */
    clock?: TestClock;
    /** The answer both runtimes must give: a value, or `{ error: 'division-by-zero' }`. */
    expect?: unknown;
    /** A known bug: the two answers differ today. The card that fixes it removes this. */
    knownGap?: { card: string; note: string };
    /**
     * A group expression (P2): `expr` is the expression, over the rows of the table `table` (default: the first one).
     * Postgres runs its SQL fragment once, with `GROUP BY GROUPING SETS`; the interpreter runs it on the rows of each
     * group. `expect` is then an object: one answer for each group, by its label (see `groupLabel`).
     */
    group?: GroupSpec;
}

/** The rows and the grouping sets of a group case. */
export interface GroupSpec {
    rows: Row[];
    /** Each set is a list of column names. `[]` is the grand total. Default: `[[]]`. */
    sets?: string[][];
}

/** The label of one group: `""` for the grand total, else `Region=North` or `Region=North,Month=1`. */
export function groupLabel(keys: string[], row: Row): string {
    return keys.map(k => `${k}=${String(row[k] ?? null)}`).join(',');
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

const DEFAULTS: Record<string, unknown> = {
    INTEGER: 0,
    DECIMAL: 0,
    TEXT: '',
    CITEXT: '',
    BOOLEAN: false,
    DATE: '2000-01-01',
    TIME: '00:00:00',
    DATETIME: '2000-01-01T00:00:00Z'
};

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
    const first = loadSchema(c.schema ?? ONE_SCHEMA);
    const table = c.record ? (c.table ?? first.schema.tables[0]?.name) : 'One';
    // With a record, the services know the record's table, as in a real run: `.ts` has a type before the run.
    const loaded = c.record ? loadSchema(c.schema ?? ONE_SCHEMA, table) : first;
    const key = loaded.schema.tables.find(t => t.name === table)?.primaryKey;
    if (!key) throw new Error(`case "${c.name}": table "${table}" needs a primaryKey`);
    const row = withDefaults(
        loaded.schema.tables.find(t => t.name === table)!,
        c.record ?? { id: 1 }
    );

    return await db.isolated(loaded.script({ [table]: [row] }), async () => {
        const program = await loaded.parse(c.expr);
        const interpreted = await settle(() => loaded.run(program.model, db.executor, c.record ? { table, row } : undefined, c.clock));

        const parsed = await loaded.parse(`FROM ${table} WHERE .${key} == ${literal(row[key])} SELECT ${c.expr} AS v`);
        let sqlText: string | undefined;
        const spy = {
            execute: async (q: { text: string; params: unknown[] }) => {
                sqlText = q.text;
                return await db.executor.execute(q);
            }
        };
        const sql = await settle(async () => {
            const result = await loaded.run(parsed.model, spy, undefined, c.clock);
            if (!result.ok) return result;
            return { ok: true as const, value: (result.value as Row[])[0]?.v ?? null };
        });
        return { interpreted, sql, sqlText };
    });
}

// ---- group cases (P2) -----------------------------------------------------

const SQL_TYPE: Record<string, string> = {
    INTEGER: 'bigint',
    DECIMAL: 'numeric',
    TEXT: 'text',
    CITEXT: 'text',
    BOOLEAN: 'boolean',
    DATE: 'date',
    TIME: 'time',
    DATETIME: 'timestamptz',
    UUID: 'uuid'
};

const quoteName = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** A value of the test rows as a typed SQL literal. The rows are test data, so a plain quote is enough. */
function valueSql(value: unknown, base: string): string {
    const type = SQL_TYPE[base] ?? 'text';
    if (value === null || value === undefined) return `NULL::${type}`;
    return `'${String(value).replace(/'/g, "''")}'::${type}`;
}

const runtimes = new Map<string, Minab>();

/** Runs a group case on both runtimes: one outcome for each group label. */
export async function groupAnswers(
    db: TestDatabase,
    c: DifferentialCase & { group: GroupSpec }
): Promise<{ interpreted: Map<string, Outcome>; sql: Map<string, Outcome>; sqlText?: string }> {
    if (!c.schema) throw new Error(`case "${c.name}": a group case needs a schema`);
    const loaded = loadSchema(c.schema);
    const key = JSON.stringify(c.schema);
    const minab = runtimes.get(key) ?? createMinab({ schema: loaded.schema });
    runtimes.set(key, minab);
    const table = loaded.schema.tables.find(t => t.name === (c.table ?? loaded.schema.tables[0]?.name))!;
    const columns = table.columns.flatMap(col => (col.type.kind === 'scalar' ? [{ name: col.name, base: col.type.type.base }] : []));
    const rows = c.group.rows.map(row => withDefaults(table, row));
    const sets = c.group.sets ?? [[]];
    const keys = [...new Set(sets.flat())];

    const prepared = await minab.prepare(c.expr, { ruleContext: { isFieldRule: false, groupTable: table.name } });
    if (!prepared.ok) throw new Error(`case "${c.name}": ${prepared.diagnostics.map(d => d.code).join(', ')}`);

    // The interpreter: the rows of each group of each set.
    const interpreted = new Map<string, Outcome>();
    for (const set of sets) {
        const groups = new Map<string, Row[]>();
        for (const row of rows) groups.set(groupLabel(set, row), [...(groups.get(groupLabel(set, row)) ?? []), row]);
        // `GROUP BY ()` gives one row, even for no rows at all.
        if (set.length === 0 && groups.size === 0) groups.set('', []);
        for (const [label, groupRows] of groups) {
            const result = await prepared.run({ groupRows });
            interpreted.set(
                label,
                result.ok ? { ok: true, value: result.value } : { ok: false, kind: errorKind(result.error.message), message: result.error.message }
            );
        }
    }

    // Postgres: one statement over a VALUES list.
    const fragment = prepared.compileGroupExpression({ column: name => `b.${quoteName(name)}` });
    const sql = new Map<string, Outcome>();
    if (!fragment.ok) {
        for (const label of interpreted.keys()) sql.set(label, { ok: false, kind: 'other', message: `${fragment.error.code}: ${fragment.error.message}` });
        return { interpreted, sql };
    }
    const values = (rows.length > 0 ? rows : [{}]).map(row => `(${columns.map(col => valueSql(row[col.name], col.base)).join(', ')})`);
    const names = columns.map(col => quoteName(col.name)).join(', ');
    const keyItems = keys.flatMap((k, i) => [`b.${quoteName(k)} AS "k${i}"`, `GROUPING(b.${quoteName(k)}) AS "g${i}"`]);
    const groupingSets = sets.map(set => `(${set.map(k => `b.${quoteName(k)}`).join(', ')})`).join(', ');
    const text =
        `SELECT ${[...keyItems, `${fragment.sql} AS "v"`].join(', ')} FROM (VALUES ${values.join(', ')}) AS b(${names})` +
        `${rows.length > 0 ? '' : ' WHERE FALSE'} GROUP BY GROUPING SETS (${groupingSets})`;
    try {
        for (const row of await db.query(text)) {
            const present = keys.filter((_k, i) => Number(row[`g${i}`]) === 0);
            const label = groupLabel(present, Object.fromEntries(present.map(k => [k, row[`k${keys.indexOf(k)}`]])));
            sql.set(label, { ok: true, value: row.v });
        }
    } catch (e) {
        const message = (e as Error).message;
        for (const label of interpreted.keys()) sql.set(label, { ok: false, kind: errorKind(message), message });
    }
    return { interpreted, sql, sqlText: text };
}

/** Runs one group case and throws when the runtimes disagree on a group, or both disagree with `expect`. */
async function checkGroupCase(db: TestDatabase, c: DifferentialCase & { group: GroupSpec }): Promise<void> {
    const { interpreted, sql, sqlText } = await groupAnswers(db, c);
    const labels = [...new Set([...interpreted.keys(), ...sql.keys()])].sort();
    const missing: Outcome = { ok: false, kind: 'other', message: 'no such group' };
    const lines = labels.map(l => `  [${l}] interpreter: ${showOutcome(interpreted.get(l) ?? missing)} | postgres: ${showOutcome(sql.get(l) ?? missing)}`);
    const report = `${c.expr}\n${lines.join('\n')}${sqlText ? `\n  sql: ${sqlText}` : ''}`;
    const agree = labels.every(l => sameOutcome(interpreted.get(l) ?? missing, sql.get(l) ?? missing));
    if (c.knownGap) {
        if (agree) throw new Error(`gap fixed? remove knownGap (${c.knownGap.card}: ${c.knownGap.note})\n${report}`);
        return;
    }
    if (!agree) throw new Error(`the runtimes disagree\n${report}`);
    if ('expect' in c) {
        const expected = c.expect as Record<string, unknown>;
        // Postgres's answer is the one to compare: a `Decimal` equals a number by its exact text.
        const wrong = Object.keys(expected).length !== labels.length || labels.some(l => !(l in expected) || !matchesExpectation(sql.get(l)!, expected[l]));
        if (wrong) throw new Error(`both runtimes agree, but not with the expected answers ${JSON.stringify(expected)}\n${report}`);
    }
}

function matchesExpectation(outcome: Outcome, expected: unknown): boolean {
    if (isErrorExpectation(expected)) return !outcome.ok && outcome.kind === expected.error;
    return outcome.ok && sameValue(outcome.value, expected);
}

/** Runs one case and throws when it fails. */
export async function checkCase(db: TestDatabase, c: DifferentialCase): Promise<void> {
    if (c.group) return await checkGroupCase(db, c as DifferentialCase & { group: GroupSpec });
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
