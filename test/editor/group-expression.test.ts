/** Production plan phase P1: editor help inside a group expression. */

import { describe, expect, test } from 'vitest';
import { complete, hover } from '../../src/editor/index.js';
import { cursor, open, setup } from './support.js';

const services = setup({ rule: { isFieldRule: false, groupTable: 'Order' } });

async function labels(marked: string) {
    const { source, offset } = cursor(marked);
    return (await complete(open(services, source), offset)).items;
}

describe('group expression', () => {
    test('completion after "." lists the columns of the group table', async () => {
        const items = (await labels('SUM(.|')).map(i => i.label);
        expect(items).toEqual(expect.arrayContaining(['total', 'status', 'مبلغ']));
        expect(items).not.toContain('country');
    });

    test('inside an aggregate the number columns come first', async () => {
        const inside = (await labels('SUM(.|')).map(i => i.label);
        expect(inside.indexOf('total')).toBeLessThan(inside.indexOf('id'));
        expect(inside.indexOf('total')).toBeLessThan(inside.indexOf('status'));
        const outside = (await labels('.|')).map(i => i.label);
        expect(outside.indexOf('id')).toBeLessThan(outside.indexOf('total'));
    });

    test('a column is "a column of the group"', async () => {
        const item = (await labels('SUM(.|')).find(i => i.label === 'total');
        expect(item?.documentation).toContain('column of the group');
    });

    test('hover says "column of the group"', async () => {
        const { source, offset } = cursor('SUM(.to|tal)');
        expect(hover(open(services, source), offset)?.contents).toContain('a column of the group');
    });
});
