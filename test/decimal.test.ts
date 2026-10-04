import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Model } from '../src/language/generated/ast.js';
import type { QueryExecutor, Row, SqlQuery } from '../src/language/minab-executor.js';
import type { EvalContext, EvalResult, MinabInterpreter } from '../src/language/minab-interpreter.js';
import { createMinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';
import { formatValue } from '../src/host/format.js';
import { Big, decimalText, externalize } from '../src/language/values.js';
import { evaluate } from './support/evaluate.js';

/**
 * Production plan C2 (decision D17): exact decimals in the interpreter, the
 * integer range, and how numbers leave Minab. The two runtimes are compared
 * in `test/differential/cases/c2-decimal.cases.ts`; the cases here are the
 * ones Postgres cannot answer the same way (errors, driver values, output).
 */

const schema: MinabSchema = {
    tables: [
        {
            name: 'Order',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('INTEGER') } },
                { name: 'price', type: { kind: 'scalar', type: scalarType('DECIMAL') } },
                { name: 'quantity', type: { kind: 'scalar', type: scalarType('INTEGER') } },
                { name: 'big', type: { kind: 'scalar', type: scalarType('INTEGER', { nullable: true }) } }
            ]
        }
    ]
};

class Recorder implements QueryExecutor {
    readonly queries: SqlQuery[] = [];
    constructor(private readonly rows: Row[] = []) {}
    async execute(query: SqlQuery): Promise<Row[]> {
        this.queries.push(query);
        return this.rows;
    }
}

let parse: ReturnType<typeof parseHelper<Model>>;
let interpreter: MinabInterpreter;

beforeAll(() => {
    const services = createMinabServices(EmptyFileSystem, schema);
    parse = parseHelper<Model>(services.Minab);
    interpreter = services.Minab.interpreter;
});

async function run(source: string, context: Partial<EvalContext> = {}): Promise<EvalResult> {
    const document = await parse(source);
    expect(document.parseResult.parserErrors.map(e => e.message)).toEqual([]);
    return await evaluate(interpreter, document.parseResult.value, { executor: new Recorder(), ...context });
}

async function value(source: string, context: Partial<EvalContext> = {}): Promise<unknown> {
    const result = await run(source, context);
    if (!result.ok) throw new Error(result.reason);
    return result.value;
}

const order = (row: Row) => ({ record: row, recordTable: 'Order' });

describe('exact decimals', () => {
    test('0.1 + 0.2 == 0.3', async () => {
        expect(await value('0.1 + 0.2 == 0.3')).toBe(true);
    });

    test('twenty digits and a cent are exact', async () => {
        expect(await value('12345678901234567890.12 + 0.01')).toBe('12345678901234567890.13');
    });

    test('a price from the data port, as text, times a quantity', async () => {
        expect(await value('.price * .quantity', order({ id: 1, price: '8.30', quantity: 3 }))).toBe('24.9');
    });

    test('a price as a JavaScript number is read exactly too', async () => {
        expect(await value('.price + 0.2 == 0.3', order({ id: 1, price: 0.1, quantity: 1 }))).toBe(true);
    });

    test('INTEGER with INTEGER stays an INTEGER, a mix is a DECIMAL', async () => {
        expect(await value('2 + 3')).toBe(5);
        expect(await value('2 + 0.5')).toBe('2.5');
        expect(await value('2 * 1.50')).toBe('3');
    });

    test('a whole decimal has no exponent and no trailing zeros', async () => {
        expect(await value('100000000000000000000.0 * 10.0')).toBe('1000000000000000000000');
        expect(await value('0.00000001 * 0.1')).toBe('0.000000001');
        expect(await value('0.5 - 0.5')).toBe('0');
    });

    test('negative decimals and unary minus', async () => {
        expect(await value('-8.30 * 3')).toBe('-24.9');
        expect(await value('-(0.1 + 0.2)')).toBe('-0.3');
    });

    test('comparison across INTEGER and DECIMAL', async () => {
        expect(await value('3 == 3.00')).toBe(true);
        expect(await value('3 < 3.01')).toBe(true);
        expect(await value('3.01 <= 3')).toBe(false);
        expect(await value('0.30000000000000004 > 0.3')).toBe(true);
        expect(await value('0.3 IN [0.1, 0.30]')).toBe(true);
    });

    test('a DECIMAL parameter, argument and return value are exact', async () => {
        expect(await value('fn half(a: DECIMAL): DECIMAL { a * 0.5 }\nhalf(3)')).toBe('1.5');
        expect(await value('let t: DECIMAL = 5;\nt')).toBe('5');
    });

    test('division and % accept decimals', async () => {
        expect(await value('1.5 / 0.5')).toBe('3');
        expect(await value('5.5 % 2')).toBe('1.5');
    });

    test('numbers inside a JSON value stay JSON numbers', async () => {
        expect(await value('{ a: 0.1, b: 2 }')).toEqual({ a: 0.1, b: 2 });
    });
});

