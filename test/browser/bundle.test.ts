/**
 * Production plan phase H5 — the bundle guard (`scripts/browser-bundle.mjs`) builds the browser entries and
 * fails when a Node-only module gets in.
 */

import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { APP_ENTRY, measure } from '../../scripts/browser-bundle.mjs';

const root = resolve(import.meta.dirname, '../..');

describe('browser bundle guard', () => {
    test('the browser entries have no Node-only module and report sizes', async () => {
        const { sizes, offenders } = await measure();
        expect(offenders).toEqual([]);
        expect(Object.keys(sizes)).toEqual(['app', 'browser', 'monaco', 'pglite', 'worker']);
        for (const size of Object.values(sizes)) {
            expect(size.gzip).toBeGreaterThan(0);
            expect(size.gzip).toBeLessThan(size.bytes);
        }
    }, 60_000);

    test('it fails when the browser side imports src/node', async () => {
        const poisoned = `import ${JSON.stringify(resolve(root, 'src/node/index.ts'))};\n${APP_ENTRY}`;
        const { offenders } = await measure({ appEntry: poisoned });
        expect(offenders.length).toBeGreaterThan(0);
        expect(offenders.join('\n')).toMatch(/"(node:|pg\b)/);
    }, 60_000);
});
