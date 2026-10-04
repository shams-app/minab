import { describe, expect, test } from 'vitest';
import { semanticTokens, type SemanticToken } from '../../src/editor/index.js';
import { open, setup } from './support.js';

const services = setup({ rule: { isFieldRule: false, recordTable: 'Order' }, host: true });

/** Every token as `text:type` (with `+modifier`s), in source order. */
function tokens(source: string): string[] {
    const lines = source.split('\n');
    return semanticTokens(open(services, source)).map((t: SemanticToken) => {
        const text = lines[t.line].slice(t.character, t.character + t.length);
        return `${text}:${t.type}${t.modifiers.map(m => '+' + m).join('')}`;
    });
}

describe('semantic tokens', () => {
    test('`.customer` is a field and `COUNT` is a built-in', () => {
        expect(tokens('FROM Order SELECT COUNT(.customer.orders)')).toEqual(
            expect.arrayContaining(['customer:property', 'COUNT:function+defaultLibrary', 'Order:class'])
        );
    });

    test('the sigils', () => {
        expect(tokens('FROM Order AS o WHERE ^ == . AND #o == $ AND KEY == null')).toEqual(
            expect.arrayContaining(['^:operator', '.:operator', '#:operator', '$:operator', 'KEY:operator'])
        );
    });

    test('the `.` of member access is not a sigil', () => {
        const found = tokens('FROM Order SELECT .customer.country');
        expect(found.filter(t => t === '.:operator')).toHaveLength(1);
    });

    test('keywords and types', () => {
        expect(tokens('let x: DECIMAL = 1;')).toEqual(['let:keyword', 'x:variable+declaration', 'DECIMAL:type']);
        expect(tokens('FROM Order WHERE true')).toEqual(expect.arrayContaining(['FROM:keyword', 'WHERE:keyword', 'true:keyword']));
    });

    test('user functions, parameters, `let`s and their declarations', () => {
        const found = tokens('fn discounted(total: DECIMAL): DECIMAL { total }\nlet rate: DECIMAL = 2;\ndiscounted(rate)');
        expect(found).toEqual(
            expect.arrayContaining([
                'discounted:function+declaration',
                'total:parameter+declaration',
                'total:parameter',
                'rate:variable+declaration',
                'discounted:function',
                'rate:variable'
            ])
        );
    });

    test('host functions and host inputs', () => {
        expect(tokens('fxRate("USD", "EUR") + limit')).toEqual(expect.arrayContaining(['fxRate:function+host', 'limit:variable+host']));
    });

    test('aliases, with and without `#`, and a `#Table`', () => {
        const found = tokens('FROM Order AS o JOIN Customer AS c ON .customer_id == c.id WHERE EXISTS(#o[.id == 1]) AND #Order == #Order');
        expect(found).toEqual(
            expect.arrayContaining(['o:namespace+declaration', 'c:namespace+declaration', 'c:namespace', 'o:namespace', 'Order:class', 'Customer:class'])
        );
    });

    test('an unknown name or function has no token, and strings and comments have none', () => {
        expect(tokens('nothing + missing(1) // note\n"text"')).toEqual([]);
    });

    test('a loop variable and an output column name', () => {
        expect(tokens('loop item in [1, 2] { item }')).toEqual(expect.arrayContaining(['item:variable+declaration', 'item:variable']));
        expect(tokens('FROM Order SELECT .total AS amount')).toEqual(expect.arrayContaining(['amount:property']));
    });

    test('a Persian name and a quoted name are one token each', () => {
        expect(tokens('FROM Order SELECT .مبلغ')).toContain('مبلغ:property');
        expect(tokens('let `my rate`: DECIMAL = 2;\n`my rate`')).toEqual(expect.arrayContaining(['`my rate`:variable+declaration', '`my rate`:variable']));
    });

    test('a program with a syntax error still gets tokens for the part that parsed', () => {
        expect(tokens('FROM Order SELECT COUNT(')).toEqual(expect.arrayContaining(['FROM:keyword', 'Order:class']));
    });
});
