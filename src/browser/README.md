# src/browser

Entry points of the package for web apps: `@shamsine/minab/browser` and
`@shamsine/minab/browser/worker`. `pglite.ts` is still a stub (phase H5).

A web app runs Minab in a Web Worker. The parser stays off the main thread. The ports (data,
host functions, clock, events) stay where the app is, on the main thread, and the worker calls
them over a message bridge and waits for the answer (decision D30).

## Files

- `index.ts`: `createWorkerMinab({ worker, schema, functions, inputs, ... })`. It has `prepare` and
  `run` like `createMinab`, but `prepare`, `compile` and `run` are asynchronous. `dependsOn` is not.
- `worker.ts`: `serveMinab(endpoint, { ports })` hosts a runtime and answers the bridge messages.
  In a Web Worker this file starts itself. Write your own worker file when a port must live inside the
  worker (the playground keeps PGlite there): `serveMinab(self, { ports: { data } })`.
- `protocol.ts`: the message types (version 1), the value encoding and the error helpers. Both sides use it.
- `pglite.ts`: stub that exports `notReady` (phase H5).

## The bridge

- Every request has an `id` and the answer carries it back. Two runs at once do not mix.
- `port-call` goes from the worker to the main thread: `{ callId, runId, port, method, args }` with `port`
  one of `data`, `functions`, `clock`, `events`. The main thread answers with `port-result`.
  `events` calls are one way. The clock is read once, before the run starts.
- `cancel` (from an `AbortSignal` on the main thread) aborts the run and its pending port calls.
  The port's own signal is aborted too. When the run ends by its wall time (`limit.timeout`), the
  worker sends `cancel-call` and the port's signal is aborted the same way.
- Errors cross as `{ code, message, range?, params }`, never as `Error` objects. A failure of the bridge
  itself is `wire.workerFailed`. A driver error keeps its SQLSTATE in `params`.
- Values use the encoding of `src/runtime/wire.ts`: a decimal is a string, a date is a string. Record fields,
  host inputs, `$` and host function arguments and results are encoded by their declared types. Rows from the
  data port, query parameters and a list of records have no known type: `Big` and `Date` cross as strings.
- A port can live in the worker. If the main thread gives a port for a run, it is used. If not, the
  worker's own port is used.

## Rules

- Nothing here imports Node or uses `window` or `document`. `test/browser/imports.test.ts` checks both entries.
- The playground does not use this yet (H7). Remote runs and routing are H5.
- The tests run the worker code in Node with a `MessageChannel` pair. The bridge does not care what is at the other end.
