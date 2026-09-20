# Phases after v0.2.0 — the plan

The companion to [`remaining-after-v0.2.0.md`](remaining-after-v0.2.0.md), which is the *inventory* of what is left. This file is the *order*: twelve phases, each one job with one output, sized to be picked up in a fresh session without needing prior conversation — the same contract [`../roadmap.md`](../roadmap.md) sets for Phases 0–9.

Numbering continues from the old roadmap (which ends at Phase 9), so a phase number means the same thing in both documents.

## How to use this

- **One phase at a time, one branch per phase.** A phase that grows a second theme should be split, not stretched.
- **Sign-off vocabulary is the roadmap's**: **Design** needs a language decision (proposal → concrete example → Hamed's approval, per `.cursor/rules/spec-governance.mdc`) *before* code; **Mechanical** is a checklist; **Mixed** starts as one and becomes the other.
- **Decide first, then build.** Every phase with Design content opens by settling its decisions and writing them into `docs/query-language-spec.md`. No phase should discover a design question halfway through and answer it unilaterally.
- **Every fix gets a test that fails without it.** The repo has a habit of verifying this (Phase 7 reverted its own fix to confirm the regression test caught the bug); keep it.
- **Close each phase the way the roadmap says**: a "what actually shipped" note in this file, a dated entry in [`../status.md`](../status.md), and `.cursor/rules/*.mdc` updated if the layout or conventions moved.
- **Sizes are guesses** — S is a sitting, M is a session or two, L is several. They are there for sequencing, not for planning a calendar.

## Phase overview

| # | Phase | Sign-off | Size | Output | Status |
|---|---|---|---|---|---|
| 10 | Publish 0.2.0 | Mechanical | S | The release exists: tag, npm, `.vsix`, honest limitations | Not started |
| 11 | CI that can catch these bugs | Mechanical | S–M | A push runs the Postgres suite, Node 20.10, and builds the extension | Not started |
| 12 | One language, two runtimes, one answer | Design → Mechanical | M | The interpreter and the compiled SQL agree, or refuse together | Not started |
| 13 | `check` tells the truth | Mechanical | M | No valid program is rejected; no accepted program compiles to invalid SQL → **0.2.1** | Not started |
| 14 | The relational layer stops refusing ordinary expressions | Mixed | M–L | `switch`, `is`, JSON literals and multi-key `KEY` work inside a query | Not started |
| 15 | Statements run | Mechanical | L | Loops, blocks, `if!`, local assignment, `.$index` execute | Not started |
| 16 | Writes | Design → Mechanical | L | `INSERT`/`UPDATE`/`DELETE` and path assignment execute → **0.3.0** | Not started |
| 17 | Editor tooling worth using | Mechanical | M–L | Per-document schema, completion, real hover, an automated LSP test | Not started |
| 18 | The embedding API | Mixed | M | A documented, versioned public surface for a host application → **0.4.0** | Not started |
| 19 | Playground: design, deploy, launch | Mixed | L | The wireframe becomes a site with a URL | Not started (parallel track) |
| 20 | Close the language backlog | Design | M | §12 emptied or explicitly post-1.0; the spec's own examples under test | Not started |
| 21 | 1.0 | Mixed | S–M | Every construct the grammar accepts runs, or is gone | Not started |

**Critical path:** 10 → 11 → 12 → 13 → (14, 15) → 16 → 17 → 18 → 20 → 21.
**Parallel:** 19 depends on nothing in the language and can run alongside any of it. 17 and 18 can start before 16 if editor work is more valuable to you than writes.

## Decisions only Hamed can make

Batch-answerable; each blocks the phase named. Pulled out so they can be settled in one sitting rather than ambushing four separate sessions.