describe('aggregates', () => {
    test('SUM is exact', async () => {
        expect(await value('SUM([0.1, 0.2, 0.3])')).toBe('0.6');
        expect(await value('SUM([1, 2, 3])')).toBe(6);
        expect(await value('SUM([1, 0.5])')).toBe('1.5');
    });

    test('AVG, MIN and MAX are exact', async () => {
        expect(await value('AVG([0.1, 0.3])')).toBe('0.2');
        expect(await value('MIN([0.30, 0.3, 0.4])')).toBe('0.3');
        expect(await value('MAX([0.1, 2, 0.4])')).toBe(2);
        expect(await value('MAX([0.1, 2.5, 0.4])')).toBe('2.5');
    });

    test('a SUM that SQL answers (numeric text) takes part in exact arithmetic', async () => {
        const executor = new Recorder([{ value: '0.2' }]);
        expect(await value('SUM(#Order.price) + 0.1 == 0.3', { executor })).toBe(true);
    });
});

describe('the INTEGER range', () => {
    const outOfRange = (result: { code?: string }) => expect(result.code).toBe('eval.integerOutOfRange');

    test('9007199254740991 + 1 is an error with a stable code', async () => {
        const result = await run('9007199254740991 + 1');
        expect(result.ok).toBe(false);
        if (!result.ok) outOfRange(result);
    });

    test('the largest integer is fine, and so is a result back inside the range', async () => {
        expect(await value('9007199254740991')).toBe(9007199254740991);
        expect(await value('9007199254740991 - 1 + 1')).toBe(9007199254740991);
    });

    test('multiplication and unary minus are checked too', async () => {
        for (const source of ['9007199254740991 * 2', '-9007199254740991 - 1', '9007199254740992']) {
            const result = await run(source);
            expect(result.ok, source).toBe(false);
            if (!result.ok) outOfRange(result);
        }
    });

    test('an integer column given as text or bigint becomes a number, or the range error', async () => {
        expect(await value('.big + 1', order({ id: 1, price: '1', quantity: 1, big: '41' }))).toBe(42);
        expect(await value('.big + 1', order({ id: 1, price: '1', quantity: 1, big: 41n }))).toBe(42);
        const result = await run('.big', order({ id: 1, price: '1', quantity: 1, big: 9007199254740993n }));
        expect(result.ok).toBe(false);
        if (!result.ok) outOfRange(result);
    });

    test('a DECIMAL may be larger than an INTEGER can be', async () => {
        expect(await value('9007199254740991.0 + 1')).toBe('9007199254740992');
    });
});

describe('SQL parameters', () => {
    test('a decimal literal is bound as text, with all its digits', async () => {
        const executor = new Recorder([{ value: true }]);
        await value('EXISTS(#Order[.price == 12345678901234567890.12])', { executor });
        expect(executor.queries[0].params).toEqual(['12345678901234567890.12']);
    });

    test('a decimal held by the interpreter is bound as text', async () => {
        const executor = new Recorder([{ value: true }]);
        await value('let t: DECIMAL = 0.1 + 0.2;\nEXISTS(#Order[.price == t])', { executor });
        expect(executor.queries[0].params).toEqual(['0.3']);
    });

    test('an integer literal stays a number', async () => {
        const executor = new Recorder([{ value: true }]);
        await value('EXISTS(#Order[.quantity == 3])', { executor });
        expect(executor.queries[0].params).toEqual([3]);
    });
});

describe('how values leave Minab', () => {
    test('formatValue prints a decimal plainly and still quotes text', () => {
        expect(formatValue('24.9')).toBe('24.9');
        expect(formatValue('170')).toBe('170');
        expect(formatValue('abc')).toBe('"abc"');
        expect(formatValue(170)).toBe('170');
    });

    test('externalize turns Big into text, deep, and keeps an unchanged value as it is', () => {
        expect(externalize({ a: [new Big('0.30'), 2], b: 'x' })).toEqual({ a: ['0.3', 2], b: 'x' });
        const rows = [{ id: 'o-1' }];
        expect(externalize(rows)).toBe(rows);
        expect(decimalText(new Big('-0'))).toBe('0');
    });
});
