import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Model, Query } from '../src/language/generated/ast.js';
import { isQuery } from '../src/language/generated/ast.js';
import { createMinabServices } from '../src/language/minab-module.js';
import type { MinabSqlCompiler } from '../src/language/minab-sql-compiler.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';

/**
 * Phase 5's SQL codegen, checked the way `docs/roadmap.md` Phase 5 asks
 * for: generated SQL diffed against hand-written expected SQL, so a change
 * in what we emit has to be stated, not just observed to still run.
 */

// `primaryKey`/`foreignKey` are the Phase 5 additions to the host schema
// contract: without them nothing can say which column joins two tables, or
// which one identifies a row (spec §6.1's `. != ^`).
const fixtureSchema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'name', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'country', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'email', type: { kind: 'scalar', type: scalarType('CITEXT') } },
                { name: 'orders', type: { kind: 'collection', table: 'Order', foreignKey: 'customer_id' } }
            ]
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: true, foreignKey: 'customer_id' } },
                { name: 'total', type: { kind: 'scalar', type: scalarType('DECIMAL') } },
                { name: 'status', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'tracking_code', type: { kind: 'scalar', type: scalarType('TEXT') } }
            ]
        },
        {
            name: 'Shipment',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'tracking_code', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'status', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'delivered_at', type: { kind: 'scalar', type: scalarType('DATETIME') } }
            ]
        },
        {
            name: 'Warehouse',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'name', type: { kind: 'scalar', type: scalarType('TEXT') } }
            ]
        },
        {
            name: 'Unlinked',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'owner', type: { kind: 'ref', table: 'Customer', nullable: true } }
            ]
        }
    ],
    functions: []
};

let parse: ReturnType<typeof parseHelper<Model>>;
let compiler: MinabSqlCompiler;

beforeAll(() => {
    const services = createMinabServices(EmptyFileSystem, fixtureSchema);
    parse = parseHelper<Model>(services.Minab);
    compiler = services.Minab.sqlCompiler;
});

async function queryOf(source: string): Promise<Query> {
    const document = await parse(source);
    expect(document.parseResult.parserErrors.map(e => e.message)).toEqual([]);
    const tail = document.parseResult.value.tail;
    if (!tail || !isQuery(tail)) throw new Error('expected the document to be a query');
    return tail;
}

async function compile(source: string): Promise<{ text: string; params: unknown[] }> {
    const result = compiler.compileQuery(await queryOf(source));
    if (!result.ok) throw new Error(result.reason);
    return result.query;
}

async function compileError(source: string): Promise<string> {
    const result = compiler.compileQuery(await queryOf(source));
    if (result.ok) throw new Error(`expected compilation to fail, got: ${result.query.text}`);
    return result.reason;
}

describe('a FROM/WHERE/SELECT pipeline (spec §4.3)', () => {
    test('filter, project, sort — with a ref traversal on both sides', async () => {
        const { text, params } = await compile(`
            FROM Order
            WHERE .status == "shipped" AND .customer.country == "US"
            SELECT .id, .total, .customer.name AS customer_name
            ORDERBY .total DESC
            LIMIT 20
        `);
        expect(text).toBe(
            'SELECT "Order"."id", "Order"."total", ' +
                '(SELECT "_r0"."name" FROM "Customer" AS "_r0" WHERE "_r0"."id" = "Order"."customer_id") AS "customer_name"' +
                ' FROM "Order"' +
                ' WHERE ("Order"."status" IS NOT DISTINCT FROM $1' +
                ' AND (SELECT "_r1"."country" FROM "Customer" AS "_r1" WHERE "_r1"."id" = "Order"."customer_id") IS NOT DISTINCT FROM $2)' +
                ' ORDER BY "Order"."total" DESC LIMIT 20'
        );
        expect(params).toEqual(['shipped', 'US']);
    });

    test('a join reaches both aliases (spec §4.3)', async () => {
        const { text, params } = await compile(`
            FROM Order AS o
            JOIN Shipment AS s ON o.tracking_code == s.tracking_code
            WHERE s.status == "delivered"
            SELECT o.id, o.total, s.delivered_at AS shipped_at
            ORDERBY o.total DESC
            LIMIT 20
        `);
        expect(text).toBe(
            'SELECT "o"."id", "o"."total", "s"."delivered_at" AS "shipped_at"' +
                ' FROM "Order" AS "o"' +
                ' JOIN "Shipment" AS "s" ON "o"."tracking_code" IS NOT DISTINCT FROM "s"."tracking_code"' +
                ' WHERE "s"."status" IS NOT DISTINCT FROM $1' +
                ' ORDER BY "o"."total" DESC LIMIT 20'
        );
        expect(params).toEqual(['delivered']);
    });

    test('LEFTJOIN and CROSSJOIN keep their SQL spellings', async () => {
        const left = await compile(`FROM Order AS o LEFTJOIN Shipment AS s ON o.id == s.id SELECT o.id`);
        expect(left.text).toContain('LEFT JOIN "Shipment" AS "s"');
        const cross = await compile(`FROM Order AS o CROSSJOIN Warehouse AS w SELECT o.id, w.name`);
        expect(cross.text).toContain('CROSS JOIN "Warehouse" AS "w"');
        expect(cross.text).not.toContain('ON');
    });

    test('SELECT * and SELECT DISTINCT (spec §4.3)', async () => {
        expect((await compile(`FROM Customer SELECT *`)).text).toBe('SELECT * FROM "Customer"');
        expect((await compile(`FROM Order SELECT DISTINCT .customer.country`)).text).toBe(
            'SELECT DISTINCT (SELECT "_r0"."country" FROM "Customer" AS "_r0" WHERE "_r0"."id" = "Order"."customer_id")' + ' FROM "Order"'
        );
    });

    test('an omitted SELECT projects every column', async () => {
        expect((await compile(`FROM Customer WHERE .country == "US"`)).text).toBe(
            'SELECT * FROM "Customer" WHERE "Customer"."country" IS NOT DISTINCT FROM $1'
        );
    });

    test('LIMIT carries OFFSET', async () => {
        expect((await compile(`FROM Customer SELECT .id LIMIT 10 OFFSET 40`)).text).toMatch(/LIMIT 10 OFFSET 40$/);
    });
});

