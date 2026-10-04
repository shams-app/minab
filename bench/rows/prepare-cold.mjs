// Row: the first `prepare` in a fresh process: new schema, cold services, production parser mode (ms).
// Each row runs in its own process, so this is a real cold start: it builds the parser too.
// `nextSchemaMs` is the median of nine more new schemas. They share the parser, so they are much cheaper.
import { performance } from 'node:perf_hooks';
import { load, median, orderSchema, recordContext, report } from '../lib.mjs';

const { createMinab } = await load('runtime/index.js');
const first = createMinab({ schema: await orderSchema('cold-first'), ruleContext: recordContext, mode: 'production' });
const start = performance.now();
await first.prepare('.total > 10');
const firstMs = performance.now() - start;

const next = [];
for (let i = 0; i < 9; i++) {
    const minab = createMinab({ schema: await orderSchema(`cold-${i}`), ruleContext: recordContext, mode: 'production' });
    const begin = performance.now();
    await minab.prepare('.total > 10');
    next.push(performance.now() - begin);
}
report({ id: 'prepareCold', value: firstMs, unit: 'ms', nextSchemaMs: median(next) });
