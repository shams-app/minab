import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Model } from '../src/language/generated/ast.js';
import type { QueryExecutor, Row, SqlQuery } from '../src/language/minab-executor.js';
import type { EvalContext, MinabInterpreter } from '../src/language/minab-interpreter.js';
import { createMinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';

/**
 * Phase 5's evaluator end to end (ADR 0001's hybrid): the interpreter walks
 * the rule, and anything needing table data is compiled to SQL and run
 * through the host's executor. The executor here records every statement it
 * is handed, which is how these tests assert the *strategy* — that a
 * correlated `#Table` check leaves as one parameterized lookup — and not
 * just the answer.
 */

const fixtureSchema: MinabSchema = {
    tables: [
        {
            name: 'Booking',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'room_id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'start_date', type: { kind: 'scalar', type: scalarType('DATE') } },
                { name: 'end_date', type: { kind: 'scalar', type: scalarType('DATE') } }
            ]
        },
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'name', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'email', type: { kind: 'scalar', type: scalarType('CITEXT') } },
                { name: 'country', type: { kind: 'scalar', type: scalarType('TEXT', { nullable: true }) } },
                { name: 'orders', type: { kind: 'collection', table: 'Order', foreignKey: 'customer_id' } }
            ]
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: true, foreignKey: 'customer_id' } },
                { name: 'status', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'total', type: { kind: 'scalar', type: scalarType('DECIMAL') } }
            ]
        }
    ],
    functions: []
};

class RecordingExecutor implements QueryExecutor {
    readonly queries: SqlQuery[] = [];

    constructor(private readonly respond: (query: SqlQuery) => Row[] = () => []) {}

    async execute(query: SqlQuery): Promise<Row[]> {
        this.queries.push(query);
        return this.respond(query);
    }

    get only(): SqlQuery {
        if (this.queries.length !== 1) {
            throw new Error(`expected exactly one query, got ${this.queries.length}`);
        }
        return this.queries[0];
    }
}

let parse: ReturnType<typeof parseHelper<Model>>;
let interpreter: MinabInterpreter;

beforeAll(() => {
    const services = createMinabServices(EmptyFileSystem, fixtureSchema);
    parse = parseHelper<Model>(services.Minab);
    interpreter = services.Minab.interpreter;
});

async function run(source: string, context: Omit<EvalContext, 'executor'> & { executor: RecordingExecutor }) {
    const document = await parse(source);
    expect(document.parseResult.parserErrors.map(e => e.message)).toEqual([]);
    return await interpreter.evaluate(document.parseResult.value, context);
}

async function value(source: string, context: Omit<EvalContext, 'executor'> & { executor: RecordingExecutor }) {
    const result = await run(source, context);
    if (!result.ok) throw new Error(result.reason);
    return result.value;
}

// Spec §6.1's headline record-level rule: a local date comparison plus a
// correlated existence check against a table the rule never declares.
const OVERLAP_RULE = `
    .end_date > .start_date AND NOT EXISTS(
        #Booking[. != ^ AND .room_id == ^.room_id
                 AND .start_date < ^.end_date AND .end_date > ^.start_date]
    )
`;

const BOOKING: Row = {
    id: 'b-1',
    room_id: 'room-7',
    start_date: '2026-10-01',
    end_date: '2026-10-05'
};

