import { createRemoteMinab, createWorkerMinab, routeByTier } from '@shamsine/minab/browser';
import MinabWorker from './minab.worker?worker';
import { ruleContext, schema } from './schema';

/** The parser and the checker run in a Web Worker, off the main thread. */
export const local = createWorkerMinab({ worker: () => new MinabWorker(), schema, ruleContext });

/** The run endpoint of the NestJS example (H3). The dev server and `vite preview` proxy `/minab` to it. */
export const remote = createRemoteMinab({ endpoint: '/minab/run', types: { schema, ruleContext } });

/** One `prepare` for app code: a rule that needs no data runs here, a rule that needs data goes to the server by id. */
export const router = routeByTier({ local, remote });
