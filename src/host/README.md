# Host helpers

Code a host (the CLI, the playground, tests) uses to run Minab. No driver is needed.

## Files

- `config.ts`: reads a host config (schema, rule context, fixture data).
- `ddl.ts`: turns a schema into `CREATE TABLE` and `INSERT` text. Pure and safe in a browser.
  `playground/src/engine/ddl.ts` re-exports it.
- `fixture-executor.ts`: a `QueryExecutor` that answers from canned rows.
- `format.ts`: prints rows as text.
- `index.ts`: the package entry `@shamsine/minab/host`. It re-exports `parseConfig`, the
  fixture executor and the other helpers above.