describe('a record-level validation rule with a correlated #Table check (spec §6.1)', () => {
    test('passes when no other booking overlaps', async () => {
        const executor = new RecordingExecutor(() => [{ value: false }]);
        const result = await value(OVERLAP_RULE, { executor, record: BOOKING, recordTable: 'Booking' });
        expect(result).toBe(true);
    });

    test('fails when the database reports an overlap', async () => {
        const executor = new RecordingExecutor(() => [{ value: true }]);
        const result = await value(OVERLAP_RULE, { executor, record: BOOKING, recordTable: 'Booking' });
        expect(result).toBe(false);
    });

    test('the correlated check is pushed down as one parameterized EXISTS, not a table scan', async () => {
        const executor = new RecordingExecutor(() => [{ value: false }]);
        await value(OVERLAP_RULE, { executor, record: BOOKING, recordTable: 'Booking' });
        expect(executor.only.text).toBe(
            'SELECT EXISTS (SELECT 1 FROM "Booking" AS "_r0"' +
                ' WHERE ((("_r0"."id" IS DISTINCT FROM $1' +
                ' AND "_r0"."room_id" IS NOT DISTINCT FROM $2)' +
                ' AND "_r0"."start_date" < $3)' +
                ' AND "_r0"."end_date" > $4)) AS "value"'
        );
        expect(executor.only.params).toEqual(['b-1', 'room-7', '2026-10-05', '2026-10-01']);
    });

    test('the local date comparison stays in the interpreter — a rule it can settle alone asks the database nothing', async () => {
        const executor = new RecordingExecutor(() => [{ value: false }]);
        const result = await value(`.end_date > .start_date`, {
            executor,
            record: BOOKING,
            recordTable: 'Booking'
        });
        expect(result).toBe(true);
        expect(executor.queries).toHaveLength(0);
    });

    test('short-circuiting AND skips the pushdown entirely when the local half already fails', async () => {
        const executor = new RecordingExecutor(() => [{ value: true }]);
        const backwards: Row = { ...BOOKING, start_date: '2026-10-09' };
        const result = await value(OVERLAP_RULE, { executor, record: backwards, recordTable: 'Booking' });
        expect(result).toBe(false);
        expect(executor.queries).toHaveLength(0);
    });
});

describe('a field-level rule (spec §6.2)', () => {
    test('a referential-integrity check binds $ as a parameter', async () => {
        const executor = new RecordingExecutor(() => [{ value: true }]);
        const result = await value(`EXISTS(#Customer[.id == $])`, {
            executor,
            record: { id: 'o-1' },
            recordTable: 'Order',
            fieldValue: 'cust-3'
        });
        expect(result).toBe(true);
        expect(executor.only.text).toBe('SELECT EXISTS (SELECT 1 FROM "Customer" AS "_r0" WHERE "_r0"."id" IS NOT DISTINCT FROM $1) AS "value"');
        expect(executor.only.params).toEqual(['cust-3']);
    });

    test('a rule comparing $ against a sibling field needs no database at all', async () => {
        const executor = new RecordingExecutor();
        const result = await value(`$ >= 0 AND $ <= .total`, {
            executor,
            record: { id: 'o-1', total: 500 },
            recordTable: 'Order',
            fieldValue: 250
        });
        expect(result).toBe(true);
        expect(executor.queries).toHaveLength(0);
    });
});

describe('aggregates over a related collection (spec §6.1)', () => {
    test('COUNT of a filtered relation is pushed down, and compared in the interpreter', async () => {
        const executor = new RecordingExecutor(() => [{ value: 2 }]);
        const result = await value(`COUNT(.orders[.status == "cancelled"]) < 5`, {
            executor,
            record: { id: 'cust-3' },
            recordTable: 'Customer'
        });
        expect(result).toBe(true);
        expect(executor.only.text).toBe(
            'SELECT (SELECT COUNT(*) FROM "Order" AS "_r0"' + ' WHERE "_r0"."customer_id" = $1 AND "_r0"."status" IS NOT DISTINCT FROM $2) AS "value"'
        );
        expect(executor.only.params).toEqual(['cust-3', 'cancelled']);
    });
});

describe('a pipeline query as the document tail (spec §4)', () => {
    test('runs as one SELECT and returns its rows', async () => {
        const rows = [{ id: 'o-1' }, { id: 'o-2' }];
        const executor = new RecordingExecutor(() => rows);
        const result = await value(`FROM Order WHERE .status == "shipped" SELECT .id`, { executor });
        expect(result).toBe(rows);
        expect(executor.only.text).toBe('SELECT "Order"."id" FROM "Order" WHERE "Order"."status" IS NOT DISTINCT FROM $1');
    });
});

describe('onStatement names the source node behind each statement', () => {
    test('a rule reports the pushed-down EXISTS, not the whole rule', async () => {
        const executor = new RecordingExecutor(() => [{ value: false }]);
        const seen: Array<{ text: string; origin: string }> = [];
        await value(OVERLAP_RULE, {
            executor,
            record: BOOKING,
            recordTable: 'Booking',
            onStatement: (query, origin) => seen.push({ text: query.text, origin: origin.$cstNode!.text })
        });
        expect(seen).toHaveLength(1);
        expect(seen[0].text).toBe(executor.only.text);
        expect(seen[0].origin).toMatch(/^EXISTS\(\s*#Booking\[/);
        expect(seen[0].origin).toMatch(/\]\s*\)$/);
    });

    test('a query program reports the query itself', async () => {
        const executor = new RecordingExecutor(() => []);
        const origins: string[] = [];
        await value(`FROM Order WHERE .status == "shipped" SELECT .id`, {
            executor,
            onStatement: (_query, origin) => origins.push(origin.$type)
        });
        expect(origins).toEqual(['Query']);
    });

    test('a rule settled from the record alone reports nothing', async () => {
        const executor = new RecordingExecutor();
        const origins: string[] = [];
        await value(`.end_date > .start_date`, {
            executor,
            record: BOOKING,
            recordTable: 'Booking',
            onStatement: (_query, origin) => origins.push(origin.$type)
        });
        expect(origins).toEqual([]);
    });
});

