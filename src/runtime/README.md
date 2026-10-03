# src/runtime

The runtime API of Minab (production plan R2, ADR 0002). One API for the CLI,
the playground, NestJS and the browser. It does not use Node, the DOM or a
database driver. A test checks the imports.

## Files

- `index.ts`: the public exports (the package entry `.`).
- `minab.ts`: `createMinab({ schema, functions?, inputs?, ruleContext?, limits?, mode?, serviceCacheSize? })`.
  It returns `{ prepare, cacheStats, dispose }`. `functions` and `inputs` are the host's
  declared functions and inputs (D27). They are checked here: a bad name or type word
  throws a `HostDeclarationError`.
- `ports.ts`: the ports a host implements and gives to each `run`: `DataPort`, `WritePort`
  (interface only), `HostFunctions`, `ClockPort`, `EventSink`, and the event types.
- `prepare.ts`: `prepare` and the `PreparedProgram` it returns: `diagnostics`, `ok`,
  `kind`, `resultType`, `compile()`, `run()`. Also the `expect` check.
- `service-cache.ts`: Langium services, cached by schema version, rule context and host declarations.
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

- A run gets its inputs (`record`, `fieldValue`, `hostInputs`) and its ports (`data`, `write`,
  `hostFunctions`, `clock`, `events`). Inputs are given. Ports are asked.
- A `statement` event goes out just before each data call. The duration comes in the
  `timing` event (`phase: 'data'`) after it. The whole run ends with `timing` `run`. A sink
  must not throw: the runtime drops a throw.
- The clock is read once for each run. The default is the system clock in UTC.
- Host functions run in the interpreter only. `compile()` refuses them with
  `compile.hostFunctionInSql`.
- Run error codes so far: `eval.programInvalid`, `eval.failed`, `eval.missingInput`,
  `eval.hostFunctionMissing`, `eval.writesNotSupported`, `data.noPort`. R4 builds the
  structured errors.
- `expect` is optional. Without it nothing is checked and the program may return any type;
  `resultType` still reports the type.

## Not done yet

- A `QueryExecutor` (one argument) still fits the data port. R7 and R8 move the CLI and the
  playground to `DataPort`.
- `AbortSignal` is passed to the ports, but nothing checks it yet. R4 does.
- The write port is an interface. No statement uses it until X5.
- `limits` are stored, not enforced. R4 enforces them.
- Analysis (R5) and the wire format (R6) come later.
