// Row: completion on a 200-line file. Budget: median, in ms. It uses the editor engine (src/editor),
// which the language server, Monaco and the browser worker all share.
import { EmptyFileSystem } from 'langium';
import { load, median, orderSchema, report, timeRuns } from '../lib.mjs';

const { createMinabServices } = await load('language/minab-module.js');
const { complete, parseDocument } = await load('editor/index.js');
const schema = await orderSchema();
const { Minab } = createMinabServices(EmptyFileSystem, schema, undefined, { mode: 'production' });

const lines = [];
for (let i = 0; i < 199; i++) lines.push(`fn f${i}(x: INTEGER): INTEGER { x + ${i} }`);
const source = `${lines.join('\n')}\n#Order[.st`;
if (source.split('\n').length !== 200) throw new Error('the bench file must have 200 lines');
const times = await timeRuns(async () => {
    const result = await complete(parseDocument(Minab, source), source.length);
    if (!result.items.some(item => item.label === 'status')) throw new Error('completion must offer "status"');
}, { warmup: 10, runs: 60 });
report({ id: 'completion', value: median(times), unit: 'ms' });