describe('an aggregate GROUPBY/HAVING query (spec §4.3)', () => {
    test('groups by a ref column and reads the group key through it', async () => {
        const { text, params } = await compile(`
            FROM Order
            GROUPBY .customer
            HAVING SUM(.total) > 1000
            SELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count
            ORDERBY total_spent DESC
        `);
        expect(text).toBe(
            'SELECT (SELECT "_r0"."name" FROM "Customer" AS "_r0" WHERE "_r0"."id" = "Order"."customer_id") AS "customer_name",' +
                ' SUM("Order"."total") AS "total_spent",' +
                ' COUNT(*) AS "order_count"' +
                ' FROM "Order"' +
                ' GROUP BY "Order"."customer_id"' +
                ' HAVING SUM("Order"."total") > $1' +
                ' ORDER BY "total_spent" DESC'
        );
        expect(params).toEqual([1000]);
    });

    test('groups by a field behind a relation with one LEFT JOIN, so GROUP BY and SELECT agree', async () => {
        const { text } = await compile(`
            FROM Order
            GROUPBY .customer.country
            SELECT KEY AS country, SUM(.total) AS revenue
        `);
        expect(text).toBe(
            'SELECT "_g0"."country" AS "country", SUM("Order"."total") AS "revenue"' +
                ' FROM "Order"' +
                ' LEFT JOIN "Customer" AS "_g0" ON "_g0"."id" = "Order"."customer_id"' +
                ' GROUP BY "_g0"."country"'
        );
    });

    test('an aggregate over a related collection becomes a correlated subquery', async () => {
        const { text, params } = await compile(`
            FROM Customer
            WHERE COUNT(.orders[.status == "cancelled"]) < 5
            SELECT .id
        `);
        expect(text).toBe(
            'SELECT "Customer"."id" FROM "Customer"' +
                ' WHERE (SELECT COUNT(*) FROM "Order" AS "_r0"' +
                ' WHERE "_r0"."customer_id" = "Customer"."id" AND "_r0"."status" IS NOT DISTINCT FROM $1) < $2'
        );
        expect(params).toEqual(['cancelled', 5]);
    });

    test('SUM over a broadcast traversal aggregates the related column', async () => {
        const { text } = await compile(`FROM Customer WHERE SUM(.orders.total) > 100 SELECT .id`);
        expect(text).toContain('(SELECT SUM("_r0"."total") FROM "Order" AS "_r0" WHERE "_r0"."customer_id" = "Customer"."id")');
    });
});

