import { describe, expect, test } from 'vitest';
import { findReferences, prepareRename, rename, type EditorRange } from '../../src/editor/index.js';
import { applyEdits, cursor, diagnose, open, setup } from './support.js';

const services = setup({
    rule: { isFieldRule: false, recordTable: 'Order' },
    host: true
});

function slice(source: string, range: EditorRange): string {
    return source.split('\n')[range.start.line].slice(range.start.character, range.end.character);
}

function references(marked: string, includeDeclaration = true) {
    const { source, offset } = cursor(marked);
    return findReferences(open(services, source), offset, includeDeclaration).map(r => ({
        text: slice(source, r.range),
        line: r.range.start.line,
        declaration: r.isDeclaration
    }));
}

/** The program after renaming the symbol at the cursor, or the message that refuses it. */
function renamed(marked: string, newName: string): string {
    const { source, offset } = cursor(marked);
    const result = rename(open(services, source), offset, newName);
    return result.ok ? applyEdits(source, result.edits) : `refused: ${result.message}`;
}

describe('find references', () => {
    test('a `fn` lists its declaration and its calls', () => {
        const found = references('fn disc|ounted(x: DECIMAL): DECIMAL { x }\ndiscounted(1) + discounted(2)');
        expect(found.map(r => [r.text, r.line, r.declaration])).toEqual([
            ['discounted', 0, true],
            ['discounted', 1, false],
            ['discounted', 1, false]
        ]);
    });

    test('without the declaration', () => {
        expect(references('let rate: DECIMAL = 2;\nra|te + rate', false).map(r => r.declaration)).toEqual([false, false]);
    });

    test('a parameter is found in its own `fn` only', () => {
        const found = references('fn f(price: DECIMAL): DECIMAL { pri|ce }\nfn g(price: DECIMAL): DECIMAL { price }');
        expect(found.map(r => r.line)).toEqual([0, 0]);
    });

    test('a loop variable and its uses', () => {
        expect(references('loop it|em in [1, 2] { item + item }').map(r => r.text)).toEqual(['item', 'item', 'item']);
    });

    test('an alias is found with and without `#`', () => {
        const found = references('FROM Order AS o WHERE EXISTS(#|o[.id == 1]) AND o.total > 1');
        expect(found.map(r => r.text)).toEqual(['o', 'o', 'o']);
    });

    test('a column with the same name as a `let` is not a use', () => {
        expect(references('let total: DECIMAL = 1;\nFROM Order WHERE .total > to|tal').map(r => r.text)).toEqual(['total', 'total']);
    });

    test('a host input, a column and a built-in have no references', () => {
        expect(references('currentU|ser.id')).toEqual([]);
        expect(references('FROM Order SELECT .to|tal')).toEqual([]);
        expect(references('COU|NT([1])')).toEqual([]);
    });
});

