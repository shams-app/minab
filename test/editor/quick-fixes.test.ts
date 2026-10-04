import { describe, expect, test } from 'vitest';
import { quickFixes, type FixableDiagnostic } from '../../src/editor/index.js';
import { applyEdits, diagnose, open, setup } from './support.js';

const services = setup({ rule: { isFieldRule: false, recordTable: 'Order' }, host: true });

/** The diagnostic with this code, as the language server would hand it to the quick fixes. */
async function diagnostic(source: string, code: string): Promise<FixableDiagnostic> {
    const found = (await diagnose(services, source)).find(d => d.code === code);
    if (!found) throw new Error(`no ${code} in ${source}`);
    return { code, range: found.range, params: (found.data as { params: FixableDiagnostic['params'] }).params };
}

async function fixes(source: string, code: string) {
    return quickFixes(open(services, source), await diagnostic(source, code));
}

describe('quick fixes: did you mean', () => {
    test('`discountd(…)` suggests `discounted`', async () => {
        const source = 'fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL { total }\ndiscountd(1, 2)';
        const found = await fixes(source, 'call.unknownFunction');
        expect(found.map(f => f.title)).toEqual(['Did you mean discounted?']);
        const after = applyEdits(source, found[0].edits);
        expect(after).toBe('fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL { total }\ndiscounted(1, 2)');
        expect(await diagnose(services, after)).toEqual([]);
    });

    test('a built-in is suggested whatever the case: `sum` gives `SUM`', async () => {
        const found = await fixes('FROM Order SELECT sum(.total)', 'call.unknownFunction');
        expect(found.map(f => f.title)).toContain('Did you mean SUM?');
    });

    test('a host function is suggested', async () => {
        const found = await fixes('fxRat("USD", "EUR")', 'call.unknownFunction');
        expect(found.map(f => f.title)).toEqual(['Did you mean fxRate?']);
    });

    test('at most 3 names, the closest first', async () => {
        const source = [
            'fn zorpa(): INTEGER { 1 }',
            'fn zorpb(): INTEGER { 1 }',
            'fn zorpc(): INTEGER { 1 }',
            'fn zorpd(): INTEGER { 1 }',
            'fn zorps(): INTEGER { 1 }',
            'zorp()'
        ].join('\n');
        const found = await fixes(source, 'call.unknownFunction');
        expect(found.map(f => f.title)).toEqual(['Did you mean zorpa?', 'Did you mean zorpb?', 'Did you mean zorpc?']);
    });

    test('a nearer name comes before a farther one', async () => {
        const source = 'fn zorpaa(): INTEGER { 1 }\nfn zorpa(): INTEGER { 1 }\nzorp()';
        const found = await fixes(source, 'call.unknownFunction');
        expect(found.map(f => f.title)).toEqual(['Did you mean zorpa?', 'Did you mean zorpaa?']);
    });

    test('nothing close gives no fix', async () => {
        expect(await fixes('zzzzzzzz(1)', 'call.unknownFunction')).toEqual([]);
    });

    test('an unknown name suggests the names in scope', async () => {
        const source = 'fn f(price: DECIMAL): DECIMAL { let discounted: DECIMAL = price; discountd }';
        const found = await fixes(source, 'scope.unknownName');
        expect(found.map(f => f.title)).toEqual(['Did you mean discounted?']);
        expect(await diagnose(services, applyEdits(source, found[0].edits))).toEqual([]);
    });

    test('an unknown name also suggests an alias, a loop variable and a host input', async () => {
        expect((await fixes('FROM Order AS ord WHERE EXISTS(#ord[.id == 1]) AND orx.total > 1', 'scope.unknownName')).map(f => f.title)).toEqual([
            'Did you mean ord?'
        ]);
        expect((await fixes('loop item in [1, 2] { itm }', 'scope.unknownName')).map(f => f.title)).toEqual(['Did you mean item?']);
        expect((await fixes('limt + 1', 'scope.unknownName')).map(f => f.title)).toEqual(['Did you mean limit?']);
    });

    test('a name that is declared later in another `fn` is not suggested', async () => {
        const source = 'fn f(): INTEGER { let secret: INTEGER = 1; secret }\nfn g(): INTEGER { secre }';
        expect(await fixes(source, 'scope.unknownName')).toEqual([]);
    });
});

describe('quick fixes: add a CAST', () => {
    test('`.status == 5` can cast either side, and each fix makes the diagnostic go away', async () => {
        const source = 'FROM Order WHERE .status == 5 SELECT .id';
        const found = await fixes(source, 'type.implicitCoercion');
        expect(found.map(f => f.title)).toEqual(['Add CAST(… AS INTEGER) around the left side', 'Add CAST(… AS TEXT) around the right side']);
        const afters = found.map(f => applyEdits(source, f.edits));
        expect(afters).toEqual(['FROM Order WHERE CAST(.status AS INTEGER) == 5 SELECT .id', 'FROM Order WHERE .status == CAST(5 AS TEXT) SELECT .id']);
        for (const after of afters) expect(await diagnose(services, after)).toEqual([]);
        expect((await diagnose(services, source)).map(d => d.code)).toContain('type.implicitCoercion');
    });

    test('a comparison with `<`', async () => {
        const source = 'FROM Order WHERE .status < 5 SELECT .id';
        const found = await fixes(source, 'type.implicitCoercion');
        expect(found.length).toBeGreaterThan(0);
        expect(await diagnose(services, applyEdits(source, found[1].edits))).toEqual([]);
    });

    test('nullable types are cast to the plain type', async () => {
        const source = 'FROM Order WHERE .customer_id == 5 SELECT .id';
        const found = await fixes(source, 'type.implicitCoercion');
        expect(found.map(f => f.title)).toContain('Add CAST(… AS UUID) around the right side');
        expect(found.map(f => f.title).join()).not.toContain('?');
    });

    test('an operand that is an expression is wrapped whole', async () => {
        const source = 'let a: INTEGER = 1;\nlet b: TEXT = "x";\na + 1 == b';
        const found = await fixes(source, 'type.implicitCoercion');
        expect(applyEdits(source, found[0].edits)).toContain('CAST(a + 1 AS TEXT) == b');
        expect(await diagnose(services, applyEdits(source, found[0].edits))).toEqual([]);
    });

    test('a collection has no CAST type: no fix', async () => {
        expect(await fixes('FROM Customer WHERE .orders == 5 SELECT .id', 'type.implicitCoercion')).toEqual([]);
    });
});

describe('quick fixes: other codes', () => {
    test('a code without a fix gives none', () => {
        const source = 'FROM Order SELECT .id';
        expect(
            quickFixes(open(services, source), {
                code: 'scope.unknownColumn',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                params: {}
            })
        ).toEqual([]);
    });

    test('a diagnostic that does not match the text gives none', () => {
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } };
        expect(quickFixes(open(services, 'abc'), { code: 'call.unknownFunction', range, params: { name: 'other' } })).toEqual([]);
        expect(quickFixes(open(services, 'abc'), { code: 'type.implicitCoercion', range, params: { left: 'TEXT', right: 'INTEGER' } })).toEqual([]);
    });
});
