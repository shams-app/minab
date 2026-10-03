import { EmptyFileSystem } from 'langium';
import { validationHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import { createMinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabRuleContext, type MinabSchema } from '../src/language/schema.js';
import type { Model } from '../src/language/generated/ast.js';
import type { Diagnostic } from 'vscode-languageserver-types';

/**
 * C6: a top-level collection filter in a rule (`COUNT(.orders[.status == "x"])`)
 * must pass `check`. The rule has no `FROM`. Its `.` is the record under
 * validation, and only the host knows that table (`recordTable`).
 * These tests use the real validator and type checker.
 */

const schema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'name', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'orders', type: { kind: 'collection', table: 'Order' } }
            ]
        },
        {
            name: 'Order',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: false } },
                { name: 'status', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'items', type: { kind: 'collection', table: 'Item' } }
            ]
        },
        {
            name: 'Item',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'qty', type: { kind: 'scalar', type: scalarType('INTEGER') } }
            ]
        }
    ]
};

function messageText(d: Diagnostic): string {
    return typeof d.message === 'string' ? d.message : d.message.value;
}

async function diagnostics(source: string, ruleContext: MinabRuleContext): Promise<Diagnostic[]> {
    const services = createMinabServices(EmptyFileSystem, schema, ruleContext);
    const validate = validationHelper<Model>(services.Minab);
    return (await validate(source)).diagnostics;
}

async function expectClean(source: string, ruleContext: MinabRuleContext): Promise<void> {
    const ds = await diagnostics(source, ruleContext);
    expect(ds, ds.map(messageText).join('\n')).toHaveLength(0);
}

const CUSTOMER_RULE: MinabRuleContext = { isFieldRule: false, recordTable: 'Customer' };
const ORDER_RULE: MinabRuleContext = { isFieldRule: false, recordTable: 'Order' };

describe('a top-level collection filter in a rule', () => {
    test('the showcase §1 rule checks clean', async () => {
        await expectClean('COUNT(.orders[.status == "cancelled"]) < 5', CUSTOMER_RULE);
    });

    test('a nested filter checks clean', async () => {
        await expectClean('COUNT(.orders[EXISTS(.items[.qty > 2])]) > 0', CUSTOMER_RULE);
    });

    test('a filter on a relation of a relation checks clean', async () => {
        await expectClean('COUNT(.customer.orders[.status == "cancelled"]) < 5', ORDER_RULE);
    });

    test('a field rule can use `$` next to a filter', async () => {
        await expectClean('COUNT(.orders[.status == "cancelled"]) < $', {
            isFieldRule: true,
            fieldType: scalarType('INTEGER'),
            recordTable: 'Customer'
        });
    });

    test('a wrong column inside the filter is still reported', async () => {
        const ds = await diagnostics('COUNT(.orders[.nope == "x"]) < 5', CUSTOMER_RULE);
        expect(
            ds.some(d => /nope/.test(messageText(d))),
            ds.map(messageText).join('\n')
        ).toBe(true);
    });

    test('without `recordTable` the error still names the problem', async () => {
        const ds = await diagnostics('COUNT(.orders[.status == "cancelled"]) < 5', { isFieldRule: false });
        expect(ds.length).toBeGreaterThan(0);
        expect(ds.map(messageText).join('\n')).toMatch(/orders|table|record/i);
    });
});