describe('rename', () => {
    test('renaming a `let` renames every use and nothing else', () => {
        expect(renamed('let to|tal: DECIMAL = 1;\nFROM Order WHERE .total > total', 'sum')).toBe('let sum: DECIMAL = 1;\nFROM Order WHERE .total > sum');
    });

    test('renaming from a use works the same', () => {
        expect(renamed('let rate: DECIMAL = 2;\nra|te + rate', 'r')).toBe('let r: DECIMAL = 2;\nr + r');
    });

    test('a `fn` is renamed at its calls', () => {
        expect(renamed('fn disc|ounted(x: DECIMAL): DECIMAL { x }\ndiscounted(1)', 'reduced')).toBe('fn reduced(x: DECIMAL): DECIMAL { x }\nreduced(1)');
    });

    test('an alias is renamed in `AS`, in `#alias` (the `#` stays) and in `alias.column`', () => {
        expect(renamed('FROM Order AS |o WHERE EXISTS(#o[.id == 1]) AND o.total > 1', 'ord')).toBe(
            'FROM Order AS ord WHERE EXISTS(#ord[.id == 1]) AND ord.total > 1'
        );
    });

    test('a parameter is renamed inside its `fn`, and the same name in another `fn` stays', () => {
        expect(renamed('fn f(pri|ce: DECIMAL): DECIMAL { price }\nfn g(price: DECIMAL): DECIMAL { price }', 'p')).toBe(
            'fn f(p: DECIMAL): DECIMAL { p }\nfn g(price: DECIMAL): DECIMAL { price }'
        );
    });

    test('a `let` used as a JSON shorthand keeps its key', () => {
        expect(renamed('let to|tal: INTEGER = 1;\n{ total }', 'sum')).toBe('let sum: INTEGER = 1;\n{ total: sum }');
    });

    test('a name that needs backticks gets them', () => {
        expect(renamed('let ra|te: DECIMAL = 2;\nrate', 'my rate')).toBe('let `my rate`: DECIMAL = 2;\n`my rate`');
        expect(renamed('let ra|te: DECIMAL = 2;\nrate', 'FROM')).toBe('let `FROM`: DECIMAL = 2;\n`FROM`');
        expect(renamed('let ra|te: DECIMAL = 2;\nrate', '`already quoted`')).toBe('let `already quoted`: DECIMAL = 2;\n`already quoted`');
    });

    test('a Persian name stays plain', () => {
        expect(renamed('let ra|te: DECIMAL = 2;\nrate', 'نرخ')).toBe('let نرخ: DECIMAL = 2;\nنرخ');
    });

    test('a quoted name that is renamed to a plain one loses its backticks', () => {
        expect(renamed('let `my |rate`: DECIMAL = 2;\n`my rate`', 'rate')).toBe('let rate: DECIMAL = 2;\nrate');
    });

    test('a `fn` needs a lowercase letter (D10), may not be a table or host name (D11), may not repeat', () => {
        const source = 'fn disc|ounted(x: DECIMAL): DECIMAL { x }\nfn other(): INTEGER { 1 }\ndiscounted(1)';
        expect(renamed(source, 'TAX')).toMatch(/^refused: .*lowercase letter/);
        expect(renamed(source, 'Customer')).toMatch(/^refused: .*table name/);
        expect(renamed(source, 'fxRate')).toMatch(/^refused: .*host input or host function/);
        expect(renamed(source, 'other')).toMatch(/^refused: .*already declared/);
    });

    test('a `fn` may not take the name of a `let` or a parameter (D11)', () => {
        expect(renamed('fn f|(): INTEGER { 1 }\nlet rate: INTEGER = 1;\nrate', 'rate')).toMatch(/^refused: .*name of a function/);
    });

    test('a `let` or a parameter may not take a function name, a host name or another `let` of its scope', () => {
        expect(renamed('fn tax(): INTEGER { 1 }\nlet ra|te: INTEGER = 1;\nrate', 'tax')).toMatch(/^refused: .*name of a function/);
        expect(renamed('let ra|te: INTEGER = 1;\nrate', 'limit')).toMatch(/^refused: .*host input or host function/);
        expect(renamed('let a: INTEGER = 1;\nlet |b: INTEGER = 2;\nb', 'a')).toMatch(/^refused: .*already declared/);
        expect(renamed('fn f(a: INTEGER, |b: INTEGER): INTEGER { a }', 'a')).toMatch(/^refused: .*already declared/);
    });

    test('a name that would capture another name is refused', () => {
        // `inner` in the `fn` would start to mean the parameter `x`.
        expect(renamed('fn f(x: INTEGER): INTEGER { let |inner: INTEGER = 1; inner + x }', 'x')).toMatch(/^refused:/);
        // `rate` outside the loop would start to mean the loop variable.
        expect(renamed('let rate: INTEGER = 1;\nloop |i in [1, 2] { i + rate }', 'rate')).toMatch(/^refused:/);
    });

    test('an empty name and a place that is not a program name are refused', () => {
        expect(renamed('let ra|te: INTEGER = 1;\nrate', '  ')).toMatch(/^refused: .*empty/);
        expect(renamed('FROM Order SELECT .to|tal', 'x')).toMatch(/^refused: .*Only a name this program declares/);
        expect(renamed('currentU|ser.id', 'x')).toMatch(/^refused: /);
    });

    test('the renamed program still checks', async () => {
        const source =
            'fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL { total - total * rate / 100 }\nFROM Order AS o WHERE discounted(o.total, 15) > 100 SELECT o.id';
        expect(await diagnose(services, source)).toEqual([]);
        const result = rename(open(services, source), 'fn disc'.length, 'reduced');
        if (!result.ok) throw new Error(result.message);
        const after = applyEdits(source, result.edits);
        expect(after).toContain('reduced(o.total, 15)');
        expect(await diagnose(services, after)).toEqual([]);
    });
});

describe('prepare rename', () => {
    test('gives the name and the current name as the placeholder', () => {
        const { source, offset } = cursor('FROM Order AS o WHERE EXISTS(#|o[.id == 1])');
        const result = prepareRename(open(services, source), offset);
        expect(result?.placeholder).toBe('o');
        expect(slice(source, result!.range)).toBe('o');
    });

    test('a quoted name has the placeholder without backticks', () => {
        const { source, offset } = cursor('let `my |rate`: DECIMAL = 2;');
        expect(prepareRename(open(services, source), offset)?.placeholder).toBe('my rate');
    });

    test('nothing to rename on a column, a built-in or a keyword', () => {
        for (const marked of ['FROM Order SELECT .to|tal', 'COU|NT([1])', 'FRO|M Order']) {
            const { source, offset } = cursor(marked);
            expect(prepareRename(open(services, source), offset)).toBeUndefined();
        }
    });
});
