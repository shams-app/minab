import { EmptyFileSystem } from 'langium';
import { validationHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinabServices } from '../src/language/minab-module.js';
import type { MinabSchema } from '../src/language/schema.js';
import type { Model } from '../src/language/generated/ast.js';
import type { Diagnostic } from 'vscode-languageserver-types';

// Same unwrap helper as test/validation.test.ts — a Diagnostic's `message`
// is `string | MarkupContent` per the LSP type.
function messageText(d: Diagnostic): string {
    return typeof d.message === 'string' ? d.message : d.message.value;
}

// A richer fixture than the other test files need — this phase's checks
// span ref/collection traversal, so the schema needs real relations.
const fixtureSchema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            columns: [
                { name: 'id', type: { kind: 'scalar', base: 'UUID', nullable: false } },
                { name: 'name', type: { kind: 'scalar', base: 'TEXT', nullable: false } },
                { name: 'country', type: { kind: 'scalar', base: 'TEXT', nullable: false } },
                { name: 'credit_limit', type: { kind: 'scalar', base: 'DECIMAL', nullable: false } },
                { name: 'billing_address', type: { kind: 'ref', table: 'Address', nullable: true } }
            ]
        },
        {
            name: 'Address',
            columns: [{ name: 'country', type: { kind: 'scalar', base: 'TEXT', nullable: false } }]
        },
        {
            name: 'Order',
            columns: [
                { name: 'id', type: { kind: 'scalar', base: 'UUID', nullable: false } },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: false } },
                { name: 'status', type: { kind: 'scalar', base: 'TEXT', nullable: false } },
                { name: 'total', type: { kind: 'scalar', base: 'DECIMAL', nullable: false } },
                { name: 'quantity', type: { kind: 'scalar', base: 'INTEGER', nullable: false } },
                { name: 'orders', type: { kind: 'collection', table: 'Order' } }
            ]
        }
    ],
    functions: []
};

let validate: ReturnType<typeof validationHelper<Model>>;
let validateField: ReturnType<typeof validationHelper<Model>>;

beforeAll(async () => {
    const record = createMinabServices(EmptyFileSystem, fixtureSchema, { isFieldRule: false });
    const field = createMinabServices(EmptyFileSystem, fixtureSchema, {
        isFieldRule: true,
        fieldType: { kind: 'scalar', base: 'DECIMAL', nullable: false }
    });
    validate = validationHelper<Model>(record.Minab);
    validateField = validationHelper<Model>(field.Minab);
});

function errors(diagnostics: Diagnostic[]): Diagnostic[] {
    return diagnostics.filter(d => d.severity === 1);
}

