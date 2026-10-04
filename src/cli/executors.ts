/**
 * The CLI's two data sources (roadmap Phase 6).
 *
 *  - `FixtureExecutor`: canned rows from the config file, so a rule or a
 *    query can be run, and its strategy inspected, with no database anywhere.
 *    It lives in `src/host/` because it needs no Node APIs.
 *  - Postgres: a real connection. Since R7 the code lives in `src/node/pg.ts`
 *    (`pgDataPort`, `connectPostgres`). This file keeps the old names so
 *    old imports work.
 */

import { connectPostgres } from '../node/pg.js';

export { DataSourceError, FixtureExecutor, traced } from '../host/fixture-executor.js';
export { connectPostgres, pgDataPort } from '../node/pg.js';

/** The old name: `PostgresExecutor.connect(url)` gives an object with `execute`, `statements` and `close`. */
export const PostgresExecutor = { connect: connectPostgres };
