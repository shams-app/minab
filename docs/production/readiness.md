# Production readiness review (V4)

Date: 2026-11-08. Base: `main` at `b9d216c` (P2, the last code change), plus the fixes of this review.

This is the check of every point of "What production level means" in [`README.md`](README.md#what-production-level-means).
Each point has a verdict and its evidence. "This review" means the branch that adds this file.

**Result: every point is met.** The owner approved this review on 2026-11-08: no outside security review
before 1.0 (point 4), Shamsine's integration found no Minab problem (point 6), the site is live and W5 is
done (point 10), and 0.4.0 is not released, so the second release made only by the workflow is 1.0.0
itself (point 8, recorded in [`status/V5.md`](status/V5.md)). See [`status/V4.md`](status/V4.md).

## What this review fixed

The review ran the whole test suite, the differential suite and the query harness, then checked every
"Later" item of every status file against the code, with probes on PGlite for each one that could be a
wrong answer. It fixed these gaps, each with a test that fails without the fix:

| Gap | Fix | Test |
|---|---|---|
| `ALL` and `ANY` had no SQL form: a query with `ALL(.orders.paid)` passed `check` and failed at run time ("ALL has no SQL form yet"). A rule over a table failed in both runtimes. | SQL forms with `NOT EXISTS` / `EXISTS`. A `null` is not true, as in the interpreter. | `test/queries/cases/v4-all-any.cases.ts`, `test/differential/cases/v4-readiness.cases.ts` |
| `CAST(x AS INTEGER)` compiled to Postgres `integer`: 3,000,000,000 was a value in the interpreter and an error in SQL. `CAST(2.5 AS INTEGER)` and `CAST(true AS INTEGER)` with a bound value failed in Postgres. | `INTEGER` is `bigint`; a bare numeric parameter gets its type before the cast; `BOOLEAN` goes through `integer`. | `test/differential/cases/v4-readiness.cases.ts` |
| `"a" is null` passed `check` and failed in Postgres ("could not determine data type of parameter"). | A bare parameter before `IS NULL` gets its type. | same file |
| The type of `if` and `switch` was the type of one branch: `if c { 1 } else { null }` was `INTEGER`, `if c { 1 } else { .price }` was `INTEGER` with a `DECIMAL` value. | The type is the join of the branches: nullable if any branch is, `DECIMAL` if `INTEGER` and `DECIMAL` mix (spec §7.2). | `test/branch-types.test.ts` |
| A `DECIMAL` result that came from an `INTEGER` value (`COALESCE(.qty, .price)`, the `if` above, a host function) left the run as a number, not as text (spec §7.2). | The interpreter turns it into a decimal at the end of the run. | `test/branch-types.test.ts`, three expectations in `test/decimal.test.ts`, `test/ports.test.ts` and `l5-null.cases.ts` changed on purpose |
| `x += v` with a `null` failed ("expected a number"), while `x = x + v` gave `null`. The same for `SET { k +: v }` on a `JSON` array element. | Both follow the binary operator (spec §9.3, D46). | `test/branch-types.test.ts`, `test/writes-json-paths.test.ts` |
| `GROUPBY .customer.country SELECT .customer.country …` and `GROUPBY .customer.region SELECT KEY.name …` passed `check`, then Postgres refused them (42803). | The path of a key written again is the key; a key that is a record is grouped by its link column, and `KEY.<field>` reads the record through it. The joined key column now uses its `sqlName`. | `test/queries/cases/v4-group-paths.cases.ts` |
| `1 IN [1.0, 2.0]` and `switch 1.0 { 1 => … }`: Postgres compared the bare parameters as text and gave another answer than the interpreter. | Bare parameters of `IN` and of a `switch` get their types, as binary operators do since C10. | `test/differential/cases/v4-readiness.cases.ts` |
| A branch of an `if` or `switch` with no tail (`if c { LOG(1); } else { 2 }`) passed `check` and gave `null`, also where the type said it cannot. `FROM Nope` alone passed `check`. | `check` reports `type.blockNoValue` and `scope.unknownTable` (both codes existed, with no report). | `test/branch-types.test.ts`, `test/diagnostic-codes.test.ts` |
| A `DATE` that arrives as a JS `Date` (the `pg` driver, TypeORM, Prisma) was never read as a date, so `==` and `<` with it were always false. `pg` also makes it local midnight, the day before in UTC east of Greenwich. | A `Date` is read as its UTC date (spec §7.2). `pgDataPort` and `pgWritePort` give `date` columns back as the text the database sent. The embedding guide says what to do with `queryFunctionDataPort`. | `test/dates.test.ts`, `test/node-adapters.test.ts` |
| `MIN` and `MAX` over the rows of a group read every value as a number: text failed, and a `null` failed. | They use the same order as `GREATEST`/`LEAST` and skip `null`, as SQL does. | `test/group-expression.test.ts` |
| The weekly **Audit** workflow failed on 2026-10-26 and 2026-11-02: the playground's `monaco-editor` brings `dompurify` 3.4.8 (critical advisories), and even `monaco-editor` 0.57.0 pins a vulnerable 3.4.15. | `overrides` to `dompurify` 3.4.17 in `playground/package.json`. `npm audit --omit=dev`: 0 in the root, the playground and the extension. | [Audit run 28](https://github.com/shams-app/minab/actions/runs/41453072239) (the failure) |

The README, `SECURITY.md`, the documentation index, the embedding guide, the Shamsine guide and the
group-fragment reference were also brought up to date (point 9).

## 1. Correct — met

- **No known wrong-answer bug.** No `knownGap` is left in any case file of `test/differential/cases/` or
  `test/queries/cases/` (the C1 known-gaps file was closed by C9). The review's probes of the open Later
  items found the gaps above; all are fixed.
- **Both runtimes agree**: the differential suite (19 case files and this review's) and the query harness
  pass: 853 cases on PGlite in this review. The Postgres 16 workflow is green on `main`
  ([Postgres run 191](https://github.com/shams-app/minab/actions/runs/41709523996)), and CI on `main`
  ([CI run 207](https://github.com/shams-app/minab/actions/runs/41709523837)).
- **`check` and Postgres agree**: every case found where `check` accepted a program that Postgres or the
  compiler then refused (`ALL`/`ANY`, a bare literal before `is null`, grouped relation paths, a branch with
  no value, an unknown table) is fixed.
- **Known differences that stay** are documented, each with its rule, in the README "Known limitations"
  and the spec: `INTEGER` results above the safe range (the interpreter refuses, SQL computes), text order
  and case mapping outside the `C` collation (spec §5.3.1), and a dry run that does not see its own writes.

## 2. Complete — met

- A search of `src/` for "not executed yet", "not supported yet", "not implemented" finds nothing. The
  three "… yet" fallbacks left (`"X" is not evaluated yet`, `operator "X" is not evaluated yet`,
  `X has no SQL form`) are guards for node types and operators the grammar does not produce; the last
  one was reachable for `ALL`/`ANY` and is fixed.
- The refusals that stay are deliberate and documented in the README and the CHANGELOG: statements inside
  a query (`compile.blockInQuery`), functions that cannot be inlined into a query
  (`query.functionNotInlinable`), a host function in an `INSERT`/`UPDATE` value (`compile.notSql`), a
  relation step after a to-many step in a write path (`compile.writePath`), a member of a local `JSON`
  variable as a write target (refused when the program runs), and field filters on `JSON` array elements
  (`type.columnNeedsTable`).
- Every block of the spec and the showcase parses (`test/spec-examples.test.ts`), and the examples run
  (`test/examples.test.ts`).

## 3. Embeddable — met

- One runtime API (`createMinab`, `prepare`, `run`) used by the CLI, the playground, NestJS and the browser.
- On `main`: [Consumers](https://github.com/shams-app/minab/actions/runs/41709523955) (ESM, CommonJS, NestJS,
  Jest, Bun, old `moduleResolution`), [Example NestJS](https://github.com/shams-app/minab/actions/runs/41709523873)
  and [Example Browser](https://github.com/shams-app/minab/actions/runs/41709523826) are green.
- The published 0.3.0 passed the same checks from npm (V2 status). There is no 0.4.0 (see point 8);
  V5 runs them against the published 1.0.0.
- `pgDataPort` and `pgWritePort` now read `date` columns right in every time zone (see the table above).
- Compatibility policy: [`docs/compatibility.md`](../compatibility.md).

## 4. Safe — met (outside review: the owner decides)

- The Q3 suites pass in this review: `test/security/` (SQL injection, schema surface, prepare limits,
  `LIKE`) and `test/fuzz/` (prepare, run, JSON keys, group expressions).
- CodeQL (GitHub default setup) is green on `main` ([run](https://github.com/shams-app/minab/actions/runs/41709618947)).
- `npm audit --omit=dev`: 0 vulnerabilities in the root package, the extension and (after this review's
  fix) the playground. The dev tools still have advisories; the Audit workflow reports them without failing.
- [`SECURITY.md`](../../SECURITY.md) (reporting address, supported versions) and
  [`docs/security.md`](../security.md) (what a host must do) exist.
- **Owner (2026-11-08):** no outside security review before 1.0; it is on the post-1.0 list.

## 5. Fast enough — met

- The budgets are in [`docs/performance.md`](../performance.md) and CI checks them on every change under
  `src/`: [Performance run 16](https://github.com/shams-app/minab/actions/runs/41706432587) (P2, the last
  code change) is green. [Browser bundle](https://github.com/shams-app/minab/actions/runs/41709523882) is
  green on `main`. The pull request of this review runs the Performance workflow again.

## 6. Ready for Shamsine — met (the owner confirms Shamsine's side)

- [`docs/guides/shamsine.md`](../guides/shamsine.md) (G2), updated for 1.0 in this review: all 47 field
  types, schema, names, inputs, tiers, messages in fa, ar and tr, stored expressions.
- Done for Shamsine after 0.3.0: key access on `JSON` (M1b), links that follow the key of the record in
  hand and the `scalarType` export (M1), group expressions and their SQL fragment (P1, P2).
- Unicode and quoted names (L3), exact decimals (C2), stable codes (B1), tiers (R5), Monaco (E5) and
  CommonJS (H1) are done.
- **Owner (2026-11-08):** Shamsine's integration found no Minab problem that is not fixed.

## 7. Stable — met

- The policy (D38) is published in [`docs/compatibility.md`](../compatibility.md); from 1.0 the 1.x promise applies.
- The corpus test (`test/compat/compat.test.ts`) passes for 0.2.0 and 0.3.0. There is no 0.4.0 corpus,
  because there is no 0.4.0; V5 adds `test/compat/corpus/1.0.0`.
- Every diagnostic code is documented: `docs/reference/diagnostics.md` lists 135 codes, the generator
  (`scripts/diagnostics-doc.mjs`) gives no change, and `test/diagnostic-codes.test.ts` checks that every
  registry entry is reported by a program.
- Spec §12 has only resolved, retired or post-1.0 items.

## 8. Released by machine — met for 0.3.0; 1.0.0 is the second

- 0.3.0 went out from a tag push through `release.yml` with no manual step
  ([Release run 5](https://github.com/shams-app/minab/actions/runs/37496811110)): npm, the GitHub release,
  the Marketplace (36 s) and Open VSX (16 s). Since then Q6 made a real release possible only from the tag
  `v<version>` (`scripts/release-guard.mjs`).
- 0.2.0 needed manual steps (V1 status). 0.4.0 (V3) is not released: the owner chose on 2026-11-08 to
  release its content as 1.0.0. So the second release made only by the workflow is 1.0.0 itself, and V5
  records its run.
- Every merge publishes a `next` prerelease ([Next run 59](https://github.com/shams-app/minab/actions/runs/41709523799)).

## 9. Documented — met

- Spec, showcase, [embedding guide](../guides/embedding.md), [Shamsine guide](../guides/shamsine.md),
  [security notes](../security.md), [performance](../performance.md), [compatibility](../compatibility.md),
  [diagnostic codes](../reference/diagnostics.md), [wire format](../reference/wire-format.md) and the
  [documentation index](../README.md).
- The link check (`test/docs-links.test.ts`) passes. TypeDoc runs with `treatWarningsAsErrors` and
  `notDocumented` and is green ([Docs API](https://github.com/shams-app/minab/actions/runs/41709523912)).
- This review brought the README in line with the code: the known limitations (the `JSON` `null`
  limitation was fixed by C9; the `INTEGER` range and text order were missing), the project layout, a
  "Support" section and the dialect line. The embedding and Shamsine guides no longer say "before 1.0"
  or "not built yet" for things that shipped.

## 10. Visible — met

- W4 (deploy, Lighthouse, accessibility) is done. On `main`, [Deploy site](https://github.com/shams-app/minab/actions/runs/41709523933)
  and [Site checks](https://github.com/shams-app/minab/actions/runs/41709523945) are green.
- W5 (launch kit, TV demo mode) is done: the owner confirmed the demo and that `minab-lang.org` is live
  (2026-11-08). This session's network cannot reach the site. The **Site uptime** workflow checks the site
  only inside its launch window (18–27 October), so its later green runs prove nothing about the site.

## Dialect (D39)

Postgres only for 1.x: written in [ADR 0001](../adr/0001-execution-strategy.md) (consequences) and the
README. A second dialect is on the post-1.0 list.

## Licenses of the production dependencies

All allow distribution under MIT. From `npm ls --omit=dev --all` and each package's `license` field.

| Package | Version | License |
|---|---|---|
| `big.js` | 6.2.2 | MIT |
| `langium` | 4.4.0 | MIT |
| `chevrotain` | 13.2.0 | Apache-2.0 |
| `@chevrotain/cst-dts-gen`, `gast`, `regexp-to-ast`, `types`, `utils` | 13.2.0 | Apache-2.0 |
| `chevrotain-allstar` | 0.5.0 | MIT |
| `lodash-es` | 4.18.1 | MIT |
| `vscode-languageserver` | 10.1.1 | MIT |
| `vscode-languageserver-protocol`, `vscode-languageserver-types` | 3.18.3 | MIT |
| `vscode-jsonrpc` | 9.0.2 | MIT |
| `vscode-languageserver-textdocument` | 1.0.14 | MIT |
| `vscode-uri` | 3.1.0 | MIT |

The VS Code extension bundles `vscode-languageclient` 9.0.1, `vscode-languageserver-protocol` and
`-types` 3.17.5, `vscode-jsonrpc` 8.2.0, `brace-expansion` and `balanced-match` (MIT), `minimatch` and
`semver` (ISC). The optional peers (`pg`, `@nestjs/*`, `rxjs`, `reflect-metadata`, `monaco-editor`: MIT;
`@electric-sql/pglite`: Apache-2.0) are installed by the host, not shipped.

## Post-1.0

Every "Later" item of every status file (the list in [`progress.md`](progress.md#later)) was checked
against the code of this review. Items that are done or no longer apply are not listed. None of the
items below makes a valid program give a wrong answer, crash or hang its host, inject SQL or leak data.
One line per item, with the phase that logged it.

### Language and checks

- A second SQL dialect, SQLite first (D39). 1.x is Postgres only (ADR 0001)
- `type.notIterable` is reported only where the loop variable is read: `loop x in 5 { }` passes `check` and fails when it runs. A loop over a `JSON` array runs, but reading its variable is `type.notIterable`. Needs a design answer: the element type of a `JSON` array loop (V4)
- 14 spec blocks parse-only: need a fixture with doctor/customers relations (L2)
- Blocks with `...` placeholders and ✗ notes are skipped (L2)
- TextMate grammar has no name rule; backtick keyword coloured as keyword (L3)
- Completion uses ASCII word regexes, no help on Persian names (L3)
- VS Code `wordPattern` for Unicode names not set (L3)
- Playground table viewer finds tables by physical name (L3)
- Langium bug: a lone-backslash keyword is written unescaped (L4)
- `\` has no safe-range check in SQL; interpreter fails above 2^53 (L4)
- `.customer.id == x` differential case needs related rows in the harness (L4)
- `TypeResult.origin` with two ranges (L4)
- spec-examples test no longer adds a prelude to pieces starting with `let` (L4)
- Playground host fields for time zone and fixed "now" (L6)
- `logsTruncated` not in the wire format (L7)
- Log lines are one-line JSON, not tables (L7)
- Add a loop test for 150 logs once loops run (L7)
- A decimal in a list used as JSON becomes a JSON number (C2)
- Pushed-down rows keep the driver's text for numeric (`"8.30"`) (C2)
- Case folding: JS `toLowerCase()` vs database `lower()` (C5). Documented in spec §5.3.1 and the README
- Text order (`<`, `ORDERBY`, `GREATEST`, `LEAST`) is code-point order in the interpreter and the database collation in SQL (L5). Documented in the README; the two agree with the `C` collation

### Execution and writes

- Showcase example for `FROM .orders[filter]` (X1)
- Inline a function with `let`s by substitution (X2)
- Bare `KEY` over several keys has no record value (X2)
- Check-time error for `.$index` on a table collection (X4)
- Differential cases for loops (X4)
- Non-whole loop bounds give plain `eval.failed` (X4)
- Host function or non-inlinable function in SET/VALUES fails `compile.notSql` (X5)
- A dry run does not see its own writes (X5)
- Write parameter numbers are not in text order (X5)
- `INSERT` cannot name a relation, only its foreign key column (X5)
- Playground check-only tag and badge have no entry left (X5)
- Relation step after a to-many step refused (`compile.writePath`) (X6)
- Assignment through a member of a local `JSON` variable (`j.a = 1`) is refused when the program runs, and `check` does not report it (X3, X6). Running it needs a design (missing keys, arrays, `!`, `|=`)

### Runtime and hosts

- Split a core module without `lsp` services to shrink the bundle (R1)
- Finer codes: most failures are `eval.failed` / `compile.notSql` (R4)
- `RunStats` has no `loopIterations`, `maxCallDepth`, `droppedLogs`; `logs` empty (R4)
- `22003` only tested with a fake data port (R4)
- `inputs` lists names, not paths (R5)
- Queries and DML are always tier `data` (R5)
- A helper that builds a `WireResult` from a `RunResult` (R6)
- No CLI flag to change run limits (R7)
- Runtime should give check-only constructs and symbols; drop the second parse (R8)
- `.d.ts` files import `langium`; old resolution needs `skipLibCheck` (H1)
- CommonJS bundles are separate, so `PortError` identity differs (H1)
- Endpoint does not cancel runs when the client disconnects (H2)
- No hook to release a per-request transaction after the batch (H2)
- `StoredProgram.schemaVersion` not used (H2)
- Controller imports value helpers from `src/browser/protocol.ts` (H2)
- No lockfile entry for Minab in the example (H3)
- Data port rows and parameters have no type; `Big`/`Date` cross as strings (H4)
- `createWorkerMinab` has no `cacheStats` (H4)
- Wire answer has no result type; client needs `resultType` (H5)
- Remote client has no retry or timeout (H5)
- Firefox and WebKit runs (H6)
- Per-run worker ports, column names, engine runs through bridge `run` (H7)
- Drop the empty runtime `createWorkerMinab` makes in the playground (H7)
- A backtick name can reach a keyword-named host input (H8)
- A loader that builds a new schema object each request pays the hash (H8)
- `groupRows` over the worker bridge (P1)
- `parseRuleContext` does not read `groupTable` (P1)
- Explain mode for a failed cell; `FILTER`-style aggregates (P1)
- Host input values (`currentUser`) in a fragment (P2)
- A clock option for `NOW()` and `TODAY()` in a group fragment, which uses the system clock in UTC today (P2). Documented in `docs/reference/compile-group-expression.md`
- `COUNT(DISTINCT …)` and `MEDIAN` aggregates (P2)

### Editors

- Completion matches only ASCII words; backtick names get no help (E1)
- Prepared program does not keep its document (E1)
- No `./editor` entry in package `exports` (E1)
- Files a config names are not watched (E2)
- Host functions and inputs cannot be declared in `minab.config.json` (E2)
- Checks run on every change with no delay (E2)
- `test/lsp.test.ts` tests unused Langium providers (E2)
- `vscode-languageserver-protocol` used by tests, not a direct dependency (E2)
- Rename works in one document only (E3)
- No "Did you mean" for unknown alias or column (E3)
- Folding ranges and inlay hints (E3)
- Extension smoke test failed once at VS Code start (E4)
- Run `docs/editors.md` launch lines in Neovim, Helix, Zed (E4)
- A "Get Started" walkthrough (E4)
- Playground keeps its own `monaco/language.ts` instead of `./monaco` (E5)
- Worker keeps a second editor service cache (E5)
- Mixed new main thread and old worker waits forever (E5)

### CI, release and quality

- Type-aware lint for `vscode-extension/src` (moduleResolution) (B1)
- Show the code in CLI human output and in the playground UI (B1)
- Release notes in Persian (Q2)
- Replace `OVSX_PAT` with an Open VSX trusted publisher (Q2)
- `VSCE_PAT` and `OVSX_PAT` expire; set a renewal reminder (Q2)
- CodeQL workflow (Q3)
- An outside security review (Q3). The owner chose to do it after 1.0 (2026-11-08)
- `LIKE` is O(text × pattern) and cannot be interrupted (Q3)
- Widen the `run` fuzz generator (loops, switch, functions, DML) (Q3)
- Parse time and memory of deeply nested programs (Q3)
- A `warmUp()` helper for the first-prepare parser build (Q4)
- Shared parser keeps the first service set alive (Q4)
- Completion parses the whole file each call; cache by source hash (Q4)
- Memory row measures the whole process; Minab's own share needs a baseline (Q4)
- Benchmarks against a real Postgres over the network (Q4)
- NestJS endpoint and wire format do not carry `languageVersion` (Q5)
- Corpus leaves out template, prelude and wrong-on-purpose blocks (Q5)
- A `minab migrate` CLI command once a migration exists (Q5)

### Docs

- Publish `out/api/` (G1)
- Require doc comments on properties (G1)
- A hosted docs site (G1)
- Shamsine helper `toMinabSchema(dataset)` (G2)
- Range types (`numberRange`, `timeline`) (G2)

### Website

- Social handles for launch posts (W1)
- Persian version of the site (W1)
- Light variant of the OG image (W2)
- "Names" tag in `content/examples`, name line in `content/landing.ts` (W3)
- Pushdown underline in the hero's Rule code (W3)
- `og:image` uses a root path, not an absolute URL (W3)
- Spinner keeps turning under reduced motion (W4)
- Landing performance has little margin (W4)
- Dev-only `npm audit` findings in `@lhci/cli` (W4)
- Reload with network off fails (no service worker) (W5)
- High-contrast theme for big screens (W5)
- Retake screenshots, add GIF and video (W5)

### Plan and repository

- Guard does not check `docs/production/tools/**`, `status/README.md`, `decisions.md` (A1)
- Guard cannot see a README change that is only a checked output block (A1)
- The repository is public now (found in the 1.0.0 release: provenance is on, CodeQL runs). Still to do: turn on GitHub private vulnerability reporting (D43), and record the change of D04 in `decisions.md` (A2)
