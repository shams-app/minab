# Host helpers

Code a host (the CLI, the playground, tests) uses to run Minab. No driver is needed.

## Files

- `config.ts`: reads a host config (schema, rule context, fixture data, and the optional `directory` section:
  users, groups with tags, routes written in Minab, special users).
- `directory-functions.ts`: the host functions of the directory (`findUser`, `findGroup`, `single`,
  `singleOrNull`, `specialUser`, `groupsOf`) and `routeHostFunction` (at most 3 nested route calls).
  A host registers them; Minab's core does not.
- `ddl.ts`: turns a schema into `CREATE TABLE` and `INSERT` text. Pure and safe in a browser.
  `playground/src/engine/ddl.ts` re-exports it.
- `fixture-executor.ts`: a `QueryExecutor` that answers from canned rows, and `FixtureDirectory`, a
  `DirectoryPort` made from a config's `directory` section (routes run as Minab programs).
- `format.ts`: prints rows as text.
- `index.ts`: the package entry `@shamsine/minab/host`. It re-exports `parseConfig`, the
  fixture executor and the other helpers above.
