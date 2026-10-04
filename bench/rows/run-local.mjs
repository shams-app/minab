// Row: `run` a prepared rule that needs no data (Node). Budget: median, in ms.
import { load, median, orderSchema, recordContext, report, timeRuns } from '../lib.mjs';

const { createMinab } = await load('runtime/index.js');
const minab = createMinab({ schema: await orderSchema(), ruleContext: recordContext });
const program = await minab.prepare('.total > 10 AND .status != "void"');
if (!program.ok || program.analysis.tier !== 'local') throw new Error('the bench rule must be local');
const record = { id: 'o-1', customer_id: 'c-1', total: 24.9, status: 'open' };
const times = await timeRuns(() => program.run({ record }), { warmup: 500, runs: 5000 });
report({ id: 'runLocal', value: median(times), unit: 'ms' });
