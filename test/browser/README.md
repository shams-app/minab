# test/browser

Tests of `src/browser/` (phases H4 and H5). No browser is needed.

## Files

- `bridge.test.ts`: the two-way bridge. A `MessageChannel` pair stands in for the worker.
- `remote.test.ts`: the remote client, the tier router and the console sink, with a mock `fetch`.
- `bundle.test.ts`: the bundle guard of `scripts/browser-bundle.mjs`, including a try with `src/node` imported.
- `pglite.test.ts`: the PGlite data port.
- `imports.test.ts`: the import guard for both browser entries (no Node module, no `window`).

## Rules

- Close or dispose every runtime you create. Use ports that abort when their signal aborts.
