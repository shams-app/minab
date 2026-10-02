import { describe, expect, test } from 'vitest';
import type { Row } from '../../src/language/minab-executor.js';
import type { TestDatabase } from '../support/database.js';
import { loadSchema, plainRow, type SchemaSpec } from '../support/minab.js';

/** A whole Minab query, run on Postgres. */
export interface QueryCase {
    name: string;
    /** The host schema, as a JSON config writes it. */
    schema: SchemaSpec;
    /** Rows to insert, by table name. */
    rows: Record<string, Row[]>;
    /** The Minab program (a query). */
    program: string;
    /** The rows it must return. Column order does not matter. */
    expectRows: Row[];
    /** Set when the order of `expectRows` matters (use it with `ORDERBY`). */
    ordered?: boolean;
    /** A known bug: the rows differ today. The card that fixes it removes this. */
    knownGap?: { card: string; note: string };
}

/** Parses, checks, compiles and runs the program. Returns the rows. */
export async function runQuery(db: TestDatabase, c: QueryCase): Promise<{ rows: Row[]; errors: string[]; sqlText?: string }> {
    const loaded = loadSchema(c.schema);
    return await db.isolated(loaded.script(c.rows), async () => {
        const { model, errors } = await loaded.parse(c.program);
        let sqlText: string | undefined;
        const spy = {
            execute: async (q: { text: string; params: unknown[] }) => {
                sqlText = q.text;
                return await db.executor.execute(q);
            }
        };
        const result = await loaded.run(model, spy);
        if (!result.ok) throw new Error(`could not run the program: ${result.reason}`);
        return { rows: result.value as Row[], errors, sqlText };
    });
}

function shown(rows: Row[]): string {
    return JSON.stringify(rows, (_key, v) => (typeof v === 'bigint' ? Number(v) : v));
}

function sameRows(actual: Row[], expected: Row[], ordered: boolean): boolean {
    const a = actual.map(plainRow);
    const b = expected.map(plainRow);
    if (!ordered) {
        a.sort();
        b.sort();
    }
    return a.length === b.length && a.every((row, i) => row === b[i]);
}

/** Registers one test per case. Case files are listed by `queries.test.ts`. */
export function defineQueryCases(file: string, cases: QueryCase[], database: () => TestDatabase): void {
    describe(file, () => {
        for (const c of cases) {
            test(c.name + (c.knownGap ? ` [known gap, ${c.knownGap.card}]` : ''), async () => {
                const { rows, errors, sqlText } = await runQuery(database(), c);
                const report = `${c.program.trim()}\n  rows:     ${shown(rows)}\n  expected: ${shown(c.expectRows)}${sqlText ? `\n  sql: ${sqlText}` : ''}`;
                expect(errors, `check must be clean\n${report}`).toEqual([]);
                const agree = sameRows(rows, c.expectRows, c.ordered ?? false);
                if (c.knownGap) {
                    if (agree) expect.fail(`gap fixed? remove knownGap (${c.knownGap.card}: ${c.knownGap.note})\n${report}`);
                    return;
                }
                if (!agree) expect.fail(`the rows are not the expected rows\n${report}`);
            });
        }
    });
}