describe('null-safe equality (spec §7.7)', () => {
    test('== and != never compile to = or <>', async () => {
        const { text } = await compile(`FROM Order WHERE .status == "x" AND .tracking_code != "y" SELECT .id`);
        expect(text).toContain('"Order"."status" IS NOT DISTINCT FROM $1');
        expect(text).toContain('"Order"."tracking_code" IS DISTINCT FROM $2');
        expect(text).not.toMatch(/ = \$/);
        expect(text).not.toContain('<>');
    });

    test('a null literal compares by the same total equality, not IS NULL', async () => {
        const { text } = await compile(`FROM Order WHERE .tracking_code == null SELECT .id`);
        expect(text).toContain('"Order"."tracking_code" IS NOT DISTINCT FROM NULL');
    });

    test("the compiler's own join predicate stays a plain =, so a null FK matches nothing", async () => {
        const { text } = await compile(`FROM Order SELECT .customer.name`);
        expect(text).toContain('WHERE "_r0"."id" = "Order"."customer_id"');
    });

    test('ordering comparisons and arithmetic pass through', async () => {
        const { text } = await compile(`FROM Order WHERE .total >= 10 AND (.total * 2) < 100 SELECT .id`);
        expect(text).toContain('"Order"."total" >= $1');
        expect(text).toContain('("Order"."total" * $2) < $3');
    });
});

describe('what the compiler refuses, so the interpreter takes it (ADR 0001)', () => {
    test('a user function has no SQL form', async () => {
        const reason = await compileError(`FROM Order WHERE isBlocked(.id) SELECT .id`);
        expect(reason).toMatch(/interpreted layer/);
        expect(reason).toMatch(/"isBlocked" is a user function/);
    });

    test('a user function never becomes a database function call', async () => {
        const reason = await compileError(
            `fn discounted(t: DECIMAL, r: DECIMAL): DECIMAL { t - t * r / 100 }\nFROM Order WHERE discounted(.total, 10) > 5 SELECT .id AS id`
        );
        expect(reason).toMatch(/user function/);
        expect(reason).not.toContain('discounted(');
    });

    test('a switch arm with a statement is refused with compile.blockInQuery', async () => {
        const result = compiler.compileQuery(await queryOf(`FROM Order SELECT switch .status { "a" => { let x: INTEGER = 1; x }, _ => 2 } AS s`));
        expect(result).toMatchObject({ ok: false, code: 'compile.blockInQuery' });
    });

    test('an if branch with a statement is refused with compile.blockInQuery', async () => {
        const result = compiler.compileQuery(await queryOf(`FROM Order SELECT if .total > 5 { let x: INTEGER = 1; "big" } else { "small" } AS s`));
        expect(result).toMatchObject({ ok: false, code: 'compile.blockInQuery' });
    });

    test('a relation with no declared foreign key says so instead of guessing', async () => {
        const reason = await compileError(`FROM Unlinked SELECT .owner.name`);
        expect(reason).toMatch(/does not say which column on "Unlinked" holds the "owner" reference/);
    });

    test('a table with no declared primary key says so instead of guessing', async () => {
        const reason = await compileError(`FROM Customer WHERE EXISTS(#Unlinked[. == ^]) SELECT .id`);
        expect(reason).toMatch(/does not say which column identifies a row of "Unlinked"/);
    });

    test('a collection used as a plain value is refused (spec §3.4)', async () => {
        const reason = await compileError(`FROM Customer WHERE .orders == 1 SELECT .id`);
        expect(reason).toMatch(/collection/);
    });
});

describe('switch and if become CASE (spec §9.1, §9.2)', () => {
    test('a switch with several values in one arm', async () => {
        const { text, params } = await compile(`FROM Order SELECT switch .status { "a", "b" => 1, _ => 3 } AS s`);
        expect(text).toBe('SELECT CASE "Order"."status" WHEN $1 THEN $2::numeric WHEN $3 THEN $4::numeric ELSE $5::numeric END AS "s" FROM "Order"');
        expect(params).toEqual(['a', 1, 'b', 1, 3]);
    });

    test('a null case value makes every arm a searched CASE, and `= NULL` is never written', async () => {
        const { text, params } = await compile(`FROM Order SELECT switch .tracking_code { null => "none", "x" => "x", _ => "other" } AS s`);
        expect(text).toBe(
            'SELECT CASE WHEN "Order"."tracking_code" IS NULL THEN $1::text WHEN "Order"."tracking_code" = $2 THEN $3::text ELSE $4::text END AS "s" FROM "Order"'
        );
        expect(params).toEqual(['none', 'x', 'x', 'other']);
    });

    test('a block with only a tail is its tail', async () => {
        const { text } = await compile(`FROM Order SELECT switch .status { "a" => { 1 }, _ => { 2 } } AS s`);
        expect(text).toBe('SELECT CASE "Order"."status" WHEN $1 THEN $2::numeric ELSE $3::numeric END AS "s" FROM "Order"');
    });

    test('if and else if', async () => {
        const { text, params } = await compile(`FROM Order SELECT if .total > 100 { "big" } else if .total > 10 { "mid" } else { "small" } AS s`);
        expect(text).toBe(
            'SELECT CASE WHEN "Order"."total" > $1 THEN $2::text ELSE CASE WHEN "Order"."total" > $3 THEN $4::text ELSE $5::text END END AS "s" FROM "Order"'
        );
        expect(params).toEqual([100, 'big', 10, 'mid', 'small']);
    });

    test('an if with no else answers NULL', async () => {
        const { text } = await compile(`FROM Order SELECT if .total > 100 { "big" } AS s`);
        expect(text).toBe('SELECT CASE WHEN "Order"."total" > $1 THEN $2::text ELSE NULL END AS "s" FROM "Order"');
    });
});

