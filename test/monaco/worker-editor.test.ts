/**
 * Production plan phase E5 — the three editor methods of the worker bridge (`complete`, `hover`,
 * `signatureHelp`), with the real worker code on a `MessageChannel`, and `registerMinab` on top of them.
 */

import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createWorkerMinab, type WorkerMinab } from '../../src/browser/index.js';
import { serveMinab } from '../../src/browser/worker.js';
import { registerMinab } from '../../src/monaco/index.js';
import { orderSchema } from '../support/runtime.js';
import { fakeModel, fakeMonaco } from './fake-monaco.js';

const rule = { recordTable: 'Order', isFieldRule: false };
const opened: Array<() => void> = [];

function setup() {
    const { port1, port2 } = new MessageChannel();
    const server = serveMinab(port2 as never);
    const minab = createWorkerMinab({ worker: () => port1 as never, schema: orderSchema(), ruleContext: rule });
    opened.push(() => {
        minab.dispose();
        server.close();
        port1.close();
        port2.close();
    });
    return minab;
}

afterEach(() => {
    for (const close of opened.splice(0)) close();
});

describe('the worker answers editor questions', () => {
    test('complete: the columns of the record table, after a dot', async () => {
        const minab = setup();
        const source = '.';
        const result = await minab.complete(source, 1);
        const labels = result.items.map(item => item.label);
        expect(labels).toEqual(expect.arrayContaining(['total', 'status', 'customer_id']));
        expect(result.replace.start).toEqual({ line: 0, character: 1 });
    });

    test('hover: the type of a column, and nothing over blank space', async () => {
        const minab = setup();
        const found = await minab.hover('.total', 3);
        expect(found?.contents).toMatch(/DECIMAL/);
        expect(await minab.hover('.total   ', 8)).toBeUndefined();
    });

    test('signatureHelp: the built-in being called and the argument the cursor is in', async () => {
        const minab = setup();
        const help = await minab.signatureHelp('ROUND(.total, ', 13);
        expect(help?.label).toMatch(/^ROUND\(/);
        expect(help?.activeParameter).toBe(1);
        expect(await minab.signatureHelp('1 + 2', 3)).toBeUndefined();
    });

    test('the rule context can change for one question', async () => {
        const minab = setup();
        const noRecord = await minab.complete('.', 1, { ruleContext: { isFieldRule: false } });
        expect(noRecord.items.map(item => item.label)).not.toContain('total');
    });

    test('a disposed runtime throws, like prepare', async () => {
        const minab: WorkerMinab = setup();
        minab.dispose();
        await expect(minab.hover('1', 0)).rejects.toThrow(/disposed/);
    });
});

describe('registerMinab with the real worker', () => {
    test('a model with a wrong name gets a marker with the code, and completion works through the bridge', async () => {
        const minab = setup();
        const fake = fakeMonaco();
        const registration = registerMinab(fake.monaco, { client: minab, debounceMs: 0 });
        try {
            const model = fakeModel('FROM Nope SELECT .id');
            fake.addModel(model);
            await vi.waitFor(() => expect(fake.markers.get('minab:inmemory://a')?.length).toBeGreaterThan(0));
            const [marker] = fake.markers.get('minab:inmemory://a') as Array<{ code: string; message: string; severity: number; startLineNumber: number }>;
            expect(marker.severity).toBe(8);
            expect(marker.code).toMatch(/\./);
            expect(marker.message.length).toBeGreaterThan(0);
            expect(marker.startLineNumber).toBe(1);

            const completion = fakeModel('.');
            const result = (await fake.providers.completion.provideCompletionItems(completion as never, { lineNumber: 1, column: 2 } as never)) as {
                suggestions: Array<{ label: string }>;
            };
            expect(result.suggestions.map(s => s.label)).toContain('total');
        } finally {
            registration.dispose();
        }
    });
});
