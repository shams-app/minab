import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Decimal, openTestDatabase, type TestDatabase } from '../support/database.js';
import { errorKind, sameOutcome, sameValue, type Outcome } from '../support/minab.js';
import { checkCase, ITEM_SCHEMA as schema } from './harness.js';

/** The harness must fail when it should. These cases are not in `cases/`, because they are made to fail. */
let db: TestDatabase;

beforeAll(async () => {
    db = await openTestDatabase();
}, 60000);

afterAll(async () => {
    await db?.close();
});

describe('the differential harness', () => {
    test('a case with the right answer passes', async () => {
        await checkCase(db, { name: 'ok', schema, record: { a: 2, b: 3 }, expr: '.a + .b', expect: 5 });
    });

    test('a wrong `expect` fails and shows both answers', async () => {
        await expect(checkCase(db, { name: 'wrong', schema, record: { a: 2, b: 3 }, expr: '.a + .b', expect: 6 })).rejects.toThrow(
            /not with the expected answer 6[\s\S]*interpreter: 5[\s\S]*postgres:\s+5/
        );
    });

    test('a knownGap case that agrees fails with "gap fixed?"', async () => {
        await expect(
            checkCase(db, { name: 'fixed', schema, record: { a: 2, b: 3 }, expr: '.a + .b', knownGap: { card: 'C0', note: 'not a gap' } })
        ).rejects.toThrow(/gap fixed\? remove knownGap/);
    });

    test('a knownGap case that really differs passes', async () => {
        // No real gap is left to use here (C9 fixed the last one), so the database is made to answer wrong.
        const wrong: TestDatabase = {
            kind: db.kind,
            exec: sql => db.exec(sql),
            query: (text, params) => db.query(text, params),
            queryResult: (text, params) => db.queryResult(text, params),
            executor: { execute: async q => (await db.executor.execute(q)).map(row => ({ ...row, v: 99 })) },
            isolated: (setupSql, fn) => db.isolated(setupSql, fn),
            close: () => db.close()
        };
        await checkCase(wrong, { name: 'gap', schema, record: { a: 2, b: 3 }, expr: '.a + .b', knownGap: { card: 'C0', note: 'a wrong database' } });
    });

    test('two errors of the same meaning agree, two of different meaning do not', () => {
        const zero = (message: string): Outcome => ({ ok: false, kind: errorKind(message), message });
        expect(sameOutcome(zero('division by zero'), zero('Division by zero'))).toBe(true);
        expect(sameOutcome(zero('division by zero'), zero('expected a number'))).toBe(false);
        expect(sameOutcome(zero('division by zero'), { ok: true, value: null })).toBe(false);
    });

    test('decimals compare by exact value', () => {
        expect(sameValue(0.30000000000000004, new Decimal('0.3'))).toBe(false);
        expect(sameValue(0.3, new Decimal('0.30'))).toBe(true);
        expect(sameValue(null, null)).toBe(true);
    });
});
