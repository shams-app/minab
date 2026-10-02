# src/browser

Entry points of the package (`@shamsine/minab/browser` and related). Today they are stubs.
Phases H4 and H5 fill them with the browser client, the Web Worker entry and the PGlite data port.

## Files

- `index.ts`: stub that exports `notReady`.
- `pglite.ts`: stub that exports `notReady`.
- `worker.ts`: stub that exports `notReady`.

## Rules

- A stub exports `notReady` and names the phase that fills it. R2 made the files so the
  `exports` map in `package.json` is complete. Later phases never edit that map.
