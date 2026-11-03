/**
 * Production plan phase P1: group expressions (spec §4.2.1).
 *
 * One expression over the rows of a group of one table, like the `SELECT` part of a `GROUPBY` query. It checks,
 * it gets editor help, and it runs in the interpreter over `RunInputs.groupRows`.
 */

import { describe, expect, test } from 'vitest';
import { scalarType, type MinabRuleContext, type MinabSchema } from '../src/language/schema.js';
import { createMinab } from '../src/runtime/index.js';

const scalar = (base: Parameters<typeof scalarType>[0], nullable = false) => ({ kind: 'scalar' as const, type: scalarType(base, { nullable }) });

const schema: MinabSchema = {
    version: 'group-expression-tests',
    tables: [
        {
            name: 'Sale',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID') },
                { name: 'Revenue', type: scalar('DECIMAL', true) },
                { name: 'Cost', type: scalar('DECIMAL', true) },
                { name: 'Profit', type: scalar('DECIMAL', true) },
                { name: 'Price', type: scalar('DECIMAL') },
                { name: 'Units', type: scalar('INTEGER') },
                { name: 'Region', type: scalar('TEXT') },
                { name: 'Total cost', type: scalar('DECIMAL') },
                { name: 'مبلغ', type: scalar('DECIMAL') },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: true, foreignKey: 'customer_id' } },
                { name: 'customer_id', type: scalar('UUID', true) }
            ]
        },
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID') },
                { name: 'name', type: scalar('TEXT') }
            ]
        }
    ]
};

const group: MinabRuleContext = { isFieldRule: false, groupTable: 'Sale' };

function minab() {
    return createMinab({
        schema,
        functions: [{ name: 'fxRate', params: [{ name: 'c', type: 'TEXT' }], returns: 'DECIMAL' }],
        inputs: { currentUser: { id: 'UUID' }, limit: 'INTEGER' }
    });
}

async function prepare(source: string) {
    return await minab().prepare(source, { ruleContext: group });
}

async function value(source: string, groupRows: Record<string, unknown>[]) {
    const program = await prepare(source);
    expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    return await program.run({ groupRows });
}

const profitRows = [
    { Revenue: 20, Cost: 5 },
    { Revenue: 20, Cost: 8 },
    { Revenue: 8, Cost: 10 }
];

describe('values', () => {
    test('SUM(.Revenue) - SUM(.Cost) over the rows of the group', async () => {
        expect(await value('SUM(.Revenue) - SUM(.Cost)', profitRows)).toMatchObject({ ok: true, value: '25' });
        expect(await value('SUM(.Revenue) - SUM(.Cost)', profitRows.slice(0, 2))).toMatchObject({ ok: true, value: '27' });
    });

    test('SUM(.Price * .Units) multiplies per row and then adds', async () => {
        const rows = [
            { Price: 10, Units: 2 },
            { Price: 5, Units: 4 },
            { Price: 8, Units: 1 }
        ];
        expect(await value('SUM(.Price * .Units)', rows)).toMatchObject({ ok: true, value: '48' });
    });

    test('a ratio of two sums: null when the divisor is zero, and for no rows', async () => {
        const zero = [
            { Profit: 3, Revenue: 0 },
            { Profit: 4, Revenue: 0 }
        ];
        expect(await value('SUM(.Profit) / SUM(.Revenue)', zero)).toMatchObject({ ok: true, value: null });
        expect(await value('SUM(.Profit) / SUM(.Revenue)', [])).toMatchObject({ ok: true, value: null });
        const normal = [{ Profit: 3, Revenue: 4 }];
        expect(await value('SUM(.Profit) / SUM(.Revenue)', normal)).toMatchObject({ ok: true, value: '0.75' });
    });

    test('division by zero is null for /, % and \\, and stays an error outside a group expression', async () => {
        for (const op of ['/', '%', '\\']) {
            expect(await value(`SUM(.Units) ${op} 0`, [{ Units: 4 }])).toMatchObject({ ok: true, value: null });
        }
        const plain = await createMinab({ schema }).prepare('1 / 0');
        expect(await plain.run()).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero' } });
    });

    test('an empty group: SUM, AVG, MIN, MAX are null and COUNT is 0', async () => {
        for (const fn of ['SUM', 'AVG', 'MIN', 'MAX']) {
            expect(await value(`${fn}(.Price)`, [])).toMatchObject({ ok: true, value: null });
        }
        expect(await value('COUNT(.Price)', [])).toMatchObject({ ok: true, value: 0 });
        expect(await value('COUNT(.Price)', [{ Price: 1 }, { Price: 2 }])).toMatchObject({ ok: true, value: 2 });
    });

    test('a null in a row is left out, like SQL', async () => {
        const rows = [{ Revenue: 5 }, { Revenue: null }, { Revenue: 7 }];
        expect(await value('SUM(.Revenue)', rows)).toMatchObject({ ok: true, value: '12' });
        expect(await value('COUNT(.Revenue)', rows)).toMatchObject({ ok: true, value: 2 });
        expect(await value('SUM(.Revenue)', [{ Revenue: null }])).toMatchObject({ ok: true, value: null });
    });

    test('DECIMAL money is exact', async () => {
        expect(await value('SUM(.Price)', [{ Price: 0.1 }, { Price: 0.2 }])).toMatchObject({ ok: true, value: '0.3' });
        expect(await value('SUM(.Price)', [{ Price: '0.1' }, { Price: '0.2' }])).toMatchObject({ ok: true, value: '0.3' });
    });

    test('quoted names and Persian names', async () => {
        expect(await value('SUM(.`Total cost`)', [{ 'Total cost': 4 }, { 'Total cost': 6 }])).toMatchObject({ ok: true, value: '10' });
        expect(await value('SUM(.`مبلغ`)', [{ مبلغ: 4 }, { مبلغ: 6 }])).toMatchObject({ ok: true, value: '10' });
    });

    test('if and arithmetic around aggregates', async () => {
        const rows = [{ Revenue: 5 }, { Revenue: 7 }];
        expect(await value('if SUM(.Revenue) > 10 { 1 } else { 0 }', rows)).toMatchObject({ ok: true, value: 1 });
        expect(await value('MAX(.Revenue) - MIN(.Revenue)', rows)).toMatchObject({ ok: true, value: '2' });
    });

    test('a run without groupRows is a coded error', async () => {
        const program = await prepare('SUM(.Price)');
        expect(await program.run({})).toMatchObject({ ok: false, error: { code: 'eval.failed' } });
    });
});

