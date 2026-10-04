import { AstUtils, EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { isBinaryExpression, isCurrentRecord, isMemberAccess, isQuery, isUnaryExpression, type Model } from '../src/language/generated/ast.js';
import { createMinabServices, type MinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';
import { openTestDatabase, type TestDatabase } from './support/database.js';
import { loadSchema } from './support/minab.js';

/**
 * Production plan phase L4: the language backlog (spec §12) and the decisions D14, D22, D24, D25.
 * Each test pins one answer, so a later change has to say it changes the language.
 */

const schema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'country', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'orders', type: { kind: 'collection', table: 'Order', foreignKey: 'customer_id' } }
            ]
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: true, foreignKey: 'customer_id' } },
                { name: 'status', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'total', type: { kind: 'scalar', type: scalarType('DECIMAL') } }
            ]
        }
    ]
};

let order: MinabServices;
let customer: MinabServices;
let parseOrder: ReturnType<typeof parseHelper<Model>>;
let parseCustomer: ReturnType<typeof parseHelper<Model>>;

beforeAll(() => {
    order = createMinabServices(EmptyFileSystem, schema, { isFieldRule: false, recordTable: 'Order' }).Minab;
    customer = createMinabServices(EmptyFileSystem, schema, { isFieldRule: false, recordTable: 'Customer' }).Minab;
    parseOrder = parseHelper<Model>(order);
    parseCustomer = parseHelper<Model>(customer);
});

type Parse = typeof parseOrder;

/** Every error of a program: parser errors, then validation errors, as `[code, message]`. */
async function errors(source: string, parse: Parse = parseOrder): Promise<Array<[string | undefined, string]>> {
    const document = await parse(source, { validation: true });
    const text = (m: unknown) => (typeof m === 'string' ? m : String((m as { value: string }).value));
    return [
        ...document.parseResult.parserErrors.map((e): [string | undefined, string] => [undefined, e.message]),
        ...(document.diagnostics ?? []).filter(d => d.severity === 1).map((d): [string | undefined, string] => [d.code as string | undefined, text(d.message)])
    ];
}

const codesOf = async (source: string, parse: Parse = parseOrder) => (await errors(source, parse)).map(([code]) => code);

describe('§12 items 1–4 (D24): confirmed answers', () => {
    test('item 2: NOT x == y parses as NOT (x == y)', async () => {
        const document = await parseOrder('NOT .status == "a"');
        const root = document.parseResult.value.tail;
        expect(isUnaryExpression(root) && root.negated).toBe(true);
        const operand = isUnaryExpression(root) ? root.operand : undefined;
        expect(isBinaryExpression(operand) && operand.operator).toBe('==');
    });

    test('item 3: comparisons do not chain, a < b < c is an error', async () => {
        expect((await errors('1 < 2 < 3')).length).toBeGreaterThan(0);
        expect((await errors('.status IN ["a"] IN ["b"]')).length).toBeGreaterThan(0);
        expect(await errors('(1 < 2) == true')).toEqual([]);
    });

    test('item 1: .orders.total is CurrentRecord(field: orders) then MemberAccess(member: total)', async () => {
        const document = await parseCustomer('.orders.total');
        const root = document.parseResult.value.tail;
        expect(isMemberAccess(root) && root.member).toBe('total');
        const receiver = isMemberAccess(root) ? root.receiver : undefined;
        expect(isCurrentRecord(receiver) && receiver.field).toBe('orders');
    });

    test('item 4: [...] is a list in value position and a filter after a collection', async () => {
        const document = await parseCustomer('.country IN ["US", "DE"] AND COUNT(.orders[.status == "x"]) > 0');
        expect(document.parseResult.parserErrors).toEqual([]);
        const nodes = [...AstUtils.streamAst(document.parseResult.value)].map(n => n.$type);
        expect(nodes).toContain('ListLiteral');
        expect(nodes).toContain('FilterAccess');
    });
});

