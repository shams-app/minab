import { describe, expect, test } from 'vitest';
import { definition, type EditorRange } from '../../src/editor/index.js';
import { cursor, open, setup } from './support.js';

const services = setup({
    rule: { isFieldRule: false, recordTable: 'Order' },
    host: true
});

/** The text the target range covers. */
function targetText(marked: string): string | undefined {
    const { source, offset } = cursor(marked);
    const result = definition(open(services, source), offset);
    return result && slice(source, result.target);
}

function slice(source: string, range: EditorRange): string {
    const lines = source.split('\n');
    return lines[range.start.line].slice(range.start.character, range.end.character);
}

describe('go to definition', () => {
    test('a `#alias` goes to its `AS`', () => {
        expect(targetText('FROM Order AS o WHERE EXISTS(#|o[.id == 1])')).toBe('o');
    });

    test('a join alias goes to the join', () => {
        expect(targetText('FROM Order AS o JOIN Customer AS c ON .customer_id == c.id SELECT |c.name')).toBe('c');
    });

    test('a called `fn` goes to the name in its declaration', () => {
        const target = definition(
            open(services, 'fn discounted(price: DECIMAL): DECIMAL { price }\ndiscounted(1)'),
            'fn discounted(price: DECIMAL): DECIMAL { price }\ndisc'.length
        );
        expect(target?.target).toEqual({
            start: { line: 0, character: 3 },
            end: { line: 0, character: 13 }
        });
    });

    test('a parameter goes to the parameter', () => {
        expect(targetText('fn f(price: DECIMAL): DECIMAL { pri|ce }')).toBe('price');
    });

    test('a `let` goes to the declaration', () => {
        expect(targetText('let rate: DECIMAL = 2;\nra|te')).toBe('rate');
    });

    test('a loop variable goes to the loop', () => {
        expect(targetText('loop item in [1, 2] { it|em }')).toBe('item');
    });

    test('the origin is the token under the cursor', () => {
        const { source, offset } = cursor('FROM Order AS o WHERE EXISTS(#|o[.id == 1])');
        const result = definition(open(services, source), offset);
        expect(slice(source, result!.origin)).toContain('o');
    });

    test('a bare `#Table` points at itself: the table is declared by the host', () => {
        expect(targetText('EXISTS(#Cus|tomer[.id == 1])')).toBe('#Customer');
    });

    test('nothing for a host input, a built-in or an unknown name', () => {
        expect(targetText('lim|it')).toBeUndefined();
        expect(targetText('RO|UND(1)')).toBeUndefined();
        expect(targetText('nothi|ng')).toBeUndefined();
    });
});
