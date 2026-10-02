import { EmptyFileSystem } from 'langium';
import { validationHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';
import type { Model } from '../src/language/generated/ast.js';
import type { Diagnostic } from 'vscode-languageserver-types';

// A diagnostic's `message` is `string | MarkupContent` per the LSP type —
// every message this Validator produces is a plain string, so unwrap it.
function messageText(d: Diagnostic): string {
    return typeof d.message === 'string' ? d.message : d.message.value;
}

// Same fixture shape as test/scoping.test.ts — Minab itself never declares
// tables in-file, so a host-supplied schema stands in for the real one.
const fixtureSchema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('INTEGER') } },
                { name: 'credit_limit', type: { kind: 'scalar', type: scalarType('DECIMAL') } }
            ]
        },
        {
            name: 'Order',
            columns: [
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: false } },
                { name: 'total', type: { kind: 'scalar', type: scalarType('DECIMAL') } },
                { name: 'orders', type: { kind: 'collection', table: 'Order' } }
            ]
        }
    ],
    functions: []
};

let validateRecordRule: ReturnType<typeof validationHelper<Model>>;
let validateFieldRule: ReturnType<typeof validationHelper<Model>>;

beforeAll(async () => {
    // `recordTable: 'Order'` supplies the type checker's Phase 4 fallback
    // for a bare top-level `.field` (spec §6's "record under validation" —
    // Phase 2's scope resolver deliberately can't know this on its own).
    // `fieldType` similarly supplies `$`'s type — `.total` is DECIMAL, so
    // that's what the field-rule examples below compare `$` against.
    const record = createMinabServices(EmptyFileSystem, fixtureSchema, { isFieldRule: false, recordTable: 'Order' });
    const field = createMinabServices(EmptyFileSystem, fixtureSchema, {
        isFieldRule: true,
        recordTable: 'Order',
        fieldType: scalarType('DECIMAL')
    });
    validateRecordRule = validationHelper<Model>(record.Minab);
    validateFieldRule = validationHelper<Model>(field.Minab);
});

describe('`$` is only valid in a field-level rule', () => {
    test('rejected when the host has not marked this as a field rule', async () => {
        const result = await validateRecordRule(`.total > $`);
        expect(result.diagnostics.some(d => messageText(d).includes('only valid in a field-level rule'))).toBe(true);
    });

    test('accepted at the top level when the host marks this as a field rule', async () => {
        const result = await validateFieldRule(`.total > $`);
        expect(result.diagnostics).toHaveLength(0);
    });

    test('accepted anywhere in the program, including nested inside a function body, when marked as a field rule', async () => {
        const result = await validateFieldRule(`
            fn helper(): BOOLEAN {
                $ > 0
            }
            .total > 0
        `);
        expect(result.diagnostics.filter(d => messageText(d).includes('$'))).toHaveLength(0);
    });
});

describe('`KEY` is only valid after a `GROUPBY` clause', () => {
    test('rejected when there is no GROUPBY at all', async () => {
        const result = await validateRecordRule(`
            FROM Order
            SELECT KEY
        `);
        expect(result.diagnostics.some(d => messageText(d).includes('GROUPBY'))).toBe(true);
    });

    test('accepted in SELECT after a GROUPBY clause', async () => {
        const result = await validateRecordRule(`
            FROM Order
            GROUPBY .customer
            HAVING SUM(.total) > 1000
            SELECT KEY, SUM(.total) AS total_spent
        `);
        expect(result.diagnostics).toHaveLength(0);
    });
});

describe('`#alias` must reference a declared table or in-scope alias', () => {
    test('rejected for an unknown table', async () => {
        const result = await validateRecordRule(`EXISTS(#TotallyUnknownTable[.x == 1])`);
        expect(result.diagnostics.some(d => messageText(d).includes('unknown table or scope'))).toBe(true);
    });

    test('accepted for a known table', async () => {
        const result = await validateRecordRule(`EXISTS(#Customer[.id == 1])`);
        expect(result.diagnostics).toHaveLength(0);
    });
});
