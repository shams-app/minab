# src/browser

Entry points of the package for web apps: `@shamsine/minab/browser`,
`@shamsine/minab/browser/worker` and `@shamsine/minab/browser/pglite`.

A web app runs Minab in a Web Worker. The parser stays off the main thread. The ports (data,
host functions, clock, events) stay where the app is, on the main thread, and the worker calls
them over a message bridge and waits for the answer (decision D30).

## Files

- `index.ts`: `createWorkerMinab({ worker, schema, functions, inputs, ... })`. It has `prepare` and
  `run` like `createMinab`, but `prepare`, `compile` and `run` are asynchronous. `dependsOn` is not.
- `index.ts` also has `complete`, `hover` and `signatureHelp` (phase E5). They send an `editor` message, and the
  worker answers with `src/editor/`. No `prepare` is needed, and the worker keeps no program for them.
- `worker.ts`: `serveMinab(endpoint, { ports })` hosts a runtime and answers the bridge messages.
  In a Web Worker this file starts itself. Write your own worker file when a port must live inside the
  worker (the playground keeps PGlite there): `serveMinab(self, { ports: { data } })`.
- `serveMinab` also takes `requests` (host requests: handlers that your own worker code answers, by name) and returns
  `emit(name, payload)` (host events). On the main thread, `request(name, payload, { signal })` and `onEvent(listener)`
  are the other end. Use them when the worker holds more than Minab (the playground's engine is one host request).
  A failure of a handler is `wire.requestFailed` with the handler's own message; an abort cancels the handler's `signal`.
  `serveMinab` on an endpoint that is already served replaces the earlier server, so a worker file that imports this
  module (it starts itself in a Web Worker) can call `serveMinab(self, ...)` with no second server.
- `protocol.ts`: the message types (version 1), the value encoding and the error helpers. Both sides use it.
- `remote.ts`: `createRemoteMinab({ endpoint, fetch?, headers?, maxBatch?, types?, events? })`. `run(ref, inputs, options)`
  runs a stored program `{ id, version }` on the server with wire format v1. Runs made in the same tick go out in one
  request (split at `maxBatch`, default 100). An `AbortSignal` ends the run with `cancelled` at once; the `fetch` is
  aborted when every run of its request is aborted. Failures of the network or of the answer are `wire.remoteFailed`.
- `route.ts`: `routeByTier({ local, remote, events? })`. `prepare({ id, version, source })` prepares the source locally.
  If the analysis tier is `local`, `run` runs in the worker with no network call. If it is `data`, `run` sends the id and
  version to the server. A program that fails its check stays local and gives its error. SQL and the schema are never sent (D28).
- `console.ts`: `consoleEventSink()` writes `LOG` output to the browser console (SQL too with `statements: true`).
  `emitLogs(sink, logs)` gives the `logs` of a remote result to the same sink.
- `pglite.ts`: `createPgliteDataPort({ schema, seed?, script? })`, a `DataPort` over PGlite (an optional peer) with
  `citext`. It makes the tables with `src/host/ddl.ts`. For demos and offline playgrounds only: production data
  programs go to the server (D30).

## The bridge

The bridge is version 1. Phase E5 added one request, `editor` (`method` is `complete`, `hover` or `signatureHelp`,
with `source` and `offset`). Phase H7 added the request `request` and the event `event` (host requests and host events). A message that an older worker does not know is ignored, so a new main thread and an
old worker fail by timeout, not by a wrong answer: keep both sides from the same package version.

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
- The playground uses this entry (H7): its worker is `serveMinab(self, { requests })` and its client is `createWorkerMinab`.
- `scripts/browser-bundle.mjs` builds these entries for the browser and fails if a Node-only module gets in
  (`pg`, `node:*`, `langium/node`, `vscode-languageserver/node`). Sizes are in `bench/bundle.json`.
- The tests run the worker code in Node with a `MessageChannel` pair. The bridge does not care what is at the other end.
