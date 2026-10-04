/**
 * The entry `@shamsine/minab/node`: data ports, write ports and a clock for Node hosts.
 */
export { connectPostgres, pgDataPort, pgWritePort } from './pg.js';
export type { PgClientLike, PgPoolLike, PostgresConnection } from './pg.js';
export { queryFunctionDataPort, queryFunctionWritePort } from './query-function.js';
export type { QueryFunction, QueryFunctionResult, WriteQueryFunction, WriteQueryResult } from './query-function.js';
export { systemClock } from './clock.js';
