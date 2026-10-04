import { describe, expect, test } from 'vitest';
import { createMinab } from '../src/runtime/index.js';
import { orderSchema } from './support/runtime.js';

/**
 * Production plan phase X2: `KEY` over several `GROUPBY` keys (D22) and user functions inside a query (D23).
 * The rows come from Postgres in `test/queries/cases/x2-multikey-functions.cases.ts`. These tests are about `check` and the SQL text.
 */

const minab = createMinab({
    schema: orderSchema(),
    ruleContext: { recordTable: 'Order', isFieldRule: false },
    functions: [
        {
            name: 'fxRate',
            params: [{ name: 'a', type: 'DECIMAL' }],
            returns: 'DECIMAL'
        }
    ]
});

const codesOf = async (source: string): Promise<string[]> => (await minab.prepare(source)).diagnostics.filter(d => d.severity === 'error').map(d => d.code);

describe('KEY over several GROUPBY keys (D22)', () => {
    test('KEY.<name> reads a key named by AS or by the last field of a plain path', async () => {
        expect(await codesOf('FROM Order GROUPBY .status, .total AS t SELECT KEY.status AS s, KEY.t AS x, COUNT(.) AS n')).toEqual([]);
    });

    test('KEY.<name> has the type of that key', async () => {
        // `KEY.status` is TEXT, so comparing it with a number is a type error.
        expect(await codesOf('FROM Order GROUPBY .status, .total AS t HAVING KEY.status == 1 SELECT COUNT(.) AS n')).not.toEqual([]);
        expect(await codesOf('FROM Order GROUPBY .status, .total AS t HAVING KEY.t > 1 SELECT COUNT(.) AS n')).toEqual([]);
    });

    test('a computed key with no name is query.unnamedGroupKey', async () => {
        expect(await codesOf('FROM Order GROUPBY .status, .total + 1 SELECT COUNT(.) AS n')).toEqual(['query.unnamedGroupKey']);
        expect(await codesOf('FROM Order GROUPBY .status, .total + 1 AS t SELECT COUNT(.) AS n')).toEqual([]);
    });

    test('one key: a computed key needs no name, and KEY is the key', async () => {
        expect(await codesOf('FROM Order GROUPBY .total + 1 SELECT KEY AS k, COUNT(.) AS n')).toEqual([]);
    });

    test('a bare KEY, or a name no key has, is query.keyNeedsName', async () => {
        expect(await codesOf('FROM Order GROUPBY .status, .total AS t SELECT KEY AS k')).toEqual(['query.keyNeedsName']);
        expect(await codesOf('FROM Order GROUPBY .status, .total AS t SELECT KEY.nope AS k')).toEqual(['query.keyNeedsName']);
    });

    test('two keys with the same name are refused', async () => {
        expect(await codesOf('FROM Order GROUPBY .status, .total AS status SELECT COUNT(.) AS n')).toEqual(['query.duplicateGroupKeyName']);
    });

    test('the SQL uses each key once, with the same parameters in GROUP BY and in SELECT', async () => {
        const compiled = (await minab.prepare('FROM Order GROUPBY .status, .total + 1 AS b SELECT KEY.status AS s, KEY.b AS b2')).compile();
        expect(compiled.ok).toBe(true);
        if (!compiled.ok) return;
        const text = compiled.sql.text;
        expect(text).toContain('GROUP BY "Order"."status", ("Order"."total" + $1)');
        expect(text).toContain('("Order"."total" + $1) AS "b2"');
    });
});

describe('user functions inside a query (D23)', () => {
    const simple = 'fn net(t: DECIMAL): DECIMAL { t * 0.9 }\n';

    test('a simple function is inlined: the SQL has no call to it', async () => {
        const compiled = (await minab.prepare(`${simple}FROM Order WHERE net(.total) > 100 SELECT .id`)).compile();
        expect(compiled.ok).toBe(true);
        if (!compiled.ok) return;
        expect(compiled.sql.text).not.toContain('net(');
        expect(compiled.sql.text).toContain('(("Order"."total") * ');
    });

    test('a function with a let is query.functionNotInlinable, with the reason', async () => {
        const program = 'fn f(t: DECIMAL): DECIMAL { let a: DECIMAL = t; a }\nFROM Order WHERE f(.total) > 1 SELECT .id';
        const diagnostics = (await minab.prepare(program)).diagnostics.filter(d => d.severity === 'error');
        expect(diagnostics.map(d => d.code)).toEqual(['query.functionNotInlinable']);
        expect(diagnostics[0].message).toContain('it has statements');
    });

    test('a recursive function, direct or through another one, is query.functionNotInlinable', async () => {
        expect(await codesOf('fn f(t: INTEGER): INTEGER { f(t) }\nFROM Order WHERE f(1) > 1 SELECT .id')).toEqual(['query.functionNotInlinable']);
        const mutual = 'fn a(t: INTEGER): INTEGER { b(t) }\nfn b(t: INTEGER): INTEGER { a(t) }\nFROM Order WHERE a(1) > 1 SELECT .id';
        expect(await codesOf(mutual)).toEqual(['query.functionNotInlinable']);
    });

    test('a function that calls a function with statements is refused', async () => {
        const program = 'fn g(t: INTEGER): INTEGER { let a: INTEGER = t; a }\nfn f(t: INTEGER): INTEGER { g(t) }\nFROM Order WHERE f(1) > 1 SELECT .id';
        expect(await codesOf(program)).toEqual(['query.functionNotInlinable']);
    });

    test('a function that calls a host function is refused', async () => {
        const program = 'fn f(t: DECIMAL): DECIMAL { fxRate(t) }\nFROM Order WHERE f(.total) > 1 SELECT .id';
        expect(await codesOf(program)).toEqual(['query.functionNotInlinable']);
    });

    test('a function whose body is a query is refused', async () => {
        const program = 'fn f(t: DECIMAL): JSON { FROM Order SELECT .id }\nFROM Order SELECT f(.total) AS x';
        expect(await codesOf(program)).toContain('query.functionNotInlinable');
    });

    test('outside a query nothing changes: the interpreter runs the function', async () => {
        expect(await codesOf('fn f(t: INTEGER): INTEGER { let a: INTEGER = t; a }\nf(1)')).toEqual([]);
        const compiled = (await minab.prepare('fn f(t: INTEGER): INTEGER { t }\nf(1)')).compile();
        expect(compiled.ok).toBe(false);
    });
});
