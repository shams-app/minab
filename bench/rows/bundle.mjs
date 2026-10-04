// Row: gzip size of the browser worker bundle (bytes). It is built here with the same code as the bundle guard.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { report, root } from '../lib.mjs';

const { measure } = await import(pathToFileURL(join(root, 'scripts/browser-bundle.mjs')).href);
const { sizes, offenders } = await measure();
if (offenders.length > 0) throw new Error(`Node-only modules are in the browser bundle: ${offenders.join(', ')}`);
report({ id: 'workerGzip', value: sizes.worker.gzip, unit: 'bytes' });
