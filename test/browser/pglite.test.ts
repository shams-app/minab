/**
 * Production plan phase H5 — the PGlite data port (`@shamsine/minab/browser/pglite`), for demos.
 */

import { afterAll, describe, expect, test } from 'vitest';
import { createPgliteDataPort, type PgliteDataPort } from '../../src/browser/pglite.js';
import { createMinab } from '../../src/runtime/index.js';
import { orderSchema } from '../support/runtime.js';

let port: PgliteDataPort | undefined;
afterAll(async () => {
    await port?.close();
});

describe('createPgliteDataPort', () => {
    test('makes the tables from the schema, inserts the seed and runs a program', async () => {
        port = await createPgliteDataPort({
            schema: orderSchema(),
            seed: {
                Order: [
                    { id: 'o-1', customer_id: 'c-1', total: 24.9, status: 'open' },
                    { id: 'o-2', customer_id: 'c-1', total: 5, status: 'done' }
                ]
            }
        });
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order WHERE .status == "open" SELECT .id');
        expect(await program.run({}, { data: port })).toMatchObject({ ok: true, value: [{ id: 'o-1' }] });
    }, 60_000);

    test('a bad script closes the database and fails with a clear message', async () => {
        await expect(createPgliteDataPort({ schema: orderSchema(), script: 'THIS IS NOT SQL;' })).rejects.toThrow(/could not create the demo tables/);
    }, 60_000);
});
