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
- `changelog.mjs` — turns the fragments in `changes/` into a CHANGELOG section
  (`--version X.Y.Z`), checks them (`--check`) and prints one section as release
  notes (`--notes X.Y.Z`). `changelog.d.mts` types it for the tests.
- `bump-version.mjs` — sets the version of the root package and of the extension,
  with their lockfiles. `bump-version.d.mts` types it for the tests.
- `next-version.mjs` — prints the version of a `next` prerelease. `next-version.d.mts`
  types it for the tests. The three release scripts are used by
  `.github/workflows/release.yml` and `next.yml`. Steps for people:
  [`docs/releasing.md`](../docs/releasing.md). Tests: `test/release-scripts.test.ts`.

- `build-cjs.mjs` — bundles the CommonJS entries (`.`, `./node`, `./nestjs`) into
  `out/cjs/*.cjs` with esbuild (D32). `npm run build:cjs`; `build` and `build:release` run it.
  The consumer tests are in `test/consumers/`.

## Rules

- Plain Node (18+), ES modules (`.mjs`), no dependencies.
- Every script starts with a comment that says what it does and how to run it.
- Every script has a test in `test/`.
- `browser-bundle.mjs` — builds the browser entries for the browser platform, writes their sizes
  to `bench/bundle.json`, and fails if a Node-only module is in a bundle (H5). `browser-bundle.d.mts`
  types it for the tests. Run by `.github/workflows/browser-bundle.yml`. Tests: `test/browser/bundle.test.ts`.