| Decision | Blocks | The question |
|---|---|---|
| Ship-as-is or fix-first | 10 | Publish 0.2.0 with the `CAST` and text-`+` bugs documented, or hold for 0.2.1? |
| npm scope / Marketplace publisher | 10 | Are `@shamsine` and a `shamsine` publisher yours? |
| Text `+` | 12 | Does `+` concatenate `TEXT`, or is it numeric-only? |
| Division and `%` | 12 | Integer division or always-decimal; what `x % 0` and `x / 0` do. |
| `CITEXT` vs. a string literal | 12 | Relax the no-coercion rule for `CITEXT`/`TEXT`, as Phase 4 did for `INTEGER`/`DECIMAL`? |
| Multi-key `KEY` | 14 | What is `KEY` when `GROUPBY` has two keys — a tuple, `KEY[0]`, or an error? |
| A user `fn` inside a query | 14 | Inline pure function bodies into SQL, or evaluate row by row? |
| Writes: safety and scope | 16 | Does `minab run` write by default or need `--apply`? May a *validation rule* write? |
| Built-in library | 20 | Stay at the eight, or add `LOWER`/`LENGTH`/`COALESCE`/`NOW`/date arithmetic? |
| `ref` == primary key shorthand | 20 | Is `.customer == customerId` legal now that the schema carries `primaryKey`? |
| §12 items 2, 3, 4, 8, 13 | 20 | `NOT` precedence, chaining, `[...]` ambiguity, second `let`, `const`. |
| Non-Postgres dialects | 21 | Is a second SQL target in scope for 1.0, or explicitly not? |

---

## Phase 10 — Publish 0.2.0

**Goal:** the thing that is built becomes a thing that exists. **Sign-off: Mechanical** (plus two Hamed-only decisions). **Size: S.**

**Why here:** everything downstream is a fix or an addition to a released baseline. Also, the repo currently claims a release that no one can install.

**Tasks**
- [ ] Decide ship-as-is vs. fix-first (see the decisions table). If fix-first, do Phases 11–13 and publish as 0.2.1 instead; the rest of this phase is unchanged.
- [ ] Add the four undocumented limitations to `CHANGELOG.md` — `CAST` is a no-op in the interpreter, `+` on `TEXT` doesn't run, `switch`/`is`/JSON literals inside a query clause don't run, multi-key `KEY` doesn't compile — alongside the four already listed.
- [ ] Confirm the npm scope and Marketplace publisher; replace the placeholder `publisher` in `vscode-extension/package.json` if it changes.
- [ ] `npm publish` (root; `prepack` builds), then `git tag -a v0.2.0 -m "Minab 0.2.0" && git push origin v0.2.0`.
- [ ] GitHub release from the tag, `.vsix` attached (`cd vscode-extension && npm run package`), CHANGELOG entry as the notes.
- [ ] Publish or upload the `.vsix`.
- [ ] **Manual QA in a real VS Code** (never done, no GUI was available): install the `.vsix`, open an `examples/*/` folder, confirm highlighting, exactly one squiggle on a type error, hover and F12 on an `#alias`. Record the result in `status.md` either way.
- [ ] Rewrite `status.md`'s "Current status" and "Next job" — both pre-date the playground and still say the next job is publishing. Point "Next job" at this file. Leave the session log append-only.
- [ ] Add an "After 0.2.0" pointer at the end of `../roadmap.md` and mark Phase 9 published.

**Done when:** `npm install -g @shamsine/minab` works from a machine that has never seen the repo, the tag resolves the CHANGELOG's `[0.2.0]` link, and the extension has been opened by a human.

**Not in this phase:** any code fix.

---

## Phase 11 — CI that can catch these bugs

**Goal:** the suite that proves the compiled SQL runs actually runs. **Sign-off: Mechanical.** **Size: S–M.**

**Why here:** three of the next phase's bugs are only visible against a real database, and `test/postgres.test.ts` is skipped on every push today. Doing this before the fixes means the fixes arrive with proof instead of a promise.

