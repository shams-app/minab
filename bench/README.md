# bench

The speed and size budgets of Minab, and the scripts that measure them (production plan Q4, H5).
The numbers and what they mean for a host are in [`docs/performance.md`](../docs/performance.md).

## Files

- `budgets.json`: the agreed budget of each row. `allowance` is the factor CI adds for noisy machines
  (1.5). A row can set its own `allowance` (the bundle size uses 1).
- `run.mjs`: `npm run bench`. Runs every row in `rows/` in its own Node process, prints a table and
  writes `results.json` (not committed).
- `check.mjs`: `npm run bench:check`. Runs the bench, compares it with `budgets.json` and exits with 1 when a
  row is above its budget times its allowance. It writes the table to `$GITHUB_STEP_SUMMARY` on GitHub Actions.
  `--results <file>` compares a results file you already have, `--budgets <file>` uses another budgets file.
- `lib.mjs`: helpers for the rows: `timeRuns`, `median`, a small schema, `load` (imports built code from `out/`).
- `rows/*.mjs`: one script per row. A row prints one JSON line `{ id, value, unit }` as its last line.
  - `prepare-warm`, `prepare-cold`, `run-local`, `rerun-100`, `run-correlated`, `completion`, `memory`, `bundle`.
- `bundle.json`: size of each browser bundle (minified), written by `node scripts/browser-bundle.mjs` (H5).
- `run.d.mts`, `check.d.mts`: types for the tests.

## Rules

- Run `npm run build` first. The rows import the built code from `out/`.
- No dependency: rows use `performance.now()` loops with a warm-up, and report the **median**.
- A new row needs an entry in `budgets.json` with the same `id`, and a test in `test/bench-check.test.ts`
  (the list of ids).
- Do not edit `bundle.json` by hand. Run the script and commit the new file when a size changes on purpose.
- Change a budget only on purpose, and say why in the pull request. Never loosen a budget to get green:
  find the cause.