describe('§12 item 8: a second let with the same name', () => {
    test('is scope.duplicateLet in the same scope', async () => {
        expect(await codesOf('let x: INTEGER = 1;\nlet x: INTEGER = 2;\nx')).toContain('scope.duplicateLet');
    });

    test('is also an error in a function body and in a block', async () => {
        expect(await codesOf('fn f(a: INTEGER): INTEGER { let y: INTEGER = 1; let y: INTEGER = 2; y }')).toContain('scope.duplicateLet');
        expect(await codesOf('if true { let y: INTEGER = 1; let y: INTEGER = 2; y } else { 0 }')).toContain('scope.duplicateLet');
    });

    test('an inner block may shadow, and the inner value is used', async () => {
        // A block checks clean; a function body is the inner scope the interpreter runs today.
        expect(await errors('let x: INTEGER = 1;\nif true { let x: INTEGER = 3; x } else { x }')).toEqual([]);
        const source = 'let x: INTEGER = 1;\nfn f(a: INTEGER): INTEGER { let x: INTEGER = 3; x }\nf(0) + x';
        expect(await errors(source)).toEqual([]);
        const loaded = loadSchema({ tables: [{ name: 'One', primaryKey: 'id', columns: { id: 'INTEGER' } }] });
        const program = await loaded.parse(source);
        const result = await loaded.run(program.model, { execute: async () => [] });
        expect(result).toEqual({ ok: true, value: 4 });
    });
});

describe('§12 item 17: ! on a collection step', () => {
    test('.orders!.total = 1; is type.vivifyOnCollection', async () => {
        expect(await codesOf('.orders!.total = 1;', parseCustomer)).toContain('type.vivifyOnCollection');
    });

    test('! on a ref step is fine', async () => {
        expect(await codesOf('.customer!.country = "US";')).not.toContain('type.vivifyOnCollection');
    });
});

describe('D25: a relation is compared through its key (long form only)', () => {
    test('.customer == "cus-ada" names the long form', async () => {
        const found = await errors('FROM Order WHERE .customer == "cus-ada" SELECT .id');
        expect(found).toEqual([['type.relationComparedToKey', expect.stringContaining('`.customer.id`')]]);
    });

    test('!=, the reversed order and IN are refused the same way', async () => {
        expect(await codesOf('FROM Order WHERE .customer != "cus-ada" SELECT .id')).toEqual(['type.relationComparedToKey']);
        expect(await codesOf('FROM Order WHERE "cus-ada" == .customer SELECT .id')).toEqual(['type.relationComparedToKey']);
        expect(await codesOf('FROM Order WHERE .customer IN ["a", "b"] SELECT .id')).toEqual(['type.relationComparedToKey']);
    });

    test('.customer.id == "cus-ada" and a test against null still check', async () => {
        expect(await errors('FROM Order WHERE .customer.id == "cus-ada" SELECT .id')).toEqual([]);
        expect(await errors('FROM Order WHERE .customer.id IN ["a", "b"] SELECT .id')).toEqual([]);
        expect(await errors('FROM Order WHERE .customer != null SELECT .id')).toEqual([]);
    });
});

describe('D25: the long form runs', () => {
    let db: TestDatabase;
    beforeAll(async () => {
        db = await openTestDatabase();
    });
    afterAll(async () => {
        await db.close();
    });

    test('.customer.id == "cus-ada" finds the same rows as the key says, and IN works too', async () => {
        const loaded = loadSchema({
            tables: [
                { name: 'Customer', primaryKey: 'id', columns: { id: 'TEXT' } },
                { name: 'Order', primaryKey: 'id', columns: { id: 'INTEGER', customer: { ref: 'Customer', foreignKey: 'customer_id' } } }
            ]
        });
        const rows = {
            Customer: [{ id: 'cus-ada' }, { id: 'cus-bo' }],
            Order: [
                { id: 1, customer_id: 'cus-ada' },
                { id: 2, customer_id: 'cus-bo' },
                { id: 3, customer_id: null }
            ]
        };
        await db.isolated(loaded.script(rows), async () => {
            const run = async (source: string) => {
                const program = await loaded.parse(source);
                expect(program.errors).toEqual([]);
                return await loaded.run(program.model, db.executor);
            };
            expect(await run('FROM Order WHERE .customer.id == "cus-ada" SELECT .id')).toEqual({ ok: true, value: [{ id: 1 }] });
            expect(await run('FROM Order WHERE .customer.id IN ["cus-ada", "cus-bo"] SELECT .id ORDERBY .id')).toEqual({
                ok: true,
                value: [{ id: 1 }, { id: 2 }]
            });
        });
    });
});

