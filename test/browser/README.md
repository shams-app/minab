# test/browser

Tests of `src/browser/` (phase H4). No browser is needed.

## Files

- `bridge.test.ts`: the two-way bridge. A `MessageChannel` pair stands in for the worker.
- `imports.test.ts`: the import guard for both browser entries (no Node module, no `window`).

## Rules

- Close or dispose every runtime you create. Use ports that abort when their signal aborts.