**Tasks**
- [ ] Add a `services: postgres` job (with `citext` available) and set `MINAB_TEST_DATABASE_URL`, so the six opt-in tests run on every push. This is the highest-value change in the phase.
- [ ] Add Node `20.10` to the matrix — it is the declared `engines` minimum and nothing tests it.
- [ ] Add an extension job: install, `npm run build`, `npm run package`. A broken bundle currently reaches a release unnoticed.
- [ ] Extend `test/release.test.ts` (or add a sibling) to assert the **`.vsix` contents** the way it already asserts the npm tarball — Phase 9 shipped `src/` in a `.vsix` once.
- [ ] Add a tag-triggered release workflow: build, `npm publish --provenance`, build the `.vsix`, attach it to the GitHub release. Phase 10's steps become one push.
- [ ] Housekeeping: pick one lockfile system (CI uses npm), then delete or ignore the `bun.lock` files — `playground/bun.lock` is untracked and the root one is committed.
- [ ] Decide whether to adopt a linter/formatter. If no, write that down so it stops being an open question.

**Done when:** a pull request shows a green Postgres job, and a tag produces a published package and an attached `.vsix` with no local steps.

**Not in this phase:** fixing anything the new jobs turn red — note it and take it into Phase 12 or 13.

---

## Phase 12 — One language, two runtimes, one answer

**Goal:** close the gap ADR 0001 warns about — the interpreter and the compiled SQL answering differently. **Sign-off: Design → Mechanical.** **Size: M.**

**Why here:** these are wrong answers, not missing features, and they are cheap to fix once the decisions are made.

**Decide first** (write each into `docs/query-language-spec.md` before coding): text `+`, division/`%`, `CITEXT` vs. a string literal.

**Tasks**
- [ ] **`CAST` in the interpreter** (`minab-interpreter.ts:293` returns its operand unchanged). Implement conversion per target type, with an evaluation error for a value that can't convert (spec §5.5). Settle the §5.5 "truncates or rounds" wording while you are there.
- [ ] **Text `+`.** If it concatenates: compile to `||`, fix the unreachable branch at `minab-interpreter.ts:430` (the `number()` call above it throws first), and state it in §5.1. If it doesn't: reject it in the checker with a message naming the alternative.
- [ ] **Division and `%`.** Make both runtimes implement whatever was decided, including division by zero (`5 % 0` is `null` today, Postgres raises).
- [ ] **`CITEXT`.** Implement the decision in the checker, and make sure the interpreter's case-insensitive path and the compiled path still agree.
- [ ] **`LIKE`**: confirm the compiled path matches the interpreter on case and on `%`/`_` escaping; pin with a Postgres test.
- [ ] **A differential test harness.** The recurring shape of these bugs is "one runtime disagrees with the other," so add a table-driven test that runs the same expressions both ways and asserts identical results. This is the phase's real deliverable — it makes the class of bug hard to reintroduce.

**Done when:** every expression in the harness gives the same answer interpreted and compiled, and the three decisions are in the spec.

**Not in this phase:** anything that doesn't *run* today (that's 14–16).

---

## Phase 13 — `check` tells the truth

**Goal:** no valid program is rejected, and nothing `check` accepts compiles to SQL the database rejects. **Sign-off: Mechanical.** **Size: M.**

**Why here:** `check` is the contract the CLI, the language server and the playground all lean on. It is also the last blocker for 0.2.1.

**Tasks**
- [ ] **A top-level rule that filters a collection.** `COUNT(.orders[.status == "x"]) < 5` (showcase §1) fails with `column "status" needs a statically known table`. Give `MinabScopeResolver` a view of the host's `rule.recordTable`, which only `MinabTypeChecker` sees today.
- [ ] Add the regression test at the **`check`** level. It went unnoticed because `test/evaluation.test.ts` calls the interpreter without the validator.
- [ ] **Revert the three workarounds** written around that bug: `examples/cancelled-orders-limit` (uses `FROM … WHERE`), `examples/overdue-loop` (iterates `#Order` rather than `.orders`), and the playground gallery's `COUNT(#Order[.customer == ^ …])` forms.
- [ ] **`GROUPBY` on a traversed column.** `GROUPBY .customer.country` emits a `GROUP BY (SELECT …)` repeated in `SELECT`, which Postgres rejects as an ungrouped outer column. Group by the foreign key and project through it, or hoist the traversal into a `LEFT JOIN`. Cover it in `test/postgres.test.ts` — a diff against expected SQL cannot catch this class.
- [ ] **The three unregistered node types.** `ParentRecord`, plain `NameRef` and `Subquery` have failure paths in the checker but are not in the validator's registered set, so nested failures go unreported. Register exactly those three (Phase 7 tried registering all of `Expression` and reverted for good reason), with a test where each fails *nested under* a registered ancestor.
- [ ] **`ORDERBY` on a non-alias expression** compiles, while the roadmap and ADR describe ordering by select alias. Confirm what the spec intends and pin it with a test either way.