describe('the interpreter implements spec §7.7 in its own idiom (ADR 0001)', () => {
    test('null == null is true, not SQL’s unknown', async () => {
        const executor = new RecordingExecutor();
        const result = await value(`.country == null`, {
            executor,
            record: { id: 'c-1', country: null },
            recordTable: 'Customer'
        });
        expect(result).toBe(true);
    });

    test('traversal through a null propagates null rather than erroring (rule 1)', async () => {
        const executor = new RecordingExecutor();
        const result = await value(`.country == null`, {
            executor,
            record: { id: 'c-1' },
            recordTable: 'Customer'
        });
        expect(result).toBe(true);
    });

    test('an ordering comparison against null is an error, not false (rule 3)', async () => {
        const executor = new RecordingExecutor();
        const result = await run(`.total > null`, {
            executor,
            record: { id: 'o-1', total: 5 },
            recordTable: 'Order'
        });
        expect(result).toEqual({ ok: false, reason: expect.stringContaining('null') });
    });

    test('a CITEXT column compares case-insensitively, matching what SQL would do', async () => {
        const executor = new RecordingExecutor();
        const record = { id: 'c-1', email: 'Hamed@Example.COM', name: 'Hamed' };
        expect(await value(`.email == "hamed@example.com"`, { executor, record, recordTable: 'Customer' })).toBe(true);
        // TEXT, by contrast, stays case-sensitive.
        expect(await value(`.name == "hamed"`, { executor, record, recordTable: 'Customer' })).toBe(false);
    });
});

describe('the interpreted layer proper', () => {
    test('let bindings feed a rule', async () => {
        const executor = new RecordingExecutor();
        const result = await value(
            `
            let threshold: DECIMAL = 100;

            .total > threshold
            `,
            { executor, record: { id: 'o-1', total: 250 }, recordTable: 'Order' }
        );
        expect(result).toBe(true);
    });

    test('a user function runs in the interpreter and can be recursive', async () => {
        const executor = new RecordingExecutor();
        const result = await value(
            `
            fn factorial(n: INTEGER): INTEGER {
                if n <= 1 { 1 } else { n * &factorial(n - 1) }
            }

            &factorial(5) == 120
            `,
            { executor, record: { id: 'o-1' }, recordTable: 'Order' }
        );
        expect(result).toBe(true);
        expect(executor.queries).toHaveLength(0);
    });

    test('a rule mixing a user function with a correlated check still pushes the check down', async () => {
        const executor = new RecordingExecutor(() => [{ value: false }]);
        const result = await value(
            `
            fn isPositive(n: DECIMAL): BOOLEAN {
                n > 0
            }

            &isPositive(.total) AND NOT EXISTS(#Customer[.id == "blocked"])
            `,
            { executor, record: { id: 'o-1', total: 10 }, recordTable: 'Order' }
        );
        expect(result).toBe(true);
        expect(executor.only.text).toContain('EXISTS (SELECT 1 FROM "Customer" AS "_r0"');
    });

    test('switch picks a branch by value', async () => {
        const executor = new RecordingExecutor();
        const result = await value(`switch .status { "shipped" => 1, "cancelled" => 2, _ => 0 } == 2`, {
            executor,
            record: { id: 'o-1', status: 'cancelled' },
            recordTable: 'Order'
        });
        expect(result).toBe(true);
    });

    test('a construct Phase 5 does not execute says so rather than answering wrongly', async () => {
        const executor = new RecordingExecutor();
        const result = await run(
            `
            loop i from 1 to 3 {
            }

            .total > 0
            `,
            { executor, record: { id: 'o-1', total: 1 }, recordTable: 'Order' }
        );
        expect(result).toEqual({ ok: false, reason: expect.stringContaining('not executed yet') });
    });
});
