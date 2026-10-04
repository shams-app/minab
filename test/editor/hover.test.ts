import { describe, expect, test } from 'vitest';
import { hover } from '../../src/editor/index.js';
import { cursor, open, setup } from './support.js';

const services = setup({
    rule: { isFieldRule: false, recordTable: 'Order' },
    host: true
});

function at(marked: string) {
    const { source, offset } = cursor(marked);
    return hover(open(services, source), offset);
}

describe('hover', () => {
    test('a column shows its type', () => {
        expect(at('FROM Order WHERE .to|tal > 5 SELECT .id')?.contents).toContain('**type** `DECIMAL`');
    });

    test('a column on a path shows its table', () => {
        const contents = at('FROM Order WHERE .customer.na|me == "x"')?.contents;
        expect(contents).toContain('column of `Customer`');
        expect(contents).toContain('**type** `TEXT`');
    });

    test('a column with a Persian name works, and its SQL name is shown', () => {
        const contents = at('FROM Order WHERE .`مب|لغ` > 5')?.contents;
        expect(contents).toContain('**type** `DECIMAL`');
        expect(contents).toContain('SQL name `amount_fa`');
    });

    test('a column with the same SQL name has no note', () => {
        expect(at('FROM Order WHERE .to|tal > 5')?.contents).not.toContain('SQL name');
    });

    test('a user function shows its signature, at the call and at the declaration', () => {
        const program = 'fn discounted(price: DECIMAL, pct: DECIMAL): DECIMAL { price - pct }\ndiscounted(1, 2)';
        expect(at(program.replace('\ndiscounted', '\ndiscou|nted'))?.contents).toContain('fn discounted(price: DECIMAL, pct: DECIMAL): DECIMAL');
        expect(at(program.replace('fn discounted', 'fn discou|nted'))?.contents).toContain('fn discounted(price: DECIMAL, pct: DECIMAL): DECIMAL');
    });

    test('a built-in shows its signature and one sentence', () => {
        const contents = at('RO|UND(2.5)')?.contents;
        expect(contents).toContain('ROUND(n: N, digits?: INTEGER) → N');
        expect(contents).toContain('Rounds half away from zero');
    });

    test('a host function and a host input', () => {
        expect(at('fx|Rate("USD", "EUR")')?.contents).toContain('fxRate(from: TEXT, to: TEXT) → DECIMAL');
        expect(at('lim|it')?.contents).toContain('an input of the host');
        expect(at('lim|it')?.contents).toContain('**type** `INTEGER`');
    });

    test('a `#alias` shows its table, and a bare `#Table` says it is every row', () => {
        expect(at('FROM Order AS o WHERE EXISTS(#|o)')?.contents).toContain('the row bound to alias `o`');
        const table = at('EXISTS(#Cus|tomer[.id == 1])')?.contents;
        expect(table).toContain('every row of table `Customer`');
        expect(table).toContain('`name`');
    });

    test('an unknown `#alias` has no hover', () => {
        expect(at('EXISTS(#Nothi|ng[.id == 1])')).toBeUndefined();
    });

    test('a parameter and a `let`', () => {
        expect(at('fn f(pri|ce: DECIMAL): DECIMAL { price }')?.contents).toContain('parameter of type `DECIMAL`');
        expect(at('let ra|te: DECIMAL = 2;\nrate')?.contents).toContain('variable of type `DECIMAL`');
    });

    test('any expression shows its inferred type', () => {
        expect(at('1 + |2')?.contents).toContain('**type** `INTEGER`');
    });

    test('a keyword is reported as a keyword', () => {
        expect(at('FR|OM Order SELECT .id')).toMatchObject({
            keyword: 'FROM',
            contents: ''
        });
    });

    test('the range is the node under the cursor', () => {
        expect(at('FROM Order WHERE .to|tal > 5')?.range).toEqual({
            start: { line: 0, character: 17 },
            end: { line: 0, character: 23 }
        });
    });
});
