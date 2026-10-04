/**
 * Production plan phase H4 — `@shamsine/minab/browser`, `@shamsine/minab/browser/worker` and (E5) `@shamsine/minab/monaco`
 * run in a browser and in a Worker, so their import graphs must pass the same guard as the runtime.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { walk } from '../runtime-imports.test.js';

const root = resolve(import.meta.dirname, '../..');
const readFromDisk = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

describe('the browser entries do not depend on the environment', () => {
    for (const entry of ['src/browser/index.ts', 'src/browser/worker.ts', 'src/monaco/index.ts']) {
        test(`${entry} has no Node module, no database driver, no window or document`, () => {
            const { files, problems } = walk(resolve(root, entry), readFromDisk);
            expect(files.length).toBeGreaterThan(10);
            expect(problems).toEqual([]);
        });
    }

    test('the guard fails when the worker imports node:worker_threads', () => {
        const worker = resolve(root, 'src/browser/worker.ts');
        const poisoned = (file: string) => (file === worker ? `import 'node:worker_threads';\n${readFromDisk(file)}` : readFromDisk(file));
        expect(walk(worker, poisoned).problems).toEqual(['src/browser/worker.ts: imports "node:worker_threads"']);
    });
});
