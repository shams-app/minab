/**
 * Phase Q3: the schema is the whole read surface (D01, D29). A table that is not in
 * the schema is a scope error, and no data port is called.
 */

import { describe, expect, test } from 'vitest';
import { createMinab, type DataPort } from '../../src/runtime/index.js';
import { orderSchema } from '../support/runtime.js';

const rule = { recordTable: 'Order', isFieldRule: false };

function spyPort() {
    const calls: unknown[] = [];
    const port: DataPort = {
        execute: async query => {
            calls.push(query);
            return [{ value: true }];
        }
    };
    return { port, calls };
}

describe('the schema is the read surface', () => {
    test('#Secret (not in the schema) is a scope error', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: rule });
        const program = await minab.prepare('EXISTS(#Secret[.id == ^.id])');
        expect(program.ok).toBe(false);
        expect(program.diagnostics[0]).toMatchObject({ severity: 'error' });
        expect(program.diagnostics[0].code).toMatch(/^scope\./);
    });

    test('FROM Secret, a join to it and a path through it are scope errors, and nothing reaches the data port', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: rule });
        const { port, calls } = spyPort();
        for (const source of ['FROM Secret SELECT .id', 'FROM Order JOIN Secret ON .id == Secret.id SELECT .id', 'EXISTS(#Secret)', '.secret_column == 1']) {
            const program = await minab.prepare(source);
            expect(program.ok, source).toBe(false);
            expect(await program.run({ record: { id: 'x' } }, { data: port }), source).toMatchObject({ ok: false });
        }
        expect(calls).toHaveLength(0);
    });

    test('a column that is not in the table is a scope error', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: rule });
        const program = await minab.prepare('FROM Order SELECT .password');
        expect(program.ok).toBe(false);
    });

    test('a table exists for a program only when its schema has it: the same text is fine under another schema', async () => {
        const base = orderSchema('v1');
        const wider = { ...base, version: 'v2', tables: [...base.tables, { ...base.tables[0], name: 'Secret' }] };
        expect((await createMinab({ schema: base }).prepare('FROM Secret SELECT .id')).ok).toBe(false);
        expect((await createMinab({ schema: wider }).prepare('FROM Secret SELECT .id')).ok).toBe(true);
    });

    test('a program cannot reach a host function or input the host did not declare', async () => {
        const minab = createMinab({ schema: orderSchema() });
        expect((await minab.prepare('process.env')).ok).toBe(false);
        expect((await minab.prepare('secretFunction(1)')).ok).toBe(false);
        expect((await minab.prepare('currentUser.id')).ok).toBe(false);
    });
});