**Done when:** showcase §1's own example passes `check` and runs, the examples are back on their natural forms, and the traversed `GROUPBY` executes against real Postgres in CI.

**→ Release 0.2.1** after this phase: Phases 11–13, plus whatever Phase 10 documented as a known limitation and is now fixed.

---

## Phase 14 — The relational layer stops refusing ordinary expressions

**Goal:** constructs that work outside a query stop being refused inside one. **Sign-off: Mixed.** **Size: M–L.**

**Why here:** these are honest refusals, not wrong answers, so they rank below Phases 12–13 — but they are ordinary spec constructs (§5.6, §9.2), and a user meets them early.

**Decide first:** multi-key `KEY`; whether a user `fn` inside a query inlines into SQL or runs row by row.

**Tasks**
- [ ] `switch` and `if` → `CASE WHEN`.
- [ ] `is`/`isnot` → `IS NULL`/`IS NOT NULL`, and the five JSON kinds → `jsonb_typeof`.
- [ ] JSON object and list literals → `jsonb_build_object`/`jsonb_build_array`.
- [ ] **Multi-key `KEY`** (`minab-sql-compiler.ts:334`), per the decision.
- [ ] **`FROM` over a filtered related collection** (`minab-sql-compiler.ts:255`) — `FROM .orders[.status == "x"]` refuses today; reaching it through an aggregate or `EXISTS` works.
- [ ] **A user `fn` inside a query**, per the decision. Note a row-by-row fallback overlaps the interpreter work in Phase 15; if you pick that route, consider moving this item there.
- [ ] Every new form gets a Postgres test, not only a SQL diff.

**Done when:** each construct in this list either compiles and executes, or refuses for a *newly stated* reason that is in the spec.

**Not in this phase:** statements (Phase 15) and writes (Phase 16).

---

## Phase 15 — Statements run

**Goal:** everything that does not touch the database executes. **Sign-off: Mechanical** (ADR 0001 already settles the strategy). **Size: L.**

**Why here:** the largest remaining block of "parses, type-checks, refuses to run," and it is self-contained: no write path, no transactions.

**Tasks**
- [ ] **Blocks with statements** (`minab-interpreter.ts:285`) and **statements in a function body** (`:343`) — only `let` runs in a `fn` today, so a function containing an assignment or an `if!` fails.
- [ ] **Local assignment** (`x = …`, compound `+:` and friends, §9.3) — locals only; a path that writes through the record belongs to Phase 16.
- [ ] **`if!` statements** (§9.1.1) — largely falls out of statement execution.
- [ ] **Loops** (§9.4, all three forms, labeled `break`/`continue`) — push a frame per iteration; the scope resolver already models the loop's scope.
- [ ] **Guards**: a max-iteration limit and a recursion depth limit, surfaced as options. A runaway `fn` currently has nothing stopping it.
- [ ] **`.$index`** (`:305`, §3.5) — array sources only.
- [ ] **Tuples** (§7.6) — confirm what the interpreter does today, then implement or label deliberately.
- [ ] Promote `examples/overdue-loop` from check-only. `test/examples.test.ts` asserts check-only examples are *refused*, so it will fail until the manifest is updated — that is the design, not a break.
- [ ] Update the playground's check-only labels and cheat sheet for what now runs.

