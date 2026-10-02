# scripts

Small Node scripts for the repository itself (not for users of Minab).

## Files

- `plan-guard.mjs` — the plan guard. It reads a pull request title and the
  list of changed files, and fails (exit 1) when the phase in the title edits a
  protected file it may not edit. The rules are in
  [`docs/production/README.md`](../docs/production/README.md#protected-files).
  `.github/workflows/plan.yml` runs it on every pull request. Tests:
  `test/plan-guard.test.ts`.
- `diagnostics-doc.mjs` — writes `docs/reference/diagnostics.md` from the
  diagnostic registry (`src/language/diagnostics/codes.ts`). Run it with
  `npm run docs:diagnostics`. `node scripts/diagnostics-doc.mjs --check` exits 1
  when the page is out of date. `diagnostics-doc.d.mts` types its exports for the
  tests. Tests: `test/diagnostic-codes.test.ts`.

## Rules

- Plain Node (18+), ES modules (`.mjs`), no dependencies.
- Every script starts with a comment that says what it does and how to run it.
- Every script has a test in `test/`.