describe('is and isnot (spec §5.6)', () => {
    test('is null and isnot null', async () => {
        expect((await compile(`FROM Order WHERE .customer is null SELECT .id`)).text).toBe(
            'SELECT "Order"."id" FROM "Order" WHERE ("Order"."customer_id" IS NULL)'
        );
        expect((await compile(`FROM Order WHERE .tracking_code isnot null SELECT .id`)).text).toBe(
            'SELECT "Order"."id" FROM "Order" WHERE ("Order"."tracking_code" IS NOT NULL)'
        );
    });

    test.each([
        ['object', 'ObjectKind'],
        ['array', 'ArrayKind'],
        ['string', 'StringKind'],
        ['number', 'NumberKind'],
        ['boolean', 'BooleanKind']
    ])('is %s reads jsonb_typeof, and null counts as "not that kind"', async kind => {
        const is = (await compile(`FROM Order WHERE .tracking_code is ${kind} SELECT .id`)).text;
        expect(is).toBe(`SELECT "Order"."id" FROM "Order" WHERE (jsonb_typeof("Order"."tracking_code") IS NOT DISTINCT FROM '${kind}')`);
        const isnot = (await compile(`FROM Order WHERE .tracking_code isnot ${kind} SELECT .id`)).text;
        expect(isnot).toBe(`SELECT "Order"."id" FROM "Order" WHERE (jsonb_typeof("Order"."tracking_code") IS DISTINCT FROM '${kind}')`);
    });
});

describe('JSON literals (spec §7.3)', () => {
    test('an object and a list, nested, with every value bound', async () => {
        const { text, params } = await compile(`FROM Order SELECT { id: .id, tags: ["a", 2], meta: { ok: true } } AS o`);
        expect(text).toBe(
            'SELECT jsonb_build_object($1::text, "Order"."id", $2::text, jsonb_build_array($3::text, $4::numeric), $5::text, jsonb_build_object($6::text, TRUE)) AS "o" FROM "Order"'
        );
        expect(params).toEqual(['id', 'tags', 'a', 2, 'meta', 'ok']);
    });

    test('an empty object', async () => {
        expect((await compile(`FROM Order SELECT { } AS o`)).text).toBe('SELECT jsonb_build_object() AS "o" FROM "Order"');
    });
});

describe('FROM a related collection (spec §3.2)', () => {
    const outer = (key: unknown) => ({
        resolve: () => ({ found: false as const, reason: 'none' }),
        resolveRecord: (frame: number) =>
            frame === 0 ? { found: true as const, record: { table: 'Customer', key } } : { found: false as const, reason: 'none' }
    });

    test('FROM .orders[filter] reads the child table, linked to the outer row, with the filter', async () => {
        const result = compiler.compileQuery(await queryOf(`FROM .orders[.status == "paid"] SELECT .id AS id`), outer('ada'));
        if (!result.ok) throw new Error(result.reason);
        expect(result.query.text).toBe(
            'SELECT "_r0"."id" AS "id" FROM "Order" AS "_r0" WHERE "_r0"."customer_id" = $1 AND "_r0"."status" IS NOT DISTINCT FROM $2'
        );
        expect(result.query.params).toEqual(['ada', 'paid']);
    });

    test('FROM .orders, then the user WHERE', async () => {
        const result = compiler.compileQuery(await queryOf(`FROM .orders AS o WHERE o.total > 5 SELECT o.id AS id`), outer('ada'));
        if (!result.ok) throw new Error(result.reason);
        expect(result.query.text).toBe('SELECT "_r0"."id" AS "id" FROM "Order" AS "_r0" WHERE "_r0"."customer_id" = $1 AND "_r0"."total" > $2');
    });
});