**Done when:** `overdue-loop` runs and produces its documented answer, and no `"…" is not executed yet (Phase 5 scope)` message remains for a non-write construct.

**Not in this phase:** anything that persists a change.

---

## Phase 16 — Writes

**Goal:** `INSERT`/`UPDATE`/`DELETE` and path assignment execute. **Sign-off: Design → Mechanical.** **Size: L.**

**Why here:** last and largest, because it is the only phase that can damage data, and it needs the statement machinery from Phase 15 underneath it.

**Decide first**
- Does `minab run` write by default, or require `--apply`, with a dry-run default that prints the statements? (Recommendation: dry-run by default; a language runner that mutates on `run` is a sharp edge.)
- May a **validation rule** write? Spec §1 says Minab supports declarative, trigger-like writes, but when a rule fires is entirely the host's business and is unspecified anywhere.
- Transaction and atomicity semantics for a program that validates *and* writes.

**Tasks**
- [ ] Extend `QueryExecutor` beyond its read-shaped `execute` — a transaction boundary, and a way to report affected rows.
- [ ] **Relational DML → SQL DML**, per ADR 0001.
- [ ] **`JSON`-array targets → interpreted read-modify-write**, the other half of the ADR's split, including the ordinal forms (`DELETE .customers[2]`, `WHERE .$index > 2`).
- [ ] **Path assignment with `!` vivify** (§9.3), and §12 item 17 — `!` on a `collection` step is *assumed* to be a semantic error and has never been confirmed or implemented as a check.
- [ ] CLI surface for the safety decision, plus dry-run output a human can read.
- [ ] Promote `examples/order-dml` and `examples/reconcile-overdue-accounts` from check-only; update `test/examples.test.ts`.
- [ ] Postgres tests that assert the rows actually changed, and rolled back when they should.

**Done when:** all eleven examples execute, and a write can be previewed without performing it.

**→ Release 0.3.0** after this phase: the execution layer is complete.

---

## Phase 17 — Editor tooling worth using

**Goal:** the language server does more than squiggles and one hover. **Sign-off: Mechanical.** **Size: M–L.**

**Why here:** the playground already proves each feature against the same services (`playground/src/engine/intel.ts` implements hover, completion, go-to-definition and an AST view), so this is largely porting — but it is worth doing after the language stops changing underneath it.

**Tasks**
- [ ] **Per-document schema.** The server reads one `minab.config.json` at startup and shares it across every open document; two folders with different schemas get the wrong one. Re-discover per document and watch config files — a schema edit needs a server restart today.
- [ ] **Completion**: columns after `.`, tables after `FROM`/`#`, the eight built-ins, `&fn` names, keywords.
- [ ] **Hover beyond `#alias`**: a field's type, a function's signature, any expression's inferred type.
- [ ] Document symbols, rename and find-references for `let`/`fn`/aliases; signature help; semantic tokens; code actions for the two messages users hit most (`use &name(...)`, `add a CAST`).
- [ ] **An automated stdio LSP test.** `test/lsp.test.ts` calls providers directly; the only end-to-end evidence is a manual handshake from Phase 9.
- [ ] Extension polish: snippets, an icon and gallery banner for the Marketplace, settings for a config path and trace level, a status-bar item naming the loaded config.
- [ ] A short README section on using the server from Neovim, Helix or Zed — it is stdio LSP, so this is a documented launch line, not work.

**Done when:** typing `.` in a `.minab` file offers that table's columns, two folders with different schemas both check correctly, and an automated test drives the server over a real connection.

---

## Phase 18 — The embedding API

**Goal:** a host application can depend on Minab without reaching into `out/src/...`. **Sign-off: Mixed.** **Size: M.**

**Why here:** this is the reason the project exists — Minab is meant to be embedded in a larger web application, edited in Monaco — and it is the least documented surface in the repo.

