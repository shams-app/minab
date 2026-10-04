// Row: `run` a correlated rule with one data call (PGlite in process), without the database time. Budget: median, in ms.
// The time of the port call is measured inside the port and taken off.
import { performance } from 'node:perf_hooks';
import { load, median, orderSchema, recordContext, report, timeRuns } from '../lib.mjs';

const { createMinab } = await load('runtime/index.js');
const { createPgliteDataPort } = await load('browser/pglite.js');
const schema = await orderSchema();
const pglite = await createPgliteDataPort({
    schema,
    seed: {
        Customer: [{ id: 'c-1', name: 'Ada' }],
        Order: [
            { id: 'o-1', customer_id: 'c-1', total: 24.9, status: 'open' },
            { id: 'o-2', customer_id: 'c-1', total: 5, status: 'done' }
        ]
    }
});
let dbTime = 0;
const data = {
    async execute(query, options) {
        const start = performance.now();
        try {
            return await pglite.execute(query, options);
        } finally {
            dbTime += performance.now() - start;
        }
    }
};
const minab = createMinab({ schema, ruleContext: recordContext });
const program = await minab.prepare('COUNT(#Order[.customer_id == ^.customer_id]) < 5');
if (!program.ok || program.analysis.tier !== 'data') throw new Error('the bench rule must need data');
const record = { id: 'o-1', customer_id: 'c-1', total: 24.9, status: 'open' };
const own = [];
await timeRuns(
    async () => {
        dbTime = 0;
        const start = performance.now();
        const result = await program.run({ record }, { data });
        const total = performance.now() - start;
        if (!result.ok) throw new Error(`the bench rule failed: ${JSON.stringify(result.error)}`);
        own.push(total - dbTime);
    },
    { warmup: 50, runs: 300 }
);
report({ id: 'runCorrelated', value: median(own.slice(50)), unit: 'ms' });
await pglite.close();
