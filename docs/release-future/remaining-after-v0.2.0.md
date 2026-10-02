# Remaining work after v0.2.0

> **The plan for this inventory is now [`../production/`](../production/README.md)** (2026-10-02). Every item below is mapped to a phase there: see its [coverage map](../production/phases/README.md#coverage-map). This file stays as the inventory and is not updated further.

> This file is the **inventory**. [`phases-after-v0.2.0.md`](phases-after-v0.2.0.md) is the **plan** — the same items as eighteen ordered phases, one job each, with the decisions that block them pulled to the front.

A survey of everything still open once Minab **0.2.0** is out: what to finish, fix, decide, and build, in a suggested order. Written 2026-09-20 from a read of the spec, roadmap, status log, ADR, source, tests, CI and the playground, plus a set of probes run against the built CLI and a real PostgreSQL engine (PGlite). Anything marked **verified** was reproduced during this survey; the reproduction is in [Appendix A](#appendix-a--reproductions).

## Where 0.2.0 stands

- **Roadmap:** Phases 0–9 are done, and the web playground landed after Phase 9 (#11). There is no phase left in [`roadmap.md`](../roadmap.md); this file is the successor plan.
- **Health:** `npm run build` is clean; `npm test` reports **259 passed, 6 skipped** (the skipped six are the opt-in PostgreSQL suite). The playground has its own 126-test suite.
- **What 0.2.0 is:** one npm package, `@shamsine/minab` (CLI + language server), and a self-contained VS Code `.vsix`, both at `0.2.0`, MIT.
- **Not actually out yet.** At survey time there is **no `v0.2.0` git tag**, `npm view @shamsine/minab` returns 404, and the `.vsix` exists only as a git-ignored local build. "After v0.2.0" below means "once the release in section 1 has happened." Nothing in sections 2 onward depends on it, so they can proceed in parallel.

### How to read this

Each item carries the roadmap's sign-off vocabulary, because the cost of doing it differs:

- **Design**: needs a language decision (proposal → example → Hamed's approval, per `.cursor/rules/spec-governance.mdc`) before code.
- **Mixed**: a small decision, then mechanical work.
- **Mechanical**: already decided; implement and test.

Priority: **P0** blocks the release, **P1** is a wrong answer or a broken promise in shipped behavior, **P2** is planned capability, **P3** is polish.

---

## 1. Finish the 0.2.0 release (P0, Hamed's to run)

Outward-facing, so deliberately not done by any earlier session ([`status.md`](../status.md), "Next job").

- [ ] Confirm the `@shamsine` npm scope and a `shamsine` Marketplace publisher are Hamed's. The extension's `publisher` field is a placeholder.
- [ ] `npm publish` from the repo root (`prepack` runs `build:release` first).
- [ ] `git tag -a v0.2.0 -m "Minab 0.2.0" && git push origin v0.2.0`. The CHANGELOG link `[0.2.0]: …/releases/tag/v0.2.0` currently points at nothing.
- [ ] Create the GitHub release (attach the `.vsix`; the CHANGELOG entry is the notes).
- [ ] Publish or upload the `.vsix` (`cd vscode-extension && npm run package`).
- [ ] **Manual QA of the `.vsix` in a real VS Code.** Never done, no GUI was available: install it, open an `examples/*/` folder, confirm highlighting, exactly one live squiggle on a type error, and hover/F12 on an `#alias`.
- [ ] Decide whether `0.2.0` should ship with the two wrong-answer bugs in section 2.1. Recommendation: fix them first and ship as `0.2.1`, or publish `0.2.0` as is and put both in the next patch, but list them under "Known limitations" in the CHANGELOG either way (today they are not listed).

---

## 2. Correctness: places Minab gives a wrong or unusable answer (P1)

The project's stated rule is that an unsupported construct fails **with an explicit reason rather than a wrong answer**. The first three items break that rule.

### 2.1 New in this survey

**`CAST` does nothing in the interpreter.** (P1, Mechanical; **verified**)
[`minab-interpreter.ts:293`](../../src/language/minab-interpreter.ts) returns the operand unchanged. Spec §5.5 says a cast is a runtime conversion: narrowing numeric casts truncate or round, and an unsatisfiable cast fails at evaluation time. Results today: `CAST(3.7 AS INTEGER)` → `3.7`; `CAST("12" AS INTEGER) + 1` → `"121"`; `CAST(5 AS TEXT) == "5"` → `false`. The compiled path is right (`CAST(… AS integer)` ran correctly on real Postgres), so the two runtimes disagree, which is exactly the situation ADR 0001 warns about.
To do: implement conversion per target type (`TEXT`, `CITEXT`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `DATE`/`TIME`/`DATETIME`, `UUID`, `JSON`) with an evaluation error for a value that can't convert; decide the rounding-vs-truncation wording spec §5.5 leaves open ("truncates or rounds"); add interpreter-versus-Postgres agreement tests.

**`+` on `TEXT` is accepted by the checker but cannot run anywhere.** (P1, Design → Mechanical; **verified**)
The type checker allows `"a" + "b"` and `.status + "x"`. The interpreter's concatenation branch at [`minab-interpreter.ts:430`](../../src/language/minab-interpreter.ts) is unreachable, because `this.number(left)` on the line before it throws `expected a number`. The SQL compiler emits `("Order"."status" + $1)`, which PostgreSQL rejects (`operator does not exist: text + unknown`). The spec's operator table lists `+` under "additive" without saying whether it concatenates.
To do: **decide** whether `+` concatenates text. If yes, compile to `||` and fix the interpreter, and spell it out in §5.1. If no, make the checker reject it with a message that names the alternative. Add a test either way; today no test covers text `+`.

**A query with `switch`, `is`/`isnot`, or a JSON object literal in a clause can't run at all.** (P1, Mechanical; **verified**)
`FROM Order SELECT switch (.status) { "a" => 1, _ => 2 } AS s` passes `check`, and `compile` and `run` both refuse: the SQL compiler has no form for `SwitchExpr`, `TypeTestExpression` or `JsonObjectLiteral`, and the interpreter can't take one *inside* a `Query` because it runs a whole `Query` through the compiler. The refusal is honest, but these are ordinary constructs (spec §5.6, §9.2) that only work outside a query.
To do: compile `switch`/`if` to `CASE`, `is null` to `IS NULL`, and JSON literals to `jsonb_build_object`; or teach the interpreter to run a query row by row for what SQL can't express. The first is smaller and matches the ADR's direction. `is array`/`is object`/… need `jsonb_typeof`.

### 2.2 Already known and still open

**A top-level rule that filters a collection doesn't type-check.** (P1, Mechanical; **verified**)
`COUNT(.orders[.status == "x"]) < 5` as a bare rule, with `rule.recordTable` set, fails `minab check` with `column "status" needs a statically known table`, though showcase §1 uses exactly this. Cause: `MinabScopeResolver` has no view of the host's `recordTable`; only `MinabTypeChecker`'s outermost `.field` does. `test/evaluation.test.ts` calls the interpreter without the validator, so nothing caught it.
To do: hand the resolver the rule context's `recordTable`, add a `check`-level regression test (not only an evaluation one), then **revert the two workarounds**: `examples/cancelled-orders-limit` (uses `FROM … WHERE`) and `examples/overdue-loop` (loops over `#Order` instead of `.orders`), plus the playground gallery's `COUNT(#Order[.customer == ^ …])` forms. Suggested target: **0.2.1**.

**`GROUPBY` on a traversed column emits SQL Postgres rejects.** (P1, Mechanical; **verified** to produce the SQL, reported failing in real Postgres by the 2026-09-19 status entry)
`FROM Order GROUPBY .customer.country SELECT KEY AS c, SUM(.total) AS r` compiles to a `GROUP BY (SELECT … WHERE "_r0"."id" = "Order"."customer_id")` with the same subquery repeated in `SELECT`, giving *subquery uses ungrouped column "Order"."customer_id"*. It passes `check`, so it is a compiler gap. Grouping by the relation (`GROUPBY .customer`, then `KEY.country`) works. Likely fix: group by the foreign key and project through it, or hoist the traversal into a `LEFT JOIN`. Add a `test/postgres.test.ts` case, since a diff against expected SQL can't catch this class of bug. Suggested target: **0.2.1**.

**`CITEXT` vs. a string literal needs a `CAST`.** (P1 as a decision, Design)
`.email == "ada@example.com"` on a `CITEXT` column is rejected as implicit coercion, so every case-insensitive comparison needs `CAST(… AS CITEXT)`. It may be right (spec §5.5 is strict), but Phase 4 decided the same shape the other way for `INTEGER`/`DECIMAL` ("one numeric family"). Pick one and write it into §5.5 and §7.2. Already in the CHANGELOG's known limitations.

### 2.3 Smaller correctness questions to settle

- [ ] **Division and modulo semantics differ between the two runtimes.** (Design; interpreter behavior **verified**, SQL behavior is standard Postgres.) In the interpreter `let a: INTEGER = 7 / 2; a` is `3.5`; compiled against integer columns Postgres gives `3`. `5 % 0` returns `null` in the interpreter (JS `NaN`); Postgres raises *division by zero*. The spec doesn't say. Decide integer division, division by zero, and `%` sign rules, then make both runtimes agree.
- [ ] **`LIKE` semantics under `CITEXT`/case** and the `%`/`_` escape rules are asserted only in the interpreter. Confirm the compiled path agrees.
- [ ] **`ORDERBY` on something other than a select alias.** It compiles (`ORDER BY "Order"."total"`), but the roadmap and ADR describe "ORDERBY by select alias". Confirm what the spec allows and add a test that pins the behavior either way.

---

## 3. The execution layer (P2, planned for 0.4)

Phase 5's deliberate deferrals. Each currently parses, resolves and type-checks, and `minab run` refuses with a reason. [ADR 0001](../adr/0001-execution-strategy.md) already settles *how* DML executes, so most of this is Mechanical.

| Gap | Where it refuses | Spec | Notes |
|---|---|---|---|
| **Loops** (`for`-in, the other two forms, labeled `break`/`continue`) | [`minab-interpreter.ts:129`](../../src/language/minab-interpreter.ts) | §9.4 | Interpreted. Needs frames pushed per iteration (the scope resolver already models the loop's scope). Also needs a termination guard (a max-iteration option). |
| **`INSERT` / `UPDATE` / `DELETE`** | same | §10 | Relational targets compile to SQL DML; `JSON`-array targets are an interpreted read-modify-write (the ADR's split). Needs a transaction story in `QueryExecutor` (today it only has read-shaped `execute`), and a decision on whether `minab run` writes by default or needs `--apply`. **Design** for that flag and for dry-run output. |
| **Assignment** (`x = …;`, `+:`/compound operators, path assignment with `!` vivify) | same | §9.3 | Local variables are easy. Assignment into the record under validation or a `ref` path is a write, so it shares the DML question above. |
| **`if!` statements** | same | §9.1.1 | Falls out of statement execution once blocks run. |
| **`.$index`** | [`minab-interpreter.ts:305`](../../src/language/minab-interpreter.ts) | §3.5 | Interpreted, array sources only. |
| **Statements inside a block or a function body** | `:285`, `:343` | §8.2, §9.1 | Only `let` runs in a `fn` body today, so a function with an assignment or `if!` in it fails. A block with any statement fails. |
| **Tuples** | playground README lists them as check-only | §7.6 | Confirm what the interpreter does and either implement or label. |
| **User `fn` inside a query** | falls out of compile | §8 | `FROM Order WHERE &f(.total) > 1 …` can't compile; the interpreter would have to evaluate per row. A top-level query that calls a user `fn` doesn't compile to SQL (playground README). Decide whether to inline the function body into SQL where it is a pure expression, or run row by row. **Design.** |
| **`KEY` over a multi-key `GROUPBY`** | [`minab-sql-compiler.ts:334`](../../src/language/minab-sql-compiler.ts) | §2.2 | **Verified**: `GROUPBY .status, .customer SELECT KEY …` refuses ("no single SQL form"). Needs a decision on what `KEY` *is* with two keys (tuple? `KEY[0]`?) before it can compile. **Design.** |
| **`FROM` over a filtered related collection** | [`minab-sql-compiler.ts:255`](../../src/language/minab-sql-compiler.ts) | §3.2 | `FROM .orders[.status == "x"]` refuses; reaching it through an aggregate or `EXISTS` works. |
| **Built-ins beyond the eight** | interpreter `builtin`, `default` branch | §5.3.1 | The set is closed at eight by design. Nothing missing today, but there are no string/date/math helpers (`LOWER`, `LENGTH`, `NOW`, `COALESCE`, date arithmetic), which real validation rules will want. A spec addition. **Design.** |

**Related design questions the execution work will force** (none is decided anywhere):

- [ ] Transactions and atomicity for a program that both validates and writes.
- [ ] Whether a validation rule may write (spec §1 says Minab supports declarative writes, "trigger-like"); the trigger-like *hosting* model (when does a rule fire?) is entirely the host's and unspecified.
- [ ] Row limits and timeouts on interpreted loops and interpreted `fn` recursion (a runaway `fn` currently has no guard).
- [ ] Non-Postgres targets: ADR 0001 notes the compiler emits Postgres-flavored SQL while §7.2 calls types "storage-agnostic". Only Postgres is exercised. A second dialect (SQLite is the obvious one, and would suit the playground) needs a dialect seam in the compiler.

---

## 4. Type checker, validator and spec open items

### 4.1 Checker gaps

- [ ] **Three node types never report their own failures when nested** (P2, Mechanical): `ParentRecord`, plain `NameRef` and `Subquery` have direct failure paths in `MinabTypeChecker` but aren't in the validator's registered set (Phase 7 tried registering all of `Expression` and reverted, because some `Expression` subtypes are never independently inferable). Fix by registering exactly those three, or by giving the checker a "not independently inferable" marker. Add tests where each fails *nested under* a registered ancestor.
- [ ] **A `ref`-to-primary-key comparison shorthand** (`.customer == customerId`) is currently a type error, and the four examples that used it were rewritten to `.customer.id == customerId`. Phase 5 added `primaryKey` to the schema, so the blocker Phase 4 named is gone. Whether to add it is a language decision. **Design.**
- [ ] **The "one numeric family" and "query as scalar without `LIMIT 1`" judgment calls** from Phase 4 are documented in code comments and the roadmap, but not in the spec. If they stay, they belong in §5.5/§5.4; if not, revisit.
- [ ] **`TypeResult.origin` covers the innermost failure only.** Fine for one diagnostic per mistake, but a mistake that needs two ranges (an operator mismatch highlighting both operands) gets one. Optional polish.

### 4.2 Open items in spec §12 (deferred, none blocks a valid program)

Kept here so the list lives in one place; each goes through the proposal → example → approval cycle.

| # | Question | Sign-off |
|---|---|---|
| 1 | `CurrentRecord` AST shape for `.field` chains (`.orders.total` = `CurrentRecord` + `MemberAccess`). Confirm it suits the evaluator (it evidently does) and close it. | Mechanical, close as "confirmed" |
| 2 | `NOT` precedence relative to comparison. | Design |
| 3 | `IN`/`LIKE` chaining. | Design |
| 4 | `[...]` list literal vs. `[...]` postfix filter visual ambiguity, and the one Chevrotain "ambiguous alternatives" warning in `Postfix` that `langium generate` prints. | Design |
| 8 | A second `let` for the same name: redeclaration error or rebinding? | Design |
| 13 | No constants (`const`-style immutable binding). | Design |
| 17 | `!` vivify on a `collection` path step: assumed a semantic error, never confirmed *or implemented as a check*. | Mixed |

Also housekeeping: items 1–3 and 17 read as open questions but describe behavior the implementation has already fixed. Closing them (with a test that pins the behavior) shrinks §12 to the real design work.

### 4.3 Spec and showcase consistency

- [ ] **Only `docs/showcase.md` is covered by tests; the spec's own embedded examples are not.** Two clause-order and `ref`-comparison defects were found in the spec after Phase 1 for exactly that reason (Phase 5's status entry). Extract the fenced Minab blocks from the spec into a parse (and where possible check) test. (P2, Mechanical)
- [ ] **`daysSincePayment` in showcase §14 is called but never defined.** The check-only example defines it in-file; the showcase text is unchanged. Define it in the showcase.
- [ ] The spec's §11 grammar block is a hand-copied duplicate of `src/language/minab.langium`. Add a test that diffs them, so they can't drift again.

### 4.4 Decided: remove the `&` call prefix (added 2026-09-24)

Hamed decided that user functions will be called by name, `name(...)`, exactly like built-ins; `&name(...)` goes away entirely. This reverses the "two calling conventions" half of §12 item 10. (Design decided; follow-on questions open; P1 because it should land before 0.2.0 is published.)

- **Scope.** Delete the `FunctionCall` grammar rule; the bare form already parses as a `CallExpression`. Merge the checker's and interpreter's two call paths. Rewrite §5.3, §8, §8.4, §11 and §12 item 10 of the spec (19 call sites) and the showcase (6). Update 14 call sites in `test/`, 3 in `examples/`, the playground's tokenizer, completion, hover, tour lesson 10, cheat sheet and gallery, the CHANGELOG entry, and the Cursor rules.
- **Open questions it creates.**
  - How do built-ins and user functions stay apart without the sigil? A future built-in (the library planned in §3) would otherwise break any program with a `fn` of that name.
  - May a `let`, parameter or table share a name with a `fn`?
- **Timing.** 0.2.0 is unpublished (no tag; npm 404 on 2026-09-24), so landing this first means no public release ever has `&`.
- Wherever this file writes `&name(...)` (for example the §3 table), that is the 0.2.0 syntax at survey time.

Details and options: [`phases-after-v0.2.0.md`](phases-after-v0.2.0.md), Phase 10.

---

## 5. Editor tooling

### 5.1 Language server (P2)

Today it offers diagnostics, plus hover and go-to-definition for `#alias` only.

- [ ] **Per-document schema.** The server reads one `minab.config.json` at startup and shares it across all open documents, so two folders with different schemas in one workspace get the wrong one. Re-discover per document (config discovery already walks up from a file's directory), and watch config files for changes; today a schema edit needs a server restart. Listed in the CHANGELOG's known limitations. (Mixed)
- [ ] **Completion.** Columns after `.`, tables after `FROM`/`#`, built-ins, user `fn` names, keywords. The playground's `engine/intel.ts` already implements hover, completion and go-to-definition against the same services, so this is largely porting, not inventing. (Mechanical)
- [ ] **Hover beyond `#alias`:** a field's type, a function's signature, the inferred type of any expression.
- [ ] Rename, find-references and document symbols for `let`/`fn`/aliases; signature help for user functions; formatting; semantic tokens; code actions (for example "unknown function — did you mean …", "add `CAST`"). Order by value: completion, hover, symbols, then the rest.
- [ ] **A real JSON-RPC test.** `test/lsp.test.ts` calls the providers directly; the only end-to-end proof is the manual `initialize` + `didOpen` handshake done during Phase 9. Add an automated stdio test.

### 5.2 VS Code extension (P2)

- [ ] The manual QA in section 1.
- [ ] It has **no tests of its own** and no CI job that builds it. Add a CI step running `npm run package` so a broken bundle is caught before release.
- [ ] No snippets, no icon, no configuration settings (for example a path override for `minab.config.json`, a trace level), no status-bar indication of which config is loaded. Marketplace listing needs an icon and a gallery banner.
- [ ] An `.vscodeignore` slip in Phase 9 shipped `src/` once; `test/release.test.ts` guards the npm tarball but **not the `.vsix` contents**. Add the same kind of assertion (`vsce ls`).
- [ ] Other editors: the server speaks stdio LSP, so Neovim/Helix/Zed need only a documented launch line. A short "use with other editors" section in the README would cover it. (P3)

---

## 6. The web playground

The playground works end to end; what remains is design, hosting and content. Full process: [`playground/design/README.md`](../../playground/design/README.md).

- [ ] **The visual design** (P2). The UI is a deliberate wireframe (`styles/wireframe.css`). Steps A–G of the design guide: pick a brand direction, run the 15 Claude Design prompts, hand off to Claude Code on a `playground-design` branch, re-verify. Anything under `playground/src/ui/**`, the tokens and the styles may change; the engine, state, hooks and content may not (`design/contract.md`).
- [ ] **Open items only Hamed can answer** (`design/brief.md`): the story behind the name "Minab", a domain, the portfolio URL, social handles for launch posts, and the brand direction (A/B/C). `src/content/landing.ts` has a `TODO(hamed)` and an empty `authorUrl`, so the footer link is currently blank.
- [ ] **Deployment** (P2, Step H). No host is chosen and no deploy workflow exists ([`ci.yml`](../../.github/workflows/ci.yml) says so). Pick Vercel, Netlify, GitHub Pages or the portfolio sub-path, set `PLAYGROUND_BASE` accordingly, serve the PGlite `.wasm`/`.data` with immutable caching and compression, and add a deploy job.
- [ ] **Lighthouse and accessibility pass** (P3): Performance ≥ 90 on the landing page, Accessibility ≥ 95 everywhere, keyboard-only walkthrough, reduced motion; the design guide's Step F checklist has never been run.
- [ ] **Launch material** (P3): demo video, screenshots, case-study write-up (`design/launch-kit.md`).
- [ ] **Playground follows the language.** Its "check-only" labels, cheat sheet and example `expect`s are tied to the current gaps. When section 2 and 3 items land, the two collection-filter and grouping workarounds in the gallery should be replaced by the natural forms, and check-only examples promoted to runnable. Its own test suite already fails if a lesson's goal isn't met, so the drift will announce itself.
- [ ] **Not versioned or released.** `playground/package.json` is `0.1.0` and `private`, and the root CHANGELOG has no entry for it. Decide whether it gets a changelog section (an `## [Unreleased]` block would do) and how it relates to the language version.
- [ ] **A second database target for the playground** is possible only if the compiler grows a dialect seam (section 3).

---

## 7. Repository, CI and documentation hygiene

### 7.1 CI

[`ci.yml`](../../.github/workflows/ci.yml) builds and tests the language and the playground on Node 22. Gaps:

- [ ] **The PostgreSQL suite never runs in CI.** `test/postgres.test.ts` is opt-in on `MINAB_TEST_DATABASE_URL`, so the six tests that prove the compiled SQL actually executes are skipped on every push. Add a `services: postgres` job. Given section 2.2 (a bug only real Postgres exposes), this is the highest-value CI change. (P1, Mechanical)
- [ ] **Node 20.10 is the declared minimum but CI only tests 22.** Add a matrix entry (`20.10` or `20.x`). (P2)
- [ ] **No release workflow.** Tag-triggered `npm publish` (with provenance) and `.vsix` build/upload would make the section 1 steps repeatable. (P2)
- [ ] **No extension build in CI** (see 5.2) and no `npm pack --dry-run`/`test/release.test.ts` guarantee on a clean checkout beyond what `npm test` already runs.
- [ ] No lint or format step and no config for one (no ESLint/Prettier). Decide whether to adopt. (P3)

### 7.2 Repo tidiness

- [ ] **Two lockfile systems.** The root has both `package-lock.json` (used by CI's `npm ci`) and `bun.lock`; `playground/` has both too, and `playground/bun.lock` is currently **untracked**. Pick npm (CI already does) and delete or gitignore the bun files, or commit the untracked one deliberately. (P3)
- [ ] The `.vsix` is git-ignored (`vscode-extension/.gitignore`), so it can't be attached to a release from a fresh clone; the release workflow in 7.1 should build it.

### 7.3 Documentation

- [ ] **[`status.md`](../status.md) needs a rewrite of "Current status" and "Next job".** Its top section is a nine-paragraph phase-by-phase narration that pre-dates Phase 9 and the playground, and it still says the next job is publishing 0.2.0. Fold section 1 of this file into it and point "Next job" here. Keep the session log append-only, per its own convention.
- [ ] **[`roadmap.md`](../roadmap.md) ends at Phase 9.** Add a short "After 0.2.0" pointer to `docs/release-future/`, and mark Phase 9 as complete once the release is actually out (it currently says "not yet published").
- [ ] **The README's status blurb** says the CLI "compiles, and runs" and lists three unexecuted features. Once section 2's wrong-answer bugs are fixed or documented, make sure that text and the CHANGELOG's "Known limitations" stay identical. Add the four new limitations from this file (CAST, text `+`, `switch`/`is`/JSON in a query, multi-key `KEY`) to the CHANGELOG now.
- [ ] `.cursor/rules/*.mdc` carries a copy of the layout and "current implementation status" line; update it whenever a phase-sized change lands (the cross-cutting rule in the roadmap).
- [ ] **An API/embedding guide.** The README documents the CLI. The other consumer, a host application embedding the services (the actual reason Minab exists: "embedded in a larger web application… inside Monaco"), has only code comments: `createMinabServices`, `MinabSchema`, `MinabRuleContext`, `QueryExecutor`, `interpreter.evaluate`. Note also that `package.json` `files` publishes `out/src` but there is no `exports`/`types` map, so an importer today reaches into deep paths. Decide the public API surface and document it. (P2, Mixed) Now part of the runtime work in section 9.
- [ ] A docs site or at least a `docs/README.md` index. There are five documents plus an ADR, and no map between them beyond the root README.

---

## 8. Suggested sequencing

Grouped by release below; broken into workable phases in [`phases-after-v0.2.0.md`](phases-after-v0.2.0.md), which is the one to follow. Keep the two in step if either changes.

| Release | Theme | Contents |
|---|---|---|
| **0.2.0** | Ship what's built | Remove `&` first (4.4), so no release ever teaches it; then section 1 in full, with the four new limitations added to the CHANGELOG. |
| **0.2.1** | Stop giving wrong answers | 2.1 `CAST` and text `+`; 2.2 top-level collection filter and traversed `GROUPBY`; CITEXT decision; CI Postgres job (7.1); revert the example workarounds. |
| **0.3.0** | Embeddable | Section 10: `LOG`. Section 9: one runtime API with ports, a NestJS host and a browser host, packaged with an embedding guide (this absorbs 7.3's embedding item). |
| **0.4.0** | The execution layer | Section 3: loops, DML, assignment, `.$index`, block/function-body statements, `switch`/`is`/JSON in queries, multi-key `KEY`; the transaction/`--apply` design. Promote the three check-only examples and update `examples.test.ts` (it asserts they *refuse*, so it fails loudly on purpose). |
| **0.5.0** | Editor tooling | Section 5: per-document schema, completion, hover, symbols, automated LSP test. |
| **Playground launch** (parallel) | Design + deploy | Section 6, independent of language releases. |
| **1.0.0** | Stable | Spec stable (already) **and** every construct the grammar accepts runs, or is deliberately removed; no known wrong-answer bug; Postgres suite in CI; public API documented and versioned, and running in a browser and in NestJS through the same calls; the §12 items closed or explicitly moved to a "post-1.0" list. |

---

## 9. Embedding: run Minab in the browser and in NestJS (added 2026-10-01)

Hamed's goal is one Minab runtime used from a web app and from a NestJS server. The host gives Minab what it needs; Minab calls out for anything else (data, and possibly host functions) and waits for the answer. The open question was whether hexagonal architecture (ports and adapters) fits. It does: the core is already shaped that way, and what's missing is at its edges.

### 9.1 What already fits

- **The core does no I/O.** In `src/language/`, only the language-server entry (`main.ts`) imports anything Node-specific: `langium/node` and `process.cwd()`. `src/host/` imports nothing Node-specific and already runs inside the playground's Web Worker.
- **There is one driven port.** With `QueryExecutor` (`src/language/minab-executor.ts`), the interpreter hands out a parameterized statement and awaits rows. `EvalContext` supplies the record, `$` and an `onStatement` hook.
- **The host already supplies the schema and rule context** as data (`MinabSchema`, `MinabRuleContext`), not as source.

### 9.2 What's missing

- **No runtime API.** The CLI (`src/cli/main.ts`) and the playground (`playground/src/engine/engine.ts`) each hand-roll parse → build → validate → compile or evaluate over raw Langium services. A NestJS host would be a third copy. (P2, Mixed)
- **No prepare-once, run-many.** Every run re-parses and re-checks. A server validating many records against one stored rule should check that rule once.
- **Only one thing to call out for.** There are no host functions (`MinabFunctionSchema` exists in `schema.ts`, but nothing consumes it), no clock, and no write port (Phase 23 needs one). (Design)
- **No cancellation or limits.** There is no `AbortSignal`, timeout, or statement or row cap, so a user-authored program on a server can run as long as it likes.
- **Unstructured failures.** `EvalResult` is `{ ok: false, reason: string }`: no code, and no source range to map to an HTTP status or an editor marker.
- **Server concurrency is unverified.** The playground runs one program at a time against a fixed document URI. Nobody has tested whether concurrent runs on one Langium workspace are safe.

### 9.3 Browser-specific

- **The playground's worker bridge is one-way**, main → worker, because its database (PGlite) lives inside the worker. In an app, the ports live on the main thread, so the worker has to call out and wait.
- **SQL must not travel from a browser to a server to be executed.** With today's SQL-shaped data port, a browser run that needs server data has to send the *program* to the server, not the statement. The alternative is a structured, non-SQL data request, which is a design decision.
- **No bundle-size budget**, and nothing stops a Node-only module from reaching a browser bundle.

### 9.4 NestJS-specific

- **ESM-only.** Minab is `"type": "module"`, and Langium exports only an `import` condition, while Nest's default template compiles to CommonJS. `require()` of an ES module works unflagged only from Node 20.19 / 22.12, but `engines` says `>=20.10`.
- **No adapters for the ORMs a Nest app uses** (TypeORM, Prisma), and no way to run inside the request's existing transaction.
- **Security.** The schema handed to Minab is the read surface of every program. A server running user-authored rules must scope it per user or tenant.

### 9.5 Packaging

- No `exports` map (see 7.3), so a host imports deep paths. The optional peers (`pg`, `@nestjs/common`, `@electric-sql/pglite`) are undeclared, and there are no consumer smoke tests.

The plan for all of this is Phases 16–20 of [`phases-after-v0.2.0.md`](phases-after-v0.2.0.md).

## 10. Debugging output: `LOG` (added 2026-10-01)

Hamed asked for something like JavaScript's `console.log`: a way to print values while a program runs, written somewhere such as stdout or stderr. Nothing like it exists today; the only runtime visibility is `--trace` (the SQL sent to the database) and the playground's Execution tab. (P2, Design → Mechanical)

What shapes the design, from the code:
- **Most programs are a single expression**, and `BodyStatement` has no expression-statement form (`minab.langium:81`). So a `log x;` statement couldn't be used inside a rule, a filter or a `WHERE`. An expression that logs and returns its value (`LOG(value, label?)`) can go anywhere.
- **Built-ins take exactly one argument** (`minab-type-checker.ts:423`), so a label argument or a variadic form changes the built-in signature machinery.
- **Part of every program runs as SQL**, where nothing can call back to the host per row.
- **The CLI prints results on stdout** (`--json` is meant to be piped), and `--trace` already uses stderr (`src/cli/main.ts:278`). Logs belong on stderr.
- **`EvalContext.onStatement` is the precedent** for a host callback, and it later becomes the runtime's `trace` port.

The plan is Phase 15 of [`phases-after-v0.2.0.md`](phases-after-v0.2.0.md) (the language, the CLI and the playground), with the `log` port and its Nest and browser adapters in Phases 16–19. The open questions are in that file's "Notes for review" (Q6, N1–N4, S1, S6).

---

## Appendix A — Reproductions

Run from a directory containing a `minab.config.json` with the `Customer`/`Order` schema from `examples/top-customers/`, using the built CLI (`node out/src/cli/bin.js`). PostgreSQL behavior was checked with PGlite (`@electric-sql/pglite`, already a playground dependency).

| Probe | Command | Result |
|---|---|---|
| `CAST` narrowing | `run` on `CAST(3.7 AS INTEGER)` | `3.7` (expected `3`) |
| `CAST` to text | `run` on `CAST(5 AS TEXT) == "5"` | `false` (expected `true`) |
| `CAST` from text | `run` on `CAST("12" AS INTEGER) + 1` | `"121"` (expected `13`) |
| Text `+`, checker | `check` on `"a" + "b"` | no problems found |
| Text `+`, interpreter | `run` on `"a" + "b"` | `cannot evaluate this program: expected a number` |
| Text `+`, SQL | `compile` on `FROM Order SELECT .status + "x" AS s` | `("Order"."status" + $1)`; PGlite: `operator does not exist: text + unknown` |
| `switch` in `SELECT` | `run`/`compile` on `FROM Order SELECT switch (.status) { "a" => 1, _ => 2 } AS s` | refused: `"SwitchExpr" has no SQL form` |
| `is null` in `WHERE` | `compile` on `FROM Order WHERE .customer is null SELECT .id AS id` | refused: `"TypeTestExpression" has no SQL form` |
| JSON literal in `SELECT` | `compile` on `FROM Order SELECT { id: .id, t: .total } AS o` | refused: `"JsonObjectLiteral" has no SQL form` |
| Multi-key `KEY` | `compile` on `FROM Order GROUPBY .status, .customer SELECT KEY AS k, COUNT(.) AS n` | refused: `KEY over a multi-key GROUPBY has no single SQL form` |
| Traversed `GROUPBY` | `compile` on `FROM Order GROUPBY .customer.country SELECT KEY AS c, SUM(.total) AS r` | emits the repeated-subquery `GROUP BY` (rejected by Postgres per the 2026-09-19 status entry) |
| Bare-rule collection filter | `check` on `COUNT(.orders[.status == "x"]) < 5` (with `rule.recordTable`) | `column "orders" needs a statically known table` |
| Integer division | `run` on `let a: INTEGER = 7 / 2; a` | `3.5` |
| Modulo by zero | `run` on `5 % 0` | `null` |

Confirmed working in the same pass (so they need no work): `LIKE`, `DISTINCT`, `LIMIT`/`OFFSET`, `LEFTJOIN`, `IN (subquery)`, `CAST` in SQL, single-key `GROUPBY` on a relation, and `ORDERBY` on a non-alias expression.

Baseline commands: `npm run build` (clean) and `npm test` → 259 passed, 6 skipped.
