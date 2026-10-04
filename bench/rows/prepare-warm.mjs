// Row: `prepare` a typical one-line rule, warm service cache (Node). Budget: median, in ms.
import { load, median, orderSchema, recordContext, report, timeRuns } from '../lib.mjs';

const { createMinab } = await load('runtime/index.js');
const minab = createMinab({ schema: await orderSchema(), ruleContext: recordContext });
await minab.prepare('.total > 10'); // builds the services once
const times = await timeRuns(i => minab.prepare(`.total > ${i % 50} AND .status != "void"`), { warmup: 50, runs: 300 });
report({ id: 'prepareWarm', value: median(times), unit: 'ms' });