describe('D22: GROUPBY keys may have a name', () => {
    const compile = async (source: string) => {
        const document = await parseOrder(source, { validation: true });
        expect(document.parseResult.parserErrors.map(e => e.message)).toEqual([]);
        const query = AstUtils.streamAst(document.parseResult.value).find(isQuery)!;
        const result = order.sqlCompiler.compileQuery(query);
        if (!result.ok) throw new Error(result.reason);
        return result.query.text;
    };

    test('GROUPBY .status AS s compiles like GROUPBY .status', async () => {
        const named = await compile('FROM Order GROUPBY .status AS s SELECT KEY AS status, COUNT(.) AS n');
        const plain = await compile('FROM Order GROUPBY .status SELECT KEY AS status, COUNT(.) AS n');
        expect(named).toBe(plain);
        expect(await errors('FROM Order GROUPBY .status AS s SELECT KEY AS status, COUNT(.) AS n')).toEqual([]);
    });

    test('a second key keeps working and the names may be mixed with plain keys', async () => {
        expect(await errors('FROM Order GROUPBY .status AS s, .customer.country SELECT COUNT(.) AS n')).toEqual([]);
    });

    test('two keys with the same name are query.duplicateGroupKeyName', async () => {
        expect(await codesOf('FROM Order GROUPBY .status AS s, .total AS s SELECT COUNT(.) AS n')).toContain('query.duplicateGroupKeyName');
    });
});

describe('D14: the \\ operator (integer division)', () => {
    test('has the type INTEGER, for INTEGER and DECIMAL operands, and is nullable when a side is', async () => {
        const typeOf = async (source: string) => {
            const document = await parseOrder(source);
            const result = order.typeChecker.inferType(document.parseResult.value.tail as never);
            return result.ok ? result.type : result;
        };
        expect(await typeOf('7 \\ 2')).toMatchObject({ kind: 'scalar', base: 'INTEGER', nullable: false });
        expect(await typeOf('7.9 \\ 2')).toMatchObject({ kind: 'scalar', base: 'INTEGER' });
        expect(await typeOf('.total \\ 2')).toMatchObject({ kind: 'scalar', base: 'INTEGER' });
    });

    test('a text operand is a type error', async () => {
        expect(await codesOf('"a" \\ 2')).toContain('type.arithmeticNeedsNumeric');
    });

    test('has the precedence of *, so 1 + 7 \\ 2 is 1 + (7 \\ 2) and 8 \\ 2 * 2 is (8 \\ 2) * 2', async () => {
        const loaded = loadSchema({ tables: [{ name: 'One', primaryKey: 'id', columns: { id: 'INTEGER' } }] });
        const run = async (source: string) =>
            (await loaded.run((await loaded.parse(source)).model, { execute: async () => [] })) as { ok: boolean; value: unknown };
        expect((await run('1 + 7 \\ 2')).value).toBe(4);
        expect((await run('8 \\ 2 * 2')).value).toBe(8);
        expect((await run('7 \\ 2')).value).toBe(3);
        expect((await run('-7 \\ 2')).value).toBe(-3);
        expect((await run('7.9 \\ 2')).value).toBe(3);
        expect(await run('5 \\ 0')).toMatchObject({ ok: false, code: 'eval.divisionByZero' });
        expect(await run('9007199254740991 \\ 0.5')).toMatchObject({ ok: false, code: 'eval.integerOutOfRange' });
    });

    test('a backslash in a string or a backtick name still parses as before', async () => {
        const document = await parseOrder('let s: TEXT = "a\\\\b";\n.status == "x\\"y" AND `we\\\\ird` == 1');
        expect(document.parseResult.parserErrors.map(e => e.message)).toEqual([]);
        expect(document.parseResult.lexerErrors).toEqual([]);
    });

    test('a lone backslash that is not between two operands is a parse error', async () => {
        expect((await errors('\\ 2')).length).toBeGreaterThan(0);
    });
});

describe('§5.4: a query used as a scalar needs no LIMIT 1', () => {
    let db: TestDatabase;
    beforeAll(async () => {
        db = await openTestDatabase();
    });
    afterAll(async () => {
        await db.close();
    });

    test('one row gives its value, no row gives null, several rows are a database error', async () => {
        const loaded = loadSchema({ tables: [{ name: 'Order', primaryKey: 'id', columns: { id: 'INTEGER', total: 'DECIMAL' } }] });
        await db.isolated(
            loaded.script({
                Order: [
                    { id: 1, total: 5 },
                    { id: 2, total: 7 }
                ]
            }),
            async () => {
                const run = async (source: string) => {
                    const program = await loaded.parse(source);
                    expect(program.errors).toEqual([]);
                    return await loaded.run(program.model, db.executor);
                };
                expect(await run('let t: DECIMAL = (FROM Order WHERE .id == 1 SELECT .total); t')).toMatchObject({ ok: true });
                expect(await run('let t: DECIMAL? = (FROM Order WHERE .id == 9 SELECT .total); t')).toEqual({ ok: true, value: null });
                // Not "the first row": Postgres refuses, and the error reaches the caller (the runtime reports it as data.error).
                await expect(run('let t: DECIMAL = (FROM Order SELECT .total); t')).rejects.toThrow(/more than one row/);
            }
        );
    });
});
