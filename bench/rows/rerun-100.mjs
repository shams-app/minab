// Row: re-run 100 prepared local rules after one field changes (browser worker code, in Node). Budget: total ms.
// A MessageChannel pair stands in for the worker, as in test/browser/bridge.test.ts.
import { MessageChannel } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { load, median, orderSchema, recordContext, report } from '../lib.mjs';

const { createWorkerMinab } = await load('browser/index.js');
const { serveMinab } = await load('browser/worker.js');
const { port1, port2 } = new MessageChannel();
const server = serveMinab(port2);
const minab = createWorkerMinab({ worker: () => port1, schema: await orderSchema(), ruleContext: recordContext });

const programs = [];
for (let i = 0; i < 100; i++) programs.push(await minab.prepare(`.status != "x${i}" OR .total > ${i}`));
const record = { id: 'o-1', customer_id: 'c-1', total: 24.9, status: 'open' };

async function rerun() {
    const start = performance.now();
    // After `total` changes, run the rules that depend on it. Here every rule reads `total`.
    const affected = programs.filter(p => p.dependsOn('total'));
    const results = await Promise.all(affected.map(p => p.run({ record })));
    const time = performance.now() - start;
    if (affected.length !== 100 || results.some(r => !r.ok)) throw new Error('the bench rules must all run');
    return time;
}
for (let i = 0; i < 10; i++) await rerun();
const times = [];
for (let i = 0; i < 40; i++) times.push(await rerun());
report({ id: 'rerun100', value: median(times), unit: 'ms' });
minab.dispose();
server.close();
port1.close();
port2.close();
