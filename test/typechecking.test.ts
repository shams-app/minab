import { EmptyFileSystem } from 'langium';
import { validationHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';
import type { Model } from '../src/language/generated/ast.js';
import type { Diagnostic } from 'vscode-languageserver-types';

function messageText(d: Diagnostic): string {
    return typeof d.message === 'string' ? d.message : d.message.value;
}

// Customer.id/Order.id are UUID (a common real-world shape) so a UUID-vs-
// TEXT/INTEGER mismatch test has something realistic to reach for.
const fixtureSchema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'name', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'credit_limit', type: { kind: 'scalar', type: scalarType('DECIMAL') } },
                { name: 'tags', type: { kind: 'scalar', type: scalarType('JSON') } },
                { name: 'orders', type: { kind: 'collection', table: 'Order' } }
            ]
        },
        {
            name: 'Order',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: false } },
                { name: 'total', type: { kind: 'scalar', type: scalarType('DECIMAL') } },
                { name: 'status', type: { kind: 'scalar', type: scalarType('TEXT') } }
            ]
        }
    ]
};

let validate: ReturnType<typeof validationHelper<Model>>;

beforeAll(async () => {
    const services = createMinabServices(EmptyFileSystem, fixtureSchema);
    validate = validationHelper<Model>(services.Minab);
});

async function diagnostics(source: string): Promise<Diagnostic[]> {
    const result = await validate(source);
    return result.diagnostics;
}

async function expectClean(source: string): Promise<void> {
    const ds = await diagnostics(source);
    expect(ds, ds.map(messageText).join('\n')).toHaveLength(0);
}

async function expectError(source: string, pattern: RegExp): Promise<void> {
    const ds = await diagnostics(source);
    expect(
        ds.some(d => pattern.test(messageText(d))),
        ds.map(messageText).join('\n')
    ).toBe(true);
}

describe('no-implicit-coercion (spec §5.5)', () => {
    test('an INTEGER literal compares fine against a DECIMAL column (literals are numerically polymorphic)', async () => {
        await expectClean(`FROM Order WHERE .total > 100 SELECT .id`);
    });

    test('CAST bridges UUID and TEXT (spec §5.5 example)', async () => {
        await expectClean(`
            let rawIdParam: TEXT = "abc";
            FROM Order WHERE CAST(.id AS TEXT) == rawIdParam SELECT .id
        `);
    });

    test('TEXT vs UUID without CAST is rejected', async () => {
        await expectError(`FROM Order WHERE .status == .id SELECT .id`, /explicit CAST/);
    });

    test('DECIMAL vs TEXT without CAST is rejected', async () => {
        await expectError(`FROM Order WHERE .total == .status SELECT .id`, /explicit CAST/);
    });

    test('TEXT vs INTEGER is code type.implicitCoercion, and the parameters name both types (D35)', async () => {
        const ds = await diagnostics(`FROM Order WHERE .status == 1 SELECT .id`);
        const diagnostic = ds.find(d => d.code === 'type.implicitCoercion');
        expect(diagnostic, ds.map(messageText).join('\n')).toBeDefined();
        expect((diagnostic!.data as { params: unknown }).params).toEqual({ operator: '==', left: 'TEXT', right: 'INTEGER' });
    });
});

describe('the §3.4 collection-vs-scalar boundary', () => {
    test('a broadcast collection used directly in a comparison is rejected', async () => {
        await expectError(`FROM Customer WHERE .orders.total > 100 SELECT .id`, /orderable|collection/);
    });

    test('reduced via an aggregate is accepted', async () => {
        await expectClean(`FROM Customer WHERE SUM(.orders.total) > 100 SELECT .id`);
    });

    test('reduced via a predicate over an inline filter is accepted', async () => {
        await expectClean(`FROM Customer WHERE EXISTS(.orders[.total > 100]) SELECT .id`);
    });

    test('selecting a raw collection column directly is accepted — SELECT is a projection, not a scalar/boolean position (spec §3.4)', async () => {
        await expectClean(`FROM Customer SELECT .id, .orders AS orders`);
    });

    test('a positional index on a relational collection is rejected (spec §3.5)', async () => {
        await expectError(`FROM Customer WHERE COUNT(.orders[2]) > 0 SELECT .id`, /positional index/);
    });

    test("GROUPBY promotes a bare per-row field to the group's collection for an aggregate (spec §4.1)", async () => {
        await expectClean(`
            FROM Order
            GROUPBY .customer
            HAVING SUM(.total) > 1000
            SELECT KEY, SUM(.total) AS total_spent, COUNT(.) AS order_count
        `);
    });
});

