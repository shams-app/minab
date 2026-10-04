import { describe, expect, test } from 'vitest';
import { documentSymbols } from '../../src/editor/index.js';
import { open, setup } from './support.js';

const services = setup({ rule: { isFieldRule: false, recordTable: 'Order' } });

const outline = (source: string) => documentSymbols(open(services, source));

describe('document symbols', () => {
    test('a `fn` has its parameters as children', () => {
        const [fn] = outline('fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL { total - total * rate / 100 }\ndiscounted(1, 2)');
        expect(fn).toMatchObject({ name: 'discounted', kind: 'function' });
        expect(fn.children.map(c => [c.name, c.kind, c.detail])).toEqual([
            ['total', 'parameter', 'DECIMAL'],
            ['rate', 'parameter', 'DECIMAL']
        ]);
        expect(fn.detail).toContain('discounted(total: DECIMAL');
    });

    test('the selection range is the name, inside the range', () => {
        const [fn] = outline('fn f(a: INTEGER): INTEGER { a }');
        expect(fn.selectionRange).toEqual({ start: { line: 0, character: 3 }, end: { line: 0, character: 4 } });
        expect(fn.range.start).toEqual({ line: 0, character: 0 });
        expect(fn.range.end.character).toBe(31);
    });

    test('a top-level `let` is a variable, and a `let` inside a `fn` is not listed', () => {
        const symbols = outline('let rate: DECIMAL = 2;\nfn f(): INTEGER { let inner: INTEGER = 1; inner }\nrate');
        expect(symbols.map(s => [s.name, s.kind])).toEqual([
            ['rate', 'variable'],
            ['f', 'function']
        ]);
        expect(symbols[0].detail).toBe('DECIMAL');
    });

    test('the aliases of the main query and its joins, in source order', () => {
        const symbols = outline('FROM Order AS o JOIN Customer AS c ON .customer_id == c.id SELECT c.name');
        expect(symbols.map(s => [s.name, s.kind])).toEqual([
            ['o', 'alias'],
            ['c', 'alias']
        ]);
    });

    test('a query without `AS` and a program without declarations give no symbols', () => {
        expect(outline('FROM Order SELECT .id')).toEqual([]);
        expect(outline('')).toEqual([]);
    });

    test('a quoted name is listed by its name without backticks', () => {
        expect(outline('let `my rate`: DECIMAL = 2;\n`my rate`').map(s => s.name)).toEqual(['my rate']);
    });
});