describe('let initializers — literal and cross-base mismatches (spec §7.2, §12 item 8)', () => {
    test('rejects a string literal assigned to an INTEGER', async () => {
        const result = await validate(`let x: INTEGER = "hello";`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('cannot assign'))).toBe(true);
    });

    test('rejects null assigned to a non-nullable type', async () => {
        const result = await validate(`let age: INTEGER = null;`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('cannot assign null to INTEGER'))).toBe(true);
    });

    test('accepts null assigned to a nullable type', async () => {
        const result = await validate(`let age: INTEGER? = null;`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('rejects comparing an INTEGER column against a DECIMAL column without CAST', async () => {
        const result = await validate(`FROM Order WHERE .quantity == .total SELECT .id`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('without an explicit CAST'))).toBe(true);
    });

    test('accepts the same comparison once CAST makes the types agree', async () => {
        const result = await validate(`FROM Order WHERE CAST(.quantity AS DECIMAL) == .total SELECT .id`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });
});

describe('numeric literals are untyped constants (Hamed, 2026-09-17)', () => {
    test('a bare literal is accepted against both an INTEGER and a DECIMAL target', async () => {
        const asInt = await validate(`let x: INTEGER = 100;`);
        const asDecimal = await validate(`let y: DECIMAL = 100;`);
        expect(errors(asInt.diagnostics)).toHaveLength(0);
        expect(errors(asDecimal.diagnostics)).toHaveLength(0);
    });

    test('a literal added to a DECIMAL column needs no CAST', async () => {
        const result = await validate(`FROM Order WHERE .total + 1 > 0 SELECT .id`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });
});

describe('TEXT/CITEXT are interchangeable (Hamed, 2026-09-17)', () => {
    test('comparing a TEXT column against a CITEXT-typed let needs no CAST', async () => {
        const schema: MinabSchema = {
            tables: [{ name: 'Order', columns: [{ name: 'status', type: { kind: 'scalar', base: 'TEXT', nullable: false } }] }],
            functions: []
        };
        const { Minab } = createMinabServices(EmptyFileSystem, schema);
        const v = validationHelper<Model>(Minab);
        const result = await v(`let s: CITEXT = "shipped";\nFROM Order WHERE .status == s SELECT .`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });
});

describe('deep `ref` traversal supersedes Phase 2\'s one-hop bound (spec §3.4)', () => {
    test('a two-hop ref chain resolves and types correctly', async () => {
        const result = await validate(`FROM Order WHERE .customer.billing_address.country == "US" SELECT .id`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('an unknown column at the second hop is still caught', async () => {
        const result = await validate(`FROM Order WHERE .customer.billing_address.nonexistent == "US" SELECT .id`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('unknown column "nonexistent"'))).toBe(true);
    });
});

describe('the §3.4 collection-vs-scalar boundary', () => {
    test('rejects a raw collection field used directly as a WHERE condition', async () => {
        const result = await validate(`FROM Order WHERE .orders SELECT .id`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('collection-valued expression cannot be used as a condition'))).toBe(true);
    });

    test('rejects .orders.total (broadcast collection) used as a bare condition', async () => {
        const result = await validate(`FROM Order WHERE .orders.total SELECT .id`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('collection-valued expression cannot be used as a condition'))).toBe(true);
    });

    test('accepts the same shape reduced via SUM', async () => {
        const result = await validate(`FROM Order WHERE SUM(.orders.total) > 100 SELECT .id`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('accepts it reduced via EXISTS over an inline filter', async () => {
        const result = await validate(`FROM Order WHERE EXISTS(.orders[.total > 100]) SELECT .id`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('rejects a collection used as a SELECT column', async () => {
        const result = await validate(`FROM Order SELECT .orders`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('SELECT column'))).toBe(true);
    });
});

describe('null as an operand (spec §7.7)', () => {
    test('rejects an ordering comparison against literal null', async () => {
        const result = await validate(`.total < null`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes("does not accept null"))).toBe(true);
    });

    test('rejects LIKE against literal null', async () => {
        const result = await validate(`.name LIKE null`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes("'LIKE' does not accept null"))).toBe(true);
    });

    test('accepts == against null', async () => {
        const result = await validate(`.total == null`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('accepts null inside an IN list', async () => {
        const result = await validate(`.status IN [null, "flagged"]`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });
});

describe('`if`/`else` typing (spec §9.1)', () => {
    test('an else-less if is nullable, so assigning it to a non-nullable type is rejected', async () => {
        const result = await validate(`let discount: DECIMAL = if .total > 1000 { 0.20 };`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('cannot assign DECIMAL? to DECIMAL'))).toBe(true);
    });

    test('the same else-less if is accepted against the nullable type', async () => {
        const result = await validate(`let discount: DECIMAL? = if .total > 1000 { 0.20 };`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('rejects branches that disagree in type', async () => {
        const result = await validate(`let x: TEXT = if .total > 1000 { "gold" } else { 5 };`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('branches must agree'))).toBe(true);
    });
});

describe('vivify (`!`) on a collection step is a semantic error (spec §12 item 17)', () => {
    // A bare top-level `.` has no statically-known table (its record is
    // bound by the host at runtime, spec §6) — these checks need a scope
    // whose table *is* statically known, so they run inside a `loop ...
    // in #Order` (an ad-hoc table scope, spec §3.3) instead.
    test('rejects `!` on a collection-typed path step', async () => {
        const result = await validate(`loop o in #Order { o.orders!.total = 5; }`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes("no effect on a collection field"))).toBe(true);
    });

    test('accepts `!` on a ref-typed path step', async () => {
        const result = await validate(`loop o in #Order { o.customer!.name = "x"; }`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });
});

describe('user function calls (spec §8)', () => {
    const fnDecl = `fn discountedTotal(orderId: UUID, rate: DECIMAL): DECIMAL {\n    rate\n}\n`;

    test('accepts a correctly-typed call', async () => {
        const result = await validate(`${fnDecl}\n&discountedTotal(.id, .total) < 0`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('rejects a wrong argument type', async () => {
        const result = await validate(`${fnDecl}\n&discountedTotal("not-a-uuid", .total) < 0`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('argument 1'))).toBe(true);
    });

    test('rejects a wrong argument count', async () => {
        const result = await validate(`${fnDecl}\n&discountedTotal(.id) < 0`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('expects 2 argument'))).toBe(true);
    });

    test("rejects a function body's tail that doesn't match the declared return type", async () => {
        const result = await validate(`fn bad(): INTEGER {\n    "not an integer"\n}`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes("doesn't match declared return type"))).toBe(true);
    });
});

describe('built-in aggregate type rules', () => {
    test('rejects SUM over a non-numeric collection', async () => {
        const result = await validate(`FROM Customer SELECT SUM(.name)`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes("'SUM' requires a numeric"))).toBe(true);
    });

    test('accepts SUM(.total) after GROUPBY as an implicit per-group aggregate', async () => {
        const result = await validate(`FROM Order GROUPBY .customer HAVING SUM(.total) > 100 SELECT KEY.name`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });
});

describe('`$` is typed via the host-supplied field type', () => {
    test('a comparison against $ type-checks once the host supplies fieldType', async () => {
        const result = await validateField(`$ > 0`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('an incompatible comparison against a typed $ is rejected', async () => {
        const result = await validateField(`$ == "not a decimal"`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('without an explicit CAST'))).toBe(true);
    });
});

describe('assignment targets (spec §9.3)', () => {
    test('rejects an arithmetic expression as an assignment target', async () => {
        const result = await validate(`1 + 1 = 5;`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('assignment target must be'))).toBe(true);
    });

    test('rejects a value type that does not match the target', async () => {
        // as above — needs a statically-known table, hence the `loop ... in #Order` wrapper.
        const result = await validate(`loop o in #Order { o.total = "not a decimal"; }`);
        expect(errors(result.diagnostics).some(d => messageText(d).includes('cannot assign'))).toBe(true);
    });

    test('accepts a well-typed .field assignment', async () => {
        const result = await validate(`loop o in #Order { o.total = 5; }`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });
});

describe('GROUPBY/KEY typing, including KEY.field through a ref-typed group key', () => {
    test('KEY.name resolves through a ref-typed GROUPBY key (the showcase\'s own shape)', async () => {
        const result = await validate(`FROM Order GROUPBY .customer SELECT KEY.name AS customer_name, SUM(.total) AS total_spent`);
        expect(errors(result.diagnostics)).toHaveLength(0);
    });

    test('a SELECT alias is resolvable from ORDERBY (the showcase\'s own §5 example)', async () => {
        const result = await validate(
            `FROM Order GROUPBY .customer HAVING SUM(.total) > 1000 SELECT KEY.name AS customer_name, SUM(.total) AS total_spent ORDERBY total_spent DESC`
        );
        expect(errors(result.diagnostics)).toHaveLength(0);
    });
});
