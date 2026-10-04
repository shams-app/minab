// Row: resident memory with 50 cached schemas (MB). Run with `node --expose-gc`.
import { load, orderSchema, recordContext, report } from '../lib.mjs';

const { createMinab } = await load('runtime/index.js');
const minab = createMinab({ schema: await orderSchema('m-0'), ruleContext: recordContext, serviceCacheSize: 50 });
// One runtime has one schema, so use 50 runtimes. They share nothing, as 50 tenants would.
const all = [];
for (let i = 0; i < 50; i++) {
    const one = createMinab({ schema: await orderSchema(`m-${i}`), ruleContext: recordContext, serviceCacheSize: 50 });
    const program = await one.prepare('.total > 10');
    if (!program.ok) throw new Error('the bench rule must be ok');
    all.push(one);
}
globalThis.gc?.();
const rss = process.memoryUsage().rss / 1024 / 1024;
report({ id: 'memory50', value: rss, unit: 'MB', cacheSize: all[0].cacheStats().size });
void minab;
