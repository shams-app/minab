/**
 * The entry `@shamsine/minab/node`.
 * R7 added the pg data port. Phase H1 adds the other Node adapters (config helpers and more).
 */
export { connectPostgres, pgDataPort } from './pg.js';
export type { PgClientLike, PostgresConnection } from './pg.js';