describe('diagnostics', () => {
    async function codes(source: string) {
        const program = await prepare(source);
        return program.diagnostics.filter(d => d.severity === 'error');
    }

    test('a column outside an aggregate: aggregate.fieldOutsideAggregate, with the name and the range', async () => {
        const [d, ...rest] = await codes('.Price * 2');
        expect(rest).toEqual([]);
        expect(d).toMatchObject({ code: 'aggregate.fieldOutsideAggregate', params: { name: 'Price' } });
        expect(d.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 6 } });
        expect(d.message).toContain('wrap Price in SUM, AVG, MIN, MAX or COUNT');
    });

    test('a nested aggregate: aggregate.nested', async () => {
        const found = await codes('SUM(SUM(.Price))');
        expect(found.map(d => d.code)).toContain('aggregate.nested');
    });

    test.each([
        ['a FROM query', 'FROM Sale SELECT .Price'],
        ['a relation', 'SUM(.customer.name)'],
        ['a relation column', 'COUNT(.customer)'],
        ['a user function call', 'double(SUM(.Price))'],
        ['a host function call', 'fxRate("USD") * SUM(.Price)'],
        ['$', 'SUM(.Price) + $'],
        ['an input', 'SUM(.Price) * limit'],
        ['a statement', 'let x: INTEGER = 1; SUM(.Price)'],
        ['a function', 'fn f(a: INTEGER): INTEGER { a } SUM(.Price)'],
        ['a table reference', 'COUNT(#Sale)']
    ])('%s: groupExpression.unsupported', async (_name, source) => {
        const found = await codes(source);
        expect(
            found.map(d => d.code),
            source
        ).toContain('groupExpression.unsupported');
    });

    test('currentUser is allowed when the host declared it', async () => {
        expect(await codes('if currentUser.id == currentUser.id { SUM(.Price) } else { 0 }')).toEqual([]);
    });

    test('SUM of text is a type error as before', async () => {
        expect((await codes('SUM(.Region)')).length).toBeGreaterThan(0);
    });

    test('groupTable cannot be combined with recordTable or isFieldRule, and must be a table', async () => {
        const m = minab();
        await expect(m.prepare('1', { ruleContext: { isFieldRule: false, groupTable: 'Sale', recordTable: 'Sale' } })).rejects.toThrow(/groupTable/);
        await expect(m.prepare('1', { ruleContext: { isFieldRule: true, groupTable: 'Sale' } })).rejects.toThrow(/groupTable/);
        await expect(m.prepare('1', { ruleContext: { isFieldRule: false, groupTable: 'Nope' } })).rejects.toThrow(/not a table/);
    });
});

describe('result type and analysis', () => {
    test('kind and result type', async () => {
        const program = await prepare('SUM(.Revenue) - SUM(.Cost)');
        expect(program.kind).toBe('group-expression');
        expect(program.resultType).toBe('DECIMAL?');
        expect((await prepare('COUNT(.Price)')).resultType).toBe('INTEGER');
        expect((await prepare('SUM(.Units) / 2')).resultType).toBe('DECIMAL?');
    });

    test('groupColumns, aggregates, and tier local', async () => {
        const { analysis } = await prepare('SUM(.Revenue) - SUM(.Cost)');
        expect(analysis.groupColumns).toEqual(['Revenue', 'Cost']);
        expect(analysis.aggregates).toEqual([
            { fn: 'SUM', columns: ['Revenue'] },
            { fn: 'SUM', columns: ['Cost'] }
        ]);
        expect(analysis.tier).toBe('local');
        expect(analysis.needsData).toBe(false);
        expect(analysis.recordFields).toEqual([]);
        const product = (await prepare('SUM(.Price * .Units) / COUNT(.Units)')).analysis;
        expect(product.aggregates).toEqual([
            { fn: 'SUM', columns: ['Price', 'Units'] },
            { fn: 'COUNT', columns: ['Units'] }
        ]);
    });

    test('a run never calls the data port', async () => {
        const program = await prepare('SUM(.Price)');
        const port = {
            execute: () => {
                throw new Error('the data port was called');
            }
        };
        expect(await program.run({ groupRows: [{ Price: 1 }] }, { data: port })).toMatchObject({ ok: true, value: '1' });
    });

    test('the same prepared program runs for many groups', async () => {
        const program = await prepare('SUM(.Price)');
        const results = await Promise.all([1, 2, 3].map(n => program.run({ groupRows: [{ Price: n }, { Price: n }] })));
        expect(results.map(r => (r.ok ? r.value : r.error.code))).toEqual(['2', '4', '6']);
    });
});