describe('null-operand rules (spec §7.7)', () => {
    test('IN accepts null in the list', async () => {
        await expectClean(`FROM Order WHERE .status IN [null, "flagged"] SELECT .id`);
    });

    test('== against null is fine', async () => {
        await expectClean(`FROM Order WHERE .total == null SELECT .id`);
    });

    test('< against null is rejected', async () => {
        await expectError(`FROM Order WHERE .total < null SELECT .id`, /doesn't accept null/);
    });

    test('LIKE against null is rejected', async () => {
        await expectError(`FROM Order WHERE .status LIKE null SELECT .id`, /doesn't accept null/);
    });
});

describe('`is`/`isnot` (spec §5.6)', () => {
    test('a JSON shape test is always BOOLEAN, no error', async () => {
        await expectClean(`FROM Customer WHERE .tags is array SELECT .id`);
    });
});

describe('built-in vs. user-defined functions (spec §5.3, §12 item 10)', () => {
    test('a built-in is called bare', async () => {
        await expectClean(`FROM Customer SELECT COUNT(.orders) AS order_count`);
    });

    test('an unknown bare-called name is rejected', async () => {
        await expectError(`FROM Order WHERE totallyUnknownFn(.total) > 0 SELECT .id`, /unknown function/);
    });

    test('a bare user-defined function call is accepted', async () => {
        await expectClean(`
            fn double(x: INTEGER): INTEGER { x * 2 }
            double(5) > 0
        `);
    });

    test('a call to a name that is neither built-in nor declared is rejected', async () => {
        await expectError(`foo(1)`, /unknown function "foo"/);
    });

    test('D10: a fn name needs a lowercase letter, so ALL-CAPS names stay for built-ins', async () => {
        await expectError(`fn SUM(x: INTEGER): INTEGER { x }\n1`, /function name needs a lowercase letter/);
        await expectError(`fn TAX(x: DECIMAL): DECIMAL { x }\n1`, /function name needs a lowercase letter/);
        await expectClean(`fn tax(x: DECIMAL): DECIMAL { x }\n1`);
    });

    test('D11: a let or a parameter may not have the name of a fn', async () => {
        await expectError(`fn total(a: DECIMAL): DECIMAL { a }\nlet total: DECIMAL = 5;`, /"total" is the name of a function/);
        await expectError(`fn total(a: DECIMAL): DECIMAL { a }\nfn check(total: DECIMAL): BOOLEAN { true }`, /"total" is the name of a function/);
    });

    test('D11: a fn may not have the name of a table', async () => {
        await expectError(`fn Customer(): INTEGER { 1 }`, /"Customer" is a table name/);
    });

    test('an old `&name(...)` call is a syntax error', async () => {
        await expectError(`fn double(x: INTEGER): INTEGER { x * 2 }\n&double(5) > 0`, /./);
    });

    test('a user function call checks argument count and types', async () => {
        await expectError(`fn add(a: INTEGER, b: INTEGER): INTEGER { a + b } add(1) > 0`, /expects 2 argument/);
        await expectError(`fn add(a: INTEGER, b: INTEGER): INTEGER { a + b } add(1, "x") > 0`, /argument 2/);
        await expectClean(`fn add(a: INTEGER, b: INTEGER): INTEGER { a + b } add(1, 2) > 0`);
    });
});

describe('query-tailed functions return JSON (spec §8.6, §12 item 11)', () => {
    test('a query-tailed function not declared JSON is rejected', async () => {
        await expectError(
            `
            fn cancelledOrdersFor(customerId: UUID): UUID {
                FROM Order
                WHERE .customer.id == customerId AND .status == "cancelled"
                SELECT .id
            }
            1
            `,
            /must declare its return type as JSON/
        );
    });

    test('a query-tailed function declared JSON is accepted', async () => {
        await expectClean(`
            fn cancelledOrdersFor(customerId: UUID): JSON {
                FROM Order
                WHERE .customer.id == customerId AND .status == "cancelled"
                SELECT .id
            }
            1
        `);
    });

    test("a plain-expression-tailed function's result must match its declared return type", async () => {
        await expectError(`fn double(x: INTEGER): TEXT { x * 2 } 1`, /doesn't match its declared return type/);
        await expectClean(`fn double(x: INTEGER): INTEGER { x * 2 } 1`);
    });
});

describe('`let`/assignment type compatibility (spec §7.1, §9.1, §9.3)', () => {
    test('a well-typed initializer is accepted', async () => {
        await expectClean(`let x: INTEGER = 5; x > 0`);
    });

    test('a mismatched initializer is rejected', async () => {
        await expectError(`let x: INTEGER = "hello"; 1`, /can't initialize/);
    });

    test('assigning null to a non-nullable declared type is rejected', async () => {
        await expectError(`let x: INTEGER = null; 1`, /can't initialize/);
    });

    test('assigning null to a nullable declared type is accepted', async () => {
        await expectClean(`let x: INTEGER? = null; 1`);
    });

    test('an else-less if is nullable-typed (spec §9.1) — matches a nullable target', async () => {
        await expectClean(`let tier: TEXT? = if 100 > 50 { "gold" }; 1`);
    });

    test('an else-less if assigned to a non-nullable target is rejected', async () => {
        await expectError(`let tier: TEXT = if 100 > 50 { "gold" }; 1`, /can't initialize/);
    });

    test('reassignment respects the declared type', async () => {
        await expectClean(`let total: INTEGER = 0; total = total + 5; total > 0`);
        await expectError(`let total: INTEGER = 0; total = "x"; 1`, /can't assign/);
    });

    test('"?=" requires a nullable target', async () => {
        await expectClean(`let discount: DECIMAL? = null; discount ?= 0.10; 1`);
        await expectError(`let x: INTEGER = 0; x ?= 5; 1`, /requires a nullable target/);
    });
});

describe('switch arms must agree on type (spec §9.2)', () => {
    test('agreeing arms are accepted', async () => {
        await expectClean(`
            let priority: INTEGER = switch "urgent" {
                "urgent" => 1,
                "high" => 2,
                _ => 0
            };
            1
        `);
    });

    test('disagreeing arms are rejected', async () => {
        await expectError(
            `
            switch 1 {
                1 => "a",
                _ => 2
            }
            `,
            /switch arms must agree/
        );
    });
});

describe('tuples (spec §7.6)', () => {
    test('positional access within bounds is accepted', async () => {
        await expectClean(`let point: (INTEGER, INTEGER) = (3, 4); point[0] > 0`);
    });

    test('an out-of-bounds index is rejected', async () => {
        await expectError(`let point: (INTEGER, INTEGER) = (3, 4); point[5] > 0`, /out of bounds/);
    });
});

describe('list literals must share one type (no implicit coercion)', () => {
    test('a mixed numeric list unifies to DECIMAL, no error', async () => {
        await expectClean(`[1, 2.5, 3]`);
    });

    test('a mixed TEXT/INTEGER list is rejected', async () => {
        await expectError(`["a", 1]`, /must share one type/);
    });
});

describe('one mistake, one diagnostic (roadmap Phase 7)', () => {
    // `ListLiteral` and `IfExpr` are both independently checked node types;
    // `inferIfExpr` also recurses into its `thenBranch`, which is this same
    // failing list. Without `origin` tracking, Langium's direct visit to
    // the `ListLiteral` node and its direct visit to the enclosing `IfExpr`
    // node would each independently re-infer and report the same "must
    // share one type" failure.
    test('a failing list literal nested inside an if-expression is reported exactly once', async () => {
        const ds = await diagnostics(`if 1 == 1 { ["a", 1] } else { 2 }`);
        const matching = ds.filter(d => /must share one type/.test(messageText(d)));
        expect(matching, ds.map(messageText).join('\n')).toHaveLength(1);
    });
});
