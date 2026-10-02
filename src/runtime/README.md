# src/runtime

The runtime API of Minab (production plan R2, ADR 0002). One API for the CLI,
the playground, NestJS and the browser. It does not use Node, the DOM or a
database driver. A test checks the imports.

## Files

- `index.ts`: the public exports (the package entry `.`).
- `minab.ts`: `createMinab({ schema, ruleContext?, limits?, mode?, serviceCacheSize? })`.
  It returns `{ prepare, cacheStats, dispose }`.
- `prepare.ts`: `prepare` and the `PreparedProgram` it returns: `diagnostics`, `ok`,
  `kind`, `resultType`, `compile()`, `run()`. Also the `expect` check.
- `service-cache.ts`: Langium services, cached by schema version and rule context.
- `program-kind.ts`: tells a query from a rule from a value, and finds the result
  type. The playground uses it too.
- `types.ts`: the public types.

## Rules

- `prepare` never throws for a bad program. It returns diagnostics. It rejects only for
  a bad call (a disposed runtime, a source that is not a string).
- `run` never throws for a failed program. It returns `{ ok: false, error }`.
- Each `prepare` uses its own document URI and removes the document when done. A
  prepared program holds the AST, the interpreter and the compiler, and nothing of
  the workspace.
- Services are cached by `schema.version` (or a hash of the schema when it is
  missing). Two schemas with the same version must be the same schema.
- `mode` is `production` by default. `development` re-checks the grammar on every
  parser build and is slow (about 2.8 s per service set).
- Do not import `node:*`, `langium/node`, `vscode-languageserver/node` or `pg` from here.

## Not done yet

- `run` takes today's `QueryExecutor` as its data port. R3 adds the full ports.
- `limits` are stored, not enforced. R4 enforces them.
- Analysis (R5) and the wire format (R6) come later.