**Tasks**
- [ ] Decide the public surface: `createMinabServices`, `MinabSchema`, `MinabRuleContext`, `QueryExecutor`, `interpreter.evaluate`, the host config parser, and whatever the playground actually uses.
- [ ] Add `exports` and `types` maps to `package.json`; `files` publishes `out/src` with no entry points today.
- [ ] Write the embedding guide: the schema contract, the rule context, supplying an executor, running a program, mapping diagnostics into Monaco. The playground is the worked example — cite it rather than inventing one.
- [ ] State a compatibility policy for that surface while the version is `0.x`.
- [ ] Add `docs/README.md` as an index: spec, showcase, roadmap, status, ADR, this plan.

**Done when:** a new host can be wired up from the guide alone, importing only documented paths.

**→ Release 0.4.0** after this phase.

---

## Phase 19 — Playground: design, deploy, launch

**Goal:** the wireframe becomes a site with a URL. **Sign-off: Mixed.** **Size: L.** **Parallel — depends on no language work.**

**Why separate:** it is a different skill and a different audience, and it blocks nothing.

**Tasks**
- [ ] **Hamed's open items** (`playground/design/brief.md`): the story behind the name "Minab", a domain, the portfolio URL (`src/content/landing.ts` has a `TODO(hamed)` and an empty `authorUrl`, so the footer link is blank), social handles, and the brand direction A/B/C.
- [ ] **The design pass**, Steps B–E of `playground/design/README.md`: the 15 prompts, then hand off to Claude Code on a `playground-design` branch. `design/contract.md` fences it — `src/ui/**`, tokens and styles may change; engine, state, hooks and content may not.
- [ ] **Deploy** (Step H): pick a host, set `PLAYGROUND_BASE` if it is served under a path, serve PGlite's `.wasm`/`.data` immutable and compressed, add a deploy workflow.
- [ ] **Step F verification** — it has never been run: light and dark at 1440 px and 375 px, keyboard-only, reduced motion, Lighthouse ≥ 90 performance on the landing page and ≥ 95 accessibility everywhere.
- [ ] **Launch material** (`design/launch-kit.md`): video, screenshots, case study, posts.
- [ ] Decide whether the playground gets a version and a CHANGELOG section; it is `0.1.0` and `private` with no entry today.
- [ ] Keep it honest as the language moves: Phases 13, 15 and 16 each retire a "check-only" label or a workaround here. Its own suite fails when a lesson's goal changes, so the drift announces itself.

**Done when:** the site is live at a URL you would put on a portfolio, and the Step F checklist is signed off.

---

## Phase 20 — Close the language backlog

**Goal:** §12 is empty or explicitly post-1.0, and the spec is under test. **Sign-off: Design.** **Size: M.**

**Why here:** most of these change the language, so they should land after the implementation is stable and before 1.0 freezes it.

**Tasks**
- [ ] **Close what is already settled by the implementation**, with a test pinning each: item 1 (the `CurrentRecord` AST shape evidently suits the evaluator), item 2 (`NOT` precedence), item 3 (`IN`/`LIKE` non-chaining), item 17 (vivify on a `collection`, if Phase 16 implemented the check).
- [ ] **Decide the rest**: item 4 (`[...]` list vs. filter ambiguity, and the standing Chevrotain warning in `Postfix`), item 8 (a second `let`: redeclaration or rebinding), item 13 (`const`).
- [ ] **A built-in library**, per the decision — `LOWER`, `LENGTH`, `COALESCE`, `NOW`, date arithmetic. The set is deliberately closed at eight today, which real validation rules will feel.
- [ ] **`ref` == primary key shorthand**, per the decision. Phase 4 flagged it and Phase 5 removed the blocker by adding `primaryKey` to the schema.
- [ ] **Write the two Phase 4 judgment calls into the spec** — "`INTEGER`/`DECIMAL` are one numeric family" and "a query used as a scalar needs no `LIMIT 1`" live in code comments and the roadmap, not in §5.5/§5.4.
- [ ] **Put the spec's own examples under test.** Only `showcase.md` is covered; two defects were found in the spec *after* Phase 1 for exactly that reason. Extract its fenced blocks into a parse-and-check test.
- [ ] **Diff §11's grammar block against `src/language/minab.langium`** in a test — it is a hand-copied duplicate.
- [ ] Define `daysSincePayment` in showcase §14; it is called there and defined nowhere.

