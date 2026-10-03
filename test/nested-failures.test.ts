import { EmptyFileSystem } from 'langium';
import { validationHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';
import type { Model } from '../src/language/generated/ast.js';
import type { Diagnostic } from 'vscode-languageserver-types';

// Phase C8: every node type that can fail inference reports its own failure,
// also when it sits inside another expression.

const schema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'orders', type: { kind: 'collection', table: 'Order' } }
            ]
        },
        {
            name: 'Order',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('TEXT') } },
                {
                    name: 'total',
                    type: { kind: 'scalar', type: scalarType('DECIMAL') }
                }
            ]
        }
    ]
};

let validate: ReturnType<typeof validationHelper<Model>>;

beforeAll(async () => {
    validate = validationHelper<Model>(createMinabServices(EmptyFileSystem, schema).Minab);
});

async function errors(source: string): Promise<Diagnostic[]> {
    return (await validate(source)).diagnostics.filter(d => d.severity === 1);
}

function textAt(source: string, d: Diagnostic): string {
    const lines = source.split('\n');
    return lines[d.range.start.line].slice(d.range.start.character, d.range.end.character);
}

describe('nested failures are reported once, at the inner node', () => {
    test('ParentRecord: ^ with no parent scope, nested in a comparison', async () => {
        const source = `FROM Order WHERE ^ == .id SELECT .id AS id`;
        const found = await errors(source);
        expect(found).toHaveLength(1);
        expect(textAt(source, found[0])).toBe('^');
    });

    test('NameRef: unknown name inside an IN list', async () => {
        const source = `FROM Order WHERE .id IN [missing, "a"] SELECT .id AS id`;
        const found = await errors(source);
        expect(found).toHaveLength(1);
        expect(textAt(source, found[0])).toBe('missing');
    });

    test('NameRef: unknown name nested in a comparison', async () => {
        const source = `FROM Order WHERE .total > missing SELECT .id AS id`;
        const found = await errors(source);
        expect(found).toHaveLength(1);
        expect(textAt(source, found[0])).toBe('missing');
    });

    test('Subquery: broken subquery inside a comparison', async () => {
        const source = `FROM Order WHERE .total == (FROM Order SELECT .id AS a, .total AS b) SELECT .id AS id`;
        const found = await errors(source);
        expect(found).toHaveLength(1);
        expect(textAt(source, found[0])).toContain('FROM Order SELECT .id AS a');
    });
});

describe('no false positives', () => {
    test('a valid program with a subquery and a call has no error', async () => {
        const source = `FROM Customer WHERE COUNT(.orders[.total > 1]) > 0 SELECT .id AS id`;
        expect(await errors(source)).toEqual([]);
    });

    test('a valid single-column subquery has no error', async () => {
        const source = `FROM Order WHERE .total == (FROM Order SELECT .total AS m) SELECT .id AS id`;
        expect(await errors(source)).toEqual([]);
    });

    test('a built-in call gets no diagnostic on its callee name', async () => {
        const found = await errors(`FROM Customer SELECT COUNT(.orders) AS n`);
        expect(found).toEqual([]);
    });

    test('a SELECT alias in ORDERBY is fine, an unknown name there is reported', async () => {
        expect(await errors(`FROM Order SELECT .total AS amount ORDERBY amount DESC`)).toEqual([]);
        const source = `FROM Order SELECT .total AS amount ORDERBY nothere DESC`;
        const found = await errors(source);
        expect(found).toHaveLength(1);
        expect(textAt(source, found[0])).toBe('nothere');
    });

    test('an unknown function is reported once, on the call, not on the callee', async () => {
        const source = `FROM Order SELECT nothere(1) AS n`;
        const found = await errors(source);
        expect(found).toHaveLength(1);
        expect(textAt(source, found[0])).toBe('nothere(1)');
    });
});
