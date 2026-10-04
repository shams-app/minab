// Helpers shared by the bench rows (phase Q4). No dependency: plain `performance.now()` loops.
// Rows import the built code from `out/` (run `npm run build` first).

import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Imports a built module, for example `load('runtime/index.js')`. */
export function load(path) {
    return import(pathToFileURL(join(root, 'out/src', path)).href);
}

export function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Times `fn` (sync or async) `warmup + runs` times. Returns the milliseconds of each timed run. */
export async function timeRuns(fn, { warmup = 20, runs = 200 } = {}) {
    for (let i = 0; i < warmup; i++) await fn(i);
    const times = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        await fn(warmup + i);
        times.push(performance.now() - start);
    }
    return times;
}

/** A small schema. `version` makes a new schema for the service cache. */
export async function orderSchema(version = 'bench-v1') {
    const { parseConfig } = await load('host/config.js');
    const { schema } = parseConfig({
        schema: {
            tables: [
                { name: 'Customer', primaryKey: 'id', columns: { id: 'UUID', name: 'TEXT' } },
                { name: 'Order', primaryKey: 'id', columns: { id: 'UUID', customer_id: 'UUID', total: 'DECIMAL', status: 'TEXT' } }
            ]
        }
    });
    return { ...schema, version };
}

export const recordContext = { recordTable: 'Order', isFieldRule: false };

/** A row script ends with `report(...)`. The runner reads the last line of its output. */
export function report(result) {
    console.log(JSON.stringify(result));
}
