/**
 * The entry `@shamsine/minab/node`: data ports and a clock for Node hosts.
 */
export { connectPostgres, pgDataPort } from './pg.js';
export type { PgClientLike, PostgresConnection } from './pg.js';
export { queryFunctionDataPort } from './query-function.js';
export type { QueryFunction, QueryFunctionResult } from './query-function.js';
export { systemClock } from './clock.js';