**Done when:** §12 contains only items explicitly labeled post-1.0, and a spec example cannot drift from the grammar without a test failing.

---

## Phase 21 — 1.0

**Goal:** the version number stops apologizing. **Sign-off: Mixed.** **Size: S–M.**

**Criteria** (each already true or delivered by an earlier phase):
- [ ] Every construct the grammar accepts either runs or has been deliberately removed from the grammar.
- [ ] No known wrong-answer bug; the differential harness from Phase 12 is green.
- [ ] The Postgres suite runs in CI on every push.
- [ ] The embedding API is documented, with a stated compatibility policy.
- [ ] §12 is closed or explicitly post-1.0.
- [ ] The dialect decision is recorded: either a seam exists and a second target is tested, or "Postgres only" is written into ADR 0001's consequences and the README.

**Tasks:** a final audit against the list above, a CHANGELOG entry that states the 0.x → 1.0 compatibility promise, and a version bump across `package.json`, `vscode-extension/package.json` and the CHANGELOG (`test/release.test.ts` already guards that they match).

---

## Appendix — coverage map

Every item in [`remaining-after-v0.2.0.md`](remaining-after-v0.2.0.md), and where it lands. If something is missing from this table, it is missing from the plan.

| Inventory section | Item | Phase |
|---|---|---|
| 1 | Publish, tag, release, `.vsix` QA, CHANGELOG limitations | 10 |
| 2.1 | `CAST` no-op; text `+` | 12 |
| 2.1 | `switch`/`is`/JSON literal inside a query | 14 |
| 2.2 | Top-level collection filter; traversed `GROUPBY` | 13 |
| 2.2 | `CITEXT` vs. string literal | 12 |
| 2.3 | Division and `%`; `LIKE` under `CITEXT` | 12 |
| 2.3 | `ORDERBY` on a non-alias | 13 |
| 3 | Loops, blocks, function-body statements, local assignment, `if!`, `.$index`, tuples | 15 |
| 3 | DML, path assignment, transactions, rule-may-write, `--apply` | 16 |
| 3 | Multi-key `KEY`; `FROM` over a filtered collection; user `fn` in a query | 14 |
| 3 | Loop and recursion guards | 15 |
| 3 | Built-ins beyond the eight | 20 |
| 3 | Non-Postgres dialects | 21 |
| 4.1 | Three unregistered node types | 13 |
| 4.1 | `ref`-to-PK shorthand; Phase 4 judgment calls into the spec | 20 |
| 4.1 | `TypeResult.origin` multi-range (optional polish) | 20 |
| 4.2 | §12 items 1–4, 8, 13, 17 | 20 (17 implemented in 16) |
| 4.3 | Spec examples under test; grammar-block diff; `daysSincePayment` | 20 |
| 5.1 | Per-document schema, completion, hover, symbols, LSP test | 17 |
| 5.2 | Manual `.vsix` QA | 10 |
| 5.2 | Extension CI and `.vsix` content guard | 11 |
| 5.2 | Snippets, icon, settings; other editors | 17 |
| 6 | Design, brief open items, deploy, Lighthouse, launch, versioning | 19 |
| 6 | Playground follows the language | 13, 15, 16 (and 19) |
| 7.1 | Postgres CI job, Node 20.10, release workflow, extension build, lint decision | 11 |
| 7.2 | Lockfiles, `.vsix` build from a clean clone | 11 |
| 7.3 | `status.md` rewrite, roadmap pointer, README/CHANGELOG limitations | 10 |
| 7.3 | `.cursor/rules` upkeep | every phase (closing convention) |
| 7.3 | Embedding guide, `exports`/`types`, docs index | 18 |
