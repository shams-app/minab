import { AstUtils, EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import { isFunctionDecl, isQuery, type FunctionDecl, type Model } from '../src/language/generated/ast.js';
import { createMinabServices } from '../src/language/minab-module.js';
import { inlineBlocker } from '../src/language/minab-query-inlining.js';
import { parseConfig } from '../src/host/config.js';
import { createMinab } from '../src/runtime/index.js';

/**
 * Production plan phase C10: kind tests are checked (D47), and a user function that reads
 * the record is not inlined into a query. The Postgres answers are in
 * `test/differential/cases/c10-literals.cases.ts` and `test/queries/cases/c10-literals.cases.ts`.
 */

const { schema } = parseConfig({
    schema: {
        tables: [
            {
                name: 'Customer',
                primaryKey: 'id',
                columns: { id: 'INTEGER', name: 'TEXT', orders: { collection: 'Order', foreignKey: 'customer_id' } }
            },
            {
                name: 'Order',
                primaryKey: 'id',
                columns: {
                    id: 'INTEGER',
                    customer: { ref: 'Customer', foreignKey: 'customer_id' },
                    a: 'INTEGER',
                    n: 'INTEGER?',
                    total: 'DECIMAL',
                    s: 'TEXT',
                    yes: 'BOOLEAN',
                    meta: 'JSON?'
                }
            }
        ]
    }
});

const minab = createMinab({ schema, ruleContext: { recordTable: 'Order', isFieldRule: false } });

const errorsOf = async (source: string) => (await minab.prepare(source)).diagnostics.filter(d => d.severity === 'error');
const codesOf = async (source: string): Promise<string[]> => (await errorsOf(source)).map(d => d.code);

describe('kind tests need a JSON value (D47)', () => {
    test('is number on a DECIMAL column is type.kindTestNeedsJson, and the message names the type', async () => {
        const [error, ...rest] = await errorsOf('.total is number');
        expect(rest).toEqual([]);
        expect(error.code).toBe('type.kindTestNeedsJson');
        expect(error.message).toBe('"is number" tests the kind of a JSON value, but .total is DECIMAL');
    });

    test.each([
        ['.a is array', 'INTEGER'],
        ['.s is string', 'TEXT'],
        ['.yes isnot boolean', 'BOOLEAN'],
        ['.n is number', 'INTEGER?'],
        ['TODAY() is string', 'DATE'],
        ['"a" is string', 'TEXT'],
        ['1 is number', 'INTEGER'],
        ['.customer.orders is array', 'collection<Order>'],
        ['[1, 2] is array', 'INTEGER[]']
    ])('%s is an error (the operand is %s)', async (source, actual) => {
        const errors = await errorsOf(source);
        expect(errors.map(d => d.code)).toEqual(['type.kindTestNeedsJson']);
        expect(errors[0].message).toContain(`is ${actual}`);
    });

    test('is null and isnot null work on every type', async () => {
        expect(await codesOf('.n isnot null')).toEqual([]);
        expect(await codesOf('.total is null')).toEqual([]);
        expect(await codesOf('.s isnot null AND .yes isnot null')).toEqual([]);
    });

    test('a JSON column, a JSON local and a JSON literal keep the run-time test', async () => {
        expect(await codesOf('.meta is array')).toEqual([]);
        expect(await codesOf('.meta isnot object')).toEqual([]);
        expect(await codesOf('let config: JSON = { theme: "dark" };\nconfig is object')).toEqual([]);
        expect(await codesOf('{ a: 1 } is object')).toEqual([]);
        expect(await codesOf('FROM Order WHERE .meta is array SELECT .id')).toEqual([]);
    });

    test('inside a query the same rule holds', async () => {
        expect(await codesOf('FROM Order WHERE .total is number SELECT .id')).toEqual(['type.kindTestNeedsJson']);
    });
});

describe('literal-only parts get their type in SQL (C10)', () => {
    const sqlOf = async (source: string): Promise<string> => {
        const compiled = (await minab.prepare(source)).compile();
        if (!compiled.ok) throw new Error(compiled.error.message);
        return compiled.sql.text;
    };

    test('two literals are typed; a literal next to a column is not', async () => {
        expect(await sqlOf('FROM Order WHERE .a > 1 + 2 SELECT .id')).toContain('"Order"."a" > ($1::bigint + $2::bigint)');
        expect(await sqlOf('FROM Order WHERE .a > 3 SELECT .id')).toMatch(/"Order"\."a" > \$1$/);
    });

    test('a decimal literal is numeric, a text literal is text', async () => {
        expect(await sqlOf('FROM Order SELECT .total * (1 + 0.2) AS g')).toContain('($1::bigint + $2::numeric)');
        expect(await sqlOf('FROM Order WHERE "a" < "b" SELECT .id')).toContain('$1::text < $2::text');
    });

    test('-5 stays one number, and gets its type next to another literal', async () => {
        expect(await sqlOf('FROM Order WHERE .a > -5 SELECT .id')).toMatch(/"Order"\."a" > \$1$/);
        expect(await sqlOf('FROM Order WHERE .a > -1 + 2 SELECT .id')).toContain('($1::bigint + $2::bigint)');
    });
});

describe('a function that reads the record is not inlined into a query (C10)', () => {
    test('a function that reads "." is query.functionNotInlinable, and says why', async () => {
        const errors = await errorsOf('fn big(): BOOLEAN { .total > 10 }\nFROM Order SELECT .id, big() AS b');
        expect(errors.map(d => d.code)).toEqual(['query.functionNotInlinable']);
        expect(errors[0].message).toContain('it reads "."');
    });

    test('the compiler refuses it with the same code', async () => {
        // `compile()` refuses a program with check errors, so the compiler is called directly.
        const services = createMinabServices(EmptyFileSystem, schema).Minab;
        const document = await parseHelper<Model>(services)('fn big(): BOOLEAN { .total > 10 }\nFROM Order SELECT .id, big() AS b');
        const query = AstUtils.streamAst(document.parseResult.value).find(isQuery);
        expect(services.sqlCompiler.compileQuery(query!)).toMatchObject({ ok: false, code: 'query.functionNotInlinable' });
    });

    test('"^" and "#alias" are refused too', async () => {
        expect(await codesOf('fn up(): BOOLEAN { ^.total > 10 }\nFROM Order SELECT .id, up() AS b')).toContain('query.functionNotInlinable');
        expect(await codesOf('fn any(): BOOLEAN { EXISTS(#Order[.total > 10]) }\nFROM Order SELECT .id, any() AS b')).toContain('query.functionNotInlinable');
    });

    test('a function that calls one that reads "." is refused', async () => {
        const program = 'fn big(): BOOLEAN { .total > 10 }\nfn wrap(): BOOLEAN { big() }\nFROM Order SELECT .id, wrap() AS b';
        const errors = await errorsOf(program);
        expect(errors.map(d => d.code)).toEqual(['query.functionNotInlinable']);
        expect(errors[0].message).toContain('it calls "big", and it reads "."');
    });

    test('a function that reads only its parameters is still inlined', async () => {
        const prepared = await minab.prepare('fn gross(t: DECIMAL): DECIMAL { t * 1.2 }\nFROM Order SELECT gross(.total) AS g');
        expect(prepared.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
        expect(prepared.compile().ok).toBe(true);
    });

    test('outside a query a function may read "."', async () => {
        expect(await codesOf('fn big(): BOOLEAN { .total > 10 }\nbig()')).toEqual([]);
    });

    test('"." inside a filter of the body is the element, not the record', async () => {
        const parse = parseHelper<Model>(createMinabServices(EmptyFileSystem, schema).Minab);
        const decl = async (source: string): Promise<FunctionDecl> => {
            const document = await parse(source);
            const found = AstUtils.streamAst(document.parseResult.value).find(isFunctionDecl);
            if (!found) throw new Error('no function');
            return found;
        };
        const noHost = () => false;
        expect(inlineBlocker(await decl('fn f(xs: INTEGER[]): INTEGER[] { xs[. > 1] }'), noHost)).toBeUndefined();
        expect(inlineBlocker(await decl('fn f(xs: INTEGER[]): INTEGER[] { xs[. > ^.a] }'), noHost)).toContain('"^"');
    });
});
