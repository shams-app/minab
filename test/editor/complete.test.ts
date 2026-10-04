import { describe, expect, test } from 'vitest';
import { complete, type CompletionKind } from '../../src/editor/index.js';
import { cursor, open, setup } from './support.js';

const services = setup({
    rule: { isFieldRule: false, recordTable: 'Order' },
    host: true
});

async function labels(marked: string, kind?: CompletionKind): Promise<string[]> {
    const { source, offset } = cursor(marked);
    const result = await complete(open(services, source), offset);
    return result.items.filter(i => !kind || i.kind === kind).map(i => i.label);
}

describe('columns after a dot', () => {
    test.each([
        ['after `.` in a WHERE', 'FROM Order WHERE .|', ['id', 'total', 'status', 'customer_id', 'customer']],
        ['after `.customer.` follows the relation', 'FROM Order WHERE .customer.|', ['name', 'country', 'orders']],
        ['a partly typed column', 'FROM Order WHERE .to|', ['id', 'total']],
        ['`^.` is the record under validation', 'EXISTS(#Customer[.id == ^.|', ['total', 'status']],
        ['an alias', 'FROM Customer AS c WHERE c.|', ['name', 'country']],
        ['a column of a record input', 'currentUser.|', ['id', 'name']]
    ])('%s', async (_name, marked, expected) => {
        const found = await labels(marked, 'column');
        expect(found).toEqual(expect.arrayContaining(expected));
    });

    test('`.customer.` offers only the columns of Customer', async () => {
        expect(await labels('FROM Order WHERE .customer.|')).toEqual(['id', 'name', 'country', 'orders']);
    });

    test('a column has its type as detail, and a relation says where it goes', async () => {
        const { source, offset } = cursor('FROM Order WHERE .|');
        const items = (await complete(open(services, source), offset)).items;
        expect(items.find(i => i.label === 'total')).toMatchObject({
            kind: 'column',
            detail: 'DECIMAL'
        });
        expect(items.find(i => i.label === 'customer')?.detail).toContain('ref → Customer');
    });

    test('a column with a Persian name is inserted in backticks', async () => {
        const { source, offset } = cursor('FROM Order WHERE .|');
        const item = (await complete(open(services, source), offset)).items.find(i => i.label === 'مبلغ');
        expect(item).toMatchObject({ kind: 'column', insertText: '`مبلغ`' });
    });

    test('no columns when the left side has no table', async () => {
        expect(await labels('1 + 2 .|')).toEqual([]);
    });
});

describe('tables and aliases', () => {
    test.each([
        ['after FROM', 'FROM |'],
        ['after JOIN', 'FROM Order JOIN |'],
        ['after #', 'EXISTS(#|']
    ])('%s lists the tables', async (_name, marked) => {
        expect(await labels(marked, 'table')).toEqual(['Order', 'Customer']);
    });

    test('after # the aliases of the program are offered too', async () => {
        const found = await labels('FROM Order AS o WHERE EXISTS(#|');
        expect(found).toContain('o');
    });

    test('the replace range is the word being typed', async () => {
        const { source, offset } = cursor('FROM Cus|');
        const result = await complete(open(services, source), offset);
        expect(result.replace).toEqual({
            start: { line: 0, character: 5 },
            end: { line: 0, character: 8 }
        });
    });
});

describe('names, functions and keywords', () => {
    test('built-ins come with signatures', async () => {
        const { source, offset } = cursor('FROM Order WHERE |');
        const items = (await complete(open(services, source), offset)).items;
        expect(items.find(i => i.label === 'ROUND')).toMatchObject({
            kind: 'builtin',
            detail: 'ROUND(n: N, digits?: INTEGER) → N',
            insertText: 'ROUND($1)'
        });
    });

    test('a `let`, a parameter and a user function are in scope', async () => {
        const marked = 'let rate: DECIMAL = 2;\nfn discounted(price: DECIMAL, pct: DECIMAL): DECIMAL { |price }\n1';
        const { source, offset } = cursor(marked);
        const items = (await complete(open(services, source), offset)).items;
        expect(items.find(i => i.label === 'rate')).toMatchObject({
            kind: 'variable',
            detail: 'DECIMAL'
        });
        expect(items.find(i => i.label === 'price')?.detail).toContain('parameter');
        expect(items.find(i => i.label === 'discounted')).toMatchObject({
            kind: 'function',
            detail: 'fn discounted(price: DECIMAL, pct: DECIMAL): DECIMAL',
            insertText: 'discounted(${1:price}, ${2:pct})'
        });
    });

    test('a parameter is not offered outside its function', async () => {
        const found = await labels('fn discounted(price: DECIMAL): DECIMAL { price }\n|');
        expect(found).not.toContain('price');
    });

    test('an alias and a loop variable are names in scope', async () => {
        expect(await labels('FROM Order AS o WHERE |', 'variable')).toContain('o');
        expect(await labels('loop item in [1, 2] { |\n}', 'variable')).toContain('item');
    });

    test('a host input appears with its type, a host function with its signature', async () => {
        const { source, offset } = cursor('FROM Order WHERE |');
        const items = (await complete(open(services, source), offset)).items;
        expect(items.find(i => i.label === 'limit')).toMatchObject({
            kind: 'input',
            detail: 'INTEGER'
        });
        expect(items.find(i => i.label === 'currentUser')?.kind).toBe('input');
        expect(items.find(i => i.label === 'fxRate')).toMatchObject({
            kind: 'hostFunction',
            detail: 'fxRate(from: TEXT, to: TEXT) → DECIMAL',
            insertText: 'fxRate(${1:from}, ${2:to})'
        });
    });

    test('keywords come from the grammar, and built-ins only where an expression can start', async () => {
        const after = await labels('FROM Order |');
        expect(after).toEqual(expect.arrayContaining(['WHERE', 'SELECT', 'GROUPBY']));
        expect(after).not.toContain('COUNT');
        expect(await labels('FROM Order WHERE |')).toContain('COUNT');
        expect((await labels('FROM Order |', 'keyword')).length).toBeGreaterThan(0);
    });

    test('a host without declarations offers no inputs and no host functions', async () => {
        const bare = setup();
        const { source, offset } = cursor('FROM Order WHERE |');
        const items = (await complete(open(bare, source), offset)).items;
        expect(items.some(i => i.kind === 'input' || i.kind === 'hostFunction')).toBe(false);
    });
});
