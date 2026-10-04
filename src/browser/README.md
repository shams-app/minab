# src/browser

The browser entries of the package. Phase H4 built the worker bridge. Phase H5 fills `pglite.ts`.

## Files

- `index.ts`: entry `@shamsine/minab/browser`. `createWorkerMinab({ worker, schema, functions, inputs, limits, ... })`
  runs Minab in a Web Worker. It returns `{ prepare, dispose }`. `prepare` gives a `PreparedProgram` like the one
  from `createMinab` (`diagnostics`, `ok`, `kind`, `analysis`, `dependsOn`, `compile`, `run`). The ports you give to
  `run` stay on the page. The worker calls them.
- `worker.ts`: entry `@shamsine/minab/browser/worker`. `serveWorker(endpoint, { ports?, maxPrograms? })` hosts the
  runtime. Importing the file inside a Web Worker starts it on `self`. For a port that lives in the worker, make a worker
  file of your own: `serveWorker(self, { ports: { data } })`.
- `protocol.ts`: the messages (bridge version 1) and `toWire` / `fromWire`, which carry values across.
- `pglite.ts`: stub that exports `notReady` (phase H5).

## How it works

- The page sends `create`, `prepare`, `run`, `cancel` and `dispose`. Every request has an `id`, and the answer has the same `id`.
- During a run, the worker sends `port-call` (`data`, `functions`, `clock` or `events`, with a method and arguments).
  The page runs the port and sends `port-result`. The page only runs the methods on the list in `PORT_METHODS`.
- The clock is read once for each run, before the run starts, like in `createMinab`.
- An `AbortSignal` on `run` sends `cancel`. The worker aborts the run. The signal that the page port gets is aborted too.
- A port that does not answer ends the run with `limit.timeout` after the wall time (default 1 second, D36).
- Errors cross as `{ code, message, range?, params }`. A port error that has no code crosses as `data.error`
  with the SQLSTATE only. Its text never crosses.
- Values: a decimal travels as text and a date as ISO text. `toWire` tags them, because a port call has no type information.
  The runtime returns decimals as exact text, so a result looks the same with or without a worker.
- The worker keeps the last 4096 prepared programs. A run of an older one gives `wire.programExpired`.

## Rules

- No import of Node, the DOM or a database driver. `test/runtime-imports.test.ts` checks `index.ts` and `worker.ts`.
- The bridge only needs `postMessage` and `onmessage`. Tests use a `MessageChannel` pair instead of a worker.
- The write port does not cross the bridge yet (X5 builds writes). A program that writes fails with `eval.writesNotSupported`.
- Do not edit the `exports` map in `package.json`. R2 made it.
