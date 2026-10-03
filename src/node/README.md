# src/node

Entry points of the package (`@shamsine/minab/node` and related). Today they are stubs.
Phase H1 fills them with Node adapters: the pg data port and config helpers.

## Files

- `index.ts`: stub that exports `notReady`.

## Rules

- A stub exports `notReady` and names the phase that fills it. R2 made the files so the
  `exports` map in `package.json` is complete. Later phases never edit that map.
