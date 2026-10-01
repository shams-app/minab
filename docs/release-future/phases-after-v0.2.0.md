# Phases after v0.2.0 — the plan

The companion to [`remaining-after-v0.2.0.md`](remaining-after-v0.2.0.md), which is the *inventory* of what is left. This file is the *order*: eighteen phases, each one job with one output, sized to be picked up in a fresh session without needing prior conversation — the same contract [`../roadmap.md`](../roadmap.md) sets for Phases 0–9.

Numbering continues from the old roadmap (which ends at Phase 9), so a phase number means the same thing in both documents.

## How to use this

- **One phase at a time, one branch per phase.** A phase that grows a second theme should be split, not stretched.
- **Sign-off vocabulary is the roadmap's**: **Design** needs a language decision (proposal → concrete example → Hamed's approval, per `.cursor/rules/spec-governance.mdc`) *before* code; **Mechanical** is a checklist; **Mixed** starts as one and becomes the other.
- **Decide first, then build.** Every phase with Design content opens by settling its decisions and writing them into `docs/query-language-spec.md`. No phase should discover a design question halfway through and answer it unilaterally.
- **Every fix gets a test that fails without it.** The repo has a habit of verifying this (Phase 7 reverted its own fix to confirm the regression test caught the bug); keep it.
- **Close each phase the way the roadmap says**: a "what actually shipped" note in this file, a dated entry in [`../status.md`](../status.md), and `.cursor/rules/*.mdc` updated if the layout or conventions moved.
- **Brainstorming goes in [Notes for review](#notes-for-review)**: open questions (Q), things to keep in mind (N) and suggestions (S). When one is settled, move it into the decisions table or a phase.
- **Sizes are guesses** — S is a sitting, M is a session or two, L is several. They are there for sequencing, not for planning a calendar.

## Phase overview

| # | Phase | Sign-off | Size | Output | Status |
|---|---|---|---|---|---|
| 10 | Call functions by name: remove `&` | Design → Mechanical | M | `name(...)` calls a user function; `&` is gone from the language, docs and playground | Not started |
| 11 | Publish 0.2.0 | Mechanical | S | The release exists: tag, npm, `.vsix`, honest limitations | Not started |
| 12 | CI that can catch these bugs | Mechanical | S–M | A push runs the Postgres suite, Node 20.10, and builds the extension | Not started |
| 13 | One language, two runtimes, one answer | Design → Mechanical | M | The interpreter and the compiled SQL agree, or refuse together | Not started |
| 14 | `check` tells the truth | Mechanical | M | No valid program is rejected; no accepted program compiles to invalid SQL → **0.2.1** | Not started |
| 15 | Debugging: `LOG` | Design → Mechanical | S–M | `LOG(value, label)` prints and returns its value; stderr in the CLI, a Console tab in the playground | Not started |
| 16 | Runtime architecture: ports and adapters | Design | S–M | ADR 0002: one runtime API, the ports it calls out through, and where programs run | Not started |
| 17 | One runtime API | Mechanical | L | `prepare`/`run` with data, function, log, clock and trace ports; the CLI and playground run on it | Not started |
| 18 | The server host: Node and NestJS | Mechanical | M | A NestJS module and example app running rules against Postgres inside a transaction | Not started |
| 19 | The browser host | Mechanical | M–L | A worker runtime with a two-way port bridge: data-free programs run locally, the rest go to the server | Not started |
| 20 | Package and document the runtime | Mixed | M | Subpath exports, consumer smoke tests, an embedding guide → **0.3.0** | Not started |
| 21 | The relational layer stops refusing ordinary expressions | Mixed | M–L | `switch`, `is`, JSON literals and multi-key `KEY` work inside a query | Not started |
| 22 | Statements run | Mechanical | L | Loops, blocks, `if!`, local assignment, `.$index` execute | Not started |
| 23 | Writes | Design → Mechanical | L | `INSERT`/`UPDATE`/`DELETE` and path assignment execute through the write port → **0.4.0** | Not started |
| 24 | Editor tooling worth using | Mechanical | M–L | Per-document schema, completion, real hover, an automated LSP test | Not started |
| 25 | Playground: design, deploy, launch | Mixed | L | The wireframe becomes a site with a URL | Not started (parallel track) |
| 26 | Close the language backlog | Design | M | §12 emptied or explicitly post-1.0; the spec's own examples under test | Not started |
| 27 | 1.0 | Mixed | S–M | Every construct the grammar accepts runs, or is gone | Not started |

**Critical path:** 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → (18, 19) → 20 → 21 → 22 → 23 → 24 → 26 → 27.

**Parallel:**
- 18 and 19 run side by side once Phase 17 has fixed the wire format.
- 25 depends on nothing in the language. Deploy it after Phase 10, so no public share link ever holds `&` code.
- 21 and 24 don't depend on the runtime track (16–20); move them ahead of it if they matter more to you.
- 15 could also slide later. It sits early because it helps debug everything after it.

**Why the runtime track comes before the execution layer:** running Minab inside your browser app and your NestJS server is the goal, and read-only rules and queries already run. Designing the ports first also means loops, writes and new built-ins such as `NOW()` (21–23, 26) are built against them, rather than retrofitted.

## Decisions only Hamed can make

Batch-answerable; each blocks the phase named. Pulled out so they can be settled in one sitting rather than ambushing four separate sessions.

| Decision | Blocks | The question |
|---|---|---|
| ~~Remove the `&` call prefix~~ | 10 | **Decided 2026-09-24:** user functions are called `name(...)`, like built-ins. |
| Built-ins vs. user functions without `&` | 10 | How do the two stay apart, so a future built-in can't break an existing `fn`? Leave room for host functions (Phase 16). (Options in Phase 10.) |
| Function names vs. other names | 10 | May a `let`, parameter or host table share a name with a `fn`? |
| Ship-as-is or fix-first | 11 | Publish 0.2.0 with the `CAST` and text-`+` bugs documented, or hold for 0.2.1? |
| npm scope / Marketplace publisher | 11 | Are `@shamsine` and a `shamsine` publisher yours? |
| Text `+` | 13 | Does `+` concatenate `TEXT`, or is it numeric-only? |
| Division and `%` | 13 | Integer division or always-decimal; what `x % 0` and `x / 0` do. |
| `CITEXT` vs. a string literal | 13 | Relax the no-coercion rule for `CITEXT`/`TEXT`, as Phase 4 did for `INTEGER`/`DECIMAL`? |
| `LOG`: name, shape, levels | 15 | `LOG(value, label?)` returning its value, or `PRINT`/`DEBUG`/variadic? One level, or `WARN`/`ERROR` too? |
| A bare call as a statement | 15 | Allow `LOG(x);` (and later `someHostFunction(x);`) on its own line, or keep `let _ = LOG(x);`? |
| `LOG` inside compiled SQL | 15 | Compile through it with a warning (recommended), or refuse? |
| Data port: SQL or structured requests | 16 | Does Minab hand its host SQL text (programs that need server data then run on the server), or a logical request a browser can send safely? |
| Schema up front or on demand | 16 | Loaded once per schema version before checking, or fetched lazily per name? |
| Host functions | 16 | Can the host expose functions to Minab (`currentUser()`, `fxRate(...)`), and how do their names fit Phase 10's rule? |
| Where programs run | 16 | Data-free programs in the browser and the rest on the server, or always one side? |
| Packaging | 16 | One package with subpath exports, or several packages (needs npm workspaces)? |
| Node versions for NestJS | 18 | Raise `engines` to a Node with `require(esm)`, document `import()`, or ship a CommonJS build? |
| Multi-key `KEY` | 21 | What is `KEY` when `GROUPBY` has two keys — a tuple, `KEY[0]`, or an error? |
| A user `fn` inside a query | 21 | Inline pure function bodies into SQL, or evaluate row by row? |
| Writes: safety and scope | 23 | Does `minab run` write by default or need `--apply`? May a *validation rule* write? |
| Built-in library | 26 | Stay at the eight, or add `LOWER`/`LENGTH`/`COALESCE`/`NOW`/date arithmetic? |
| `ref` == primary key shorthand | 26 | Is `.customer == customerId` legal now that the schema carries `primaryKey`? |
| §12 items 2, 3, 4, 8, 13 | 26 | `NOT` precedence, chaining, `[...]` ambiguity, second `let`, `const`. |
| Non-Postgres dialects | 27 | Is a second SQL target in scope for 1.0, or explicitly not? |

Open questions that aren't decisions yet, things worth knowing, and alternative ideas live in [Notes for review](#notes-for-review) near the end of this file.

---

## Phase 10 — Call functions by name: remove `&`

**Goal:** a user function is called `name(...)`, exactly like a built-in, and `&` leaves the language. **Sign-off: Design → Mechanical.** The removal is decided (Hamed, 2026-09-24); the two questions it opens are not. **Size: M.**

**Why first:** 0.2.0 has not been published. There is no `v0.2.0` tag, and `npm view @shamsine/minab` still returns 404 on 2026-09-24. If this lands before Phase 11, the first public release never teaches `&`, so there is nothing to deprecate, migrate or mark as breaking. After publishing, the same change becomes a breaking 0.3.0 change with a deprecation window. Every later phase also writes call-site code: the differential harness, function-body execution, a user `fn` inside a query, LSP completion, the playground's functions lesson. Doing this first saves that churn.

**Why the grammar side is safe:** it is a deletion. A bare `name(...)` already parses today, as a `CallExpression` whose callee is a `NameRef`; that is how the checker produces its current `"x" is a user-defined function — call it as &x(...)` error. Removing the `FunctionCall` rule (`minab.langium:212`) and its `Primary` alternative (`:188`) can't create a parse ambiguity. Confirm that `langium generate` still prints only the one known `Postfix` warning.

**What `&` was paying for, and has to be kept some other way.** The spec says the prefix keeps user functions visually distinct from built-ins and keeps the two "from ever colliding" (§5.3, §12 item 10). The second property matters more than it looks. With bare calls, **adding a built-in later breaks every program that declared a `fn` with that name**, and Phase 26 plans to add `LOWER`, `LENGTH`, `COALESCE` and `NOW`.

**Decide first** (write both into the spec before coding):
1. **How built-ins and user functions stay apart.**
   - **(a) A case rule, enforced. Recommended.** Built-ins are all-uppercase, like every other keyword (`FROM`, `CAST`, `KEY`), and a `fn` name must contain a lowercase letter. A new built-in can then never collide with existing code, and the visual difference `&` gave survives. Every `fn` declared in the spec, showcase, examples, playground and tests already complies (`discounted`, `cumulativeAdd`, `daysSincePayment` and the rest). The only all-uppercase one is `fn SUM`, the deliberate "reserved name" error example, and this rule still rejects it.
   - **(b) Keep today's rule and reserve more names up front.** The eight built-in names stay reserved, plus the planned library. Any built-in added beyond that list is a breaking change.
   - **(c) Let a `fn` shadow a built-in, with a warning.** Nothing ever breaks, but `SUM(...)` can mean different things in different files, and the SQL compiler must check for shadowing before it emits `SUM`.

   Choose with host functions in mind. Phase 16 may let the host expose its own functions (`currentUser()`, `fxRate(...)`), which would be a third source of callable names, so the rule should already say where those fit.
2. **Can other names clash with a function name?** Functions aren't values in Minab (§8: they can't be passed or stored), so a name in callee position can only mean a function. The question is readability. With `&` gone, `total` and `total(...)` look related. The recommendation is a diagnostic when a `let` or parameter shares a name with a declared `fn`, and likewise for a host table name (`Customer(...)`). This overlaps §12 item 8 (whether a second `let` of the same name is allowed), so it can be settled in the same sitting.

**Tasks**
- Language:
  - [ ] **Grammar.** Delete `FunctionCall`, then run `langium generate`. That also regenerates `vscode-extension/syntaxes/minab.tmLanguage.json`.
  - [ ] **Type checker.** `inferCallExpression` resolves the callee: a built-in first (under decision 1's rule), otherwise a declared `fn`. It absorbs `inferFunctionCall` (`minab-type-checker.ts:456`). Its messages drop every `&name(...)` hint (`:413–421`).
  - [ ] **Validator.** Drop `FunctionCall` from the registrations (`minab-validator.ts:75`, `:125`). Enforce decision 1 at `FunctionDecl`, and decision 2 at `VariableDecl` and parameters.
  - [ ] **Interpreter.** `builtin()` sends a non-built-in name to `callFunction` instead of failing (`minab-interpreter.ts:357`). Remove `&` from the messages at `:332–347`, and remove the `isFunctionCall` branch (`:274`).
  - [ ] **SQL compiler.** Confirm that a user-function callee still *refuses* to compile, so the interpreter takes it (the pushdown boundary). The alternative is emitting `discounted(...)` into SQL as if it were a database function: a wrong answer, not a refusal. Pin it with a test.
  - [ ] **Mind the Phase 7 pitfall.** A call's callee `NameRef` must never be type-inferred on its own; doing so produced spurious diagnostics once already. Phase 14's "register `NameRef`" task has to exclude the callee position.
- Tests and examples:
  - [ ] Update `test/` (14 call sites across parsing, type-checking, CLI, evaluation and SQL compilation). Rewrite the item-10 block, don't delete it: a bare user call now passes, decision 1's rule is enforced, and a truly unknown name gets a plain "unknown function" message.
  - [ ] Update `examples/discounted-total` and `examples/reconcile-overdue-accounts` (3 call sites).
- Docs:
  - [ ] **Spec (19 call sites).**
    - §5.3: rewrite the "built-in vs. user-defined" paragraph.
    - §8's preamble and §8.4: every example.
    - §11: the grammar block.
    - §12 item 10: mark it "resolved, then revised 2026-09-24" and keep the history, the way item 9 keeps `yield`'s.
  - [ ] `docs/showcase.md` (6 call sites).
  - [ ] The `CHANGELOG.md` 0.2.0 entry, which mentions "`&`-prefixed function disambiguation".
  - [ ] `.cursor/rules/00-project-overview.mdc` line 21.
  - [ ] Leave `roadmap.md` and the `status.md` log alone; they are history.
- Playground:
  - [ ] **Engine and editor code:**
    - `syntax/tokens.ts:168` tokenizes `&name`;
    - `monaco/language.ts:112` uses `&` as a completion trigger;
    - `engine/intel.ts:167–170` and `:243` build hover text and complete after `&`;
    - `engine/engine.ts:92` labels the construct.
  - [ ] **Content:** tour lesson 10 (`lesson.md`, `starter.minab`, `solution.minab`, and its goal in `tour/index.ts`), the cheat sheet, the landing snippet, the gallery examples, and `design/prompts.md` (2 mentions).
  - [ ] **Tests:** `test/engine.test.ts` and `test/tokens.test.ts`.
  - [ ] **Old programs:** the playground isn't deployed, so no share link or saved workspace outside this machine holds `&` code. There is nothing to migrate.
- [ ] **A drift guard.** Add a test that fails if `&` followed by an identifier appears in any `.minab` file, any spec or showcase code block, or any playground content. There are 30+ places a stale example could hide, and nothing else would catch one.

**Done when:**
- `grep -rE '&[A-Za-z_]+\('` finds nothing outside history: `roadmap.md`, the `status.md` log, and §12 item 10's record.
- Both test suites are green.
- `discounted(200, 15)` runs in `examples/discounted-total`.
- Decision 1 has a test that would catch a future built-in colliding with an existing `fn`.

**Not in this phase:**
- Hover and go-to-definition on function names. They belong to Phase 24, and get easier after this phase because a callee `NameRef` now resolves to its `FunctionDecl`.
- Running a user `fn` inside a query (Phase 21).

---

## Phase 11 — Publish 0.2.0

**Goal:** the thing that is built becomes a thing that exists. **Sign-off: Mechanical** (plus two Hamed-only decisions). **Size: S.**

**Why here:** everything downstream is a fix or an addition to a released baseline. Also, the repo currently claims a release that no one can install. It comes after Phase 10 so the first release doesn't teach the `&` syntax that is already on its way out.

**Tasks**
- [ ] Confirm Phase 10 has landed: nothing in the tarball (`docs/`, `examples/`) or the `.vsix` grammar still uses `&name(...)`.
- [ ] Decide ship-as-is vs. fix-first (see the decisions table). If fix-first, do Phases 12–14 and publish as 0.2.1 instead; the rest of this phase is unchanged.
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

## Phase 12 — CI that can catch these bugs

**Goal:** the suite that proves the compiled SQL runs actually runs. **Sign-off: Mechanical.** **Size: S–M.**

**Why here:** three of the next phase's bugs are only visible against a real database, and `test/postgres.test.ts` is skipped on every push today. Doing this before the fixes means the fixes arrive with proof instead of a promise.

**Tasks**
- [ ] Add a `services: postgres` job (with `citext` available) and set `MINAB_TEST_DATABASE_URL`, so the six opt-in tests run on every push. This is the highest-value change in the phase.
- [ ] Add Node `20.10` to the matrix — it is the declared `engines` minimum and nothing tests it.
- [ ] Add an extension job: install, `npm run build`, `npm run package`. A broken bundle currently reaches a release unnoticed.
- [ ] Extend `test/release.test.ts` (or add a sibling) to assert the **`.vsix` contents** the way it already asserts the npm tarball — Phase 9 shipped `src/` in a `.vsix` once.
- [ ] Add a tag-triggered release workflow: build, `npm publish --provenance`, build the `.vsix`, attach it to the GitHub release. Phase 11's steps become one push.
- [ ] Housekeeping: pick one lockfile system (CI uses npm), then delete or ignore the `bun.lock` files — `playground/bun.lock` is untracked and the root one is committed.
- [ ] Decide whether to adopt a linter/formatter. If no, write that down so it stops being an open question.

**Done when:** a pull request shows a green Postgres job, and a tag produces a published package and an attached `.vsix` with no local steps.

**Not in this phase:** fixing anything the new jobs turn red — note it and take it into Phase 13 or 14.

---

## Phase 13 — One language, two runtimes, one answer

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

**Not in this phase:** anything that doesn't *run* today (that's 21–23).

---

## Phase 14 — `check` tells the truth

**Goal:** no valid program is rejected, and nothing `check` accepts compiles to SQL the database rejects. **Sign-off: Mechanical.** **Size: M.**

**Why here:** `check` is the contract the CLI, the language server and the playground all lean on. It is also the last blocker for 0.2.1.

**Tasks**
- [ ] **A top-level rule that filters a collection.** `COUNT(.orders[.status == "x"]) < 5` (showcase §1) fails with `column "status" needs a statically known table`. Give `MinabScopeResolver` a view of the host's `rule.recordTable`, which only `MinabTypeChecker` sees today.
- [ ] Add the regression test at the **`check`** level. It went unnoticed because `test/evaluation.test.ts` calls the interpreter without the validator.
- [ ] **Revert the three workarounds** written around that bug: `examples/cancelled-orders-limit` (uses `FROM … WHERE`), `examples/overdue-loop` (iterates `#Order` rather than `.orders`), and the playground gallery's `COUNT(#Order[.customer == ^ …])` forms.
- [ ] **`GROUPBY` on a traversed column.** `GROUPBY .customer.country` emits a `GROUP BY (SELECT …)` repeated in `SELECT`, which Postgres rejects as an ungrouped outer column. Group by the foreign key and project through it, or hoist the traversal into a `LEFT JOIN`. Cover it in `test/postgres.test.ts` — a diff against expected SQL cannot catch this class.
- [ ] **The three unregistered node types.** `ParentRecord`, plain `NameRef` and `Subquery` have failure paths in the checker but are not in the validator's registered set, so nested failures go unreported. Register exactly those three (Phase 7 tried registering all of `Expression` and reverted for good reason), and keep a call's callee `NameRef` excluded (Phase 10 makes every function call a `NameRef` callee). Add a test where each fails *nested under* a registered ancestor.
- [ ] **`ORDERBY` on a non-alias expression** compiles, while the roadmap and ADR describe ordering by select alias. Confirm what the spec intends and pin it with a test either way.

**Done when:** showcase §1's own example passes `check` and runs, the examples are back on their natural forms, and the traversed `GROUPBY` executes against real Postgres in CI.

**→ Release 0.2.1** after this phase: Phases 12–14, plus whatever Phase 11 documented as a known limitation and is now fixed.

---

## Phase 15 — Debugging: `LOG`, and somewhere for logs to go

**Goal:** a program can print values while it runs, the way `console.log` does in JavaScript, and each host decides where the lines go. The CLI writes them to stderr and the playground shows them in a Console tab; later, Nest's logger and the browser console take them. **Sign-off: Design → Mechanical.** **Size: S–M.**

**Why here:** it is small, and it helps debug everything after it, both the runtime track and the execution layer. It also hands Phase 16's ADR a real second port to design around. It follows the precedent of `onStatement`: a callback on `EvalContext` now, formalized as a port once the runtime API exists.

**Proposed shape: `LOG(value)` or `LOG(value, label)`.** It is an *expression* that logs its value and returns that value unchanged, like Rust's `dbg!`. It has the type of `value`, so it can wrap any subexpression without restructuring the program:

```
// a validation rule, printing an intermediate value
LOG(COUNT(.orders[.status == "cancelled"]), "cancelled") < 5
```

```
fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL {
    let cut: DECIMAL = LOG(total * rate / 100, "cut");
    total - cut
}
```

Why an expression rather than a `log x;` statement: most Minab programs are one expression (a rule), and `BodyStatement` has no expression-statement form (`minab.langium:81`). A statement-only `log` couldn't be used inside a rule, a filter or a `WHERE`.

**Decide first**
1. **Name and shape.**
   - `LOG(value, label?)`, as above. **Recommended.**
   - `PRINT` or `DEBUG` instead of `LOG`.
   - A variadic `LOG("label", a, b, …)` like `console.log`.
   
   Every built-in takes exactly one argument today (`minab-type-checker.ts:423`), so each of these changes the built-in signature machinery. All-uppercase fits Phase 10's recommended case rule.
2. **Levels.** One `LOG`, or `LOG`/`WARN`/`ERROR`, which the host can filter. Recommended: one `LOG` now, with the level as a host-side setting. Add levels when there is a use for them beyond debugging (see note Q6 below).
3. **A statement form.** `LOG(x);` alone in a function body doesn't parse today. Either:
   - allow a bare *call* as a statement, which host functions with side effects would want too;
   - or accept `let _ = LOG(x);`.
   
   Recommended: the bare call statement.
4. **`LOG` inside compiled SQL.** A `LOG` in a part that runs in the database (a query's `WHERE`, or a filter pushed down) can't call back to the host per row. Recommended: compile `LOG(x)` as plain `x`, with a checker *warning* that this log runs in the database and won't print. Refusing to compile instead would mean that adding a debug line breaks the program.

**Tasks**
- [ ] **Spec.** Add a row to §5.3.1 and a short "Debugging" subsection that says what prints and what doesn't (compiled regions; short-circuited `AND`/`OR`; branches not taken). Add a showcase example.
- [ ] **Checker.** `LOG` has its first argument's type, and the label is `TEXT`. Warn when a `LOG` sits inside a compiled region.
- [ ] **Interpreter.** Evaluate the value, emit `{ value, label, source range, time }` through a new `EvalContext.onLog` hook, and return the value.
- [ ] **Compiler.** `LOG(x)` compiles as `x`.
- [ ] **CLI: logs go to stderr, never stdout.** `minab run --json` prints its result on stdout to be piped, and `--trace` already writes to stderr (`src/cli/main.ts:278`), so logs follow the same rule.
  - Format: `file:line:col label: value`, using `formatValue` from `src/host/format.ts`.
  - Add a flag to silence logs or send them to a file.
- [ ] **Playground.** Add a Console tab next to Execution; each line links to its source span, the way Execution highlights a statement's origin.
- [ ] **A per-run cap on log entries.** Once Phase 22's loops run, one `LOG` in a loop could flood the output. Report truncation; don't treat it as an error.
- [ ] **Tests:**
  - lines arrive in evaluation order;
  - the value comes back unchanged;
  - a `LOG` on the right side of a short-circuited `AND` doesn't print;
  - a `LOG` inside a compiled query warns and the query still runs;
  - `--json` stdout stays parseable with logs on.

**Done when:** `minab run` on a rule containing `LOG` prints the logged values to stderr with their source positions, the result on stdout is unchanged, and the playground shows the same lines in its Console tab.

**Picked up later:**
- Phase 16 makes `onLog` a `log` port.
- Phase 17 puts logs in the structured run result, so a remote run returns them.
- Phase 18 adds a Nest `Logger` adapter.
- Phase 19 adds the browser console, and brings back logs from runs delegated to the server.

**Ships with 0.3.0.** A feature can't go in a patch release.

---

## Phase 16 — Runtime architecture: ports and adapters

**Goal:** decide, in writing, how one Minab runtime runs in a browser and in a NestJS server, and what it asks its host for. **Sign-off: Design.** **Size: S–M.** No production code; a throwaway spike is fine.

**Why here:** after 0.2.1 the language gives right answers, and the next most valuable thing is running it where you need it. Designing the ports before the execution layer (Phases 21–23) means loops, writes and host functions get built against them instead of retrofitted.

**Is hexagonal the right shape? Yes, and Minab is most of the way there already.**
- **The core does no I/O.** In `src/language/`, only the language-server entry (`main.ts`) imports anything Node-specific. `src/host/` already runs unchanged inside the playground's Web Worker.
- **There is already one driven port.** `QueryExecutor` (`minab-executor.ts`): the interpreter compiles a statement, hands it out and awaits the rows. That is "Minab calls outside and waits for the response."
- **The driving side is missing.** There is no runtime API. The CLI (`src/cli/main.ts`) and the playground (`playground/src/engine/engine.ts`) each wire parse → build → validate → compile or evaluate by hand over raw Langium services. A NestJS host would be a third copy.

Keep the hexagon at the boundary. Langium's parser and validator and Minab's type checker, compiler and interpreter are the core's machinery; they don't need ports of their own.

**The shape to write down** (ADR 0002, `docs/adr/0002-runtime-ports.md`):
- **Driving port: the runtime API.** For example, `createMinab({ schema, functions, limits })` → `minab.prepare(source, ruleContext)` → a `PreparedProgram` with `diagnostics`, `kind`, `needsData`, `compile()` and `run(inputs, ports, { signal })`.
  - **Prepare once, run many**: a stored validation rule is parsed and checked once, then run per record.
  - **`needsData`** says up front whether a run can reach the data port at all.
- **Inputs are given, not asked for:** the record under validation, `$`, and any variables.
- **Driven ports are asked, and awaited:**
  - `data`: read statements (today's `QueryExecutor`).
  - `write`: transactional writes for Phase 23. Designed now, implemented then.
  - `functions`: host functions the host implements, such as `currentUser()` or `fxRate(...)`, declared with signatures. `MinabFunctionSchema` already exists in `schema.ts` and nothing consumes it; its own comment says it waits for "a real need". This is that need.
  - `clock`: so `NOW()`-style built-ins (Phase 26) are deterministic and testable.
  - `trace`: today's `onStatement`, generalized to statement, source span and timing.
  - `log`: Phase 15's `onLog`, where `LOG(...)` output goes. Consider merging `trace` and `log` into one event stream (note S6).
- **Cross-cutting:**
  - cancellation through `AbortSignal`;
  - limits on wall time, statements, rows, loop iterations and recursion depth;
  - structured results with a code and a source range. Today `EvalResult` carries only a string `reason`, which a host can't map to an HTTP status or an editor marker.

**Decide first**
1. **What the data port carries.** The browser story hinges on this.
   - **(A) SQL text plus parameters, as today. Recommended, with delegation.** It is right on the server, and in a browser with an in-browser database (PGlite). But **a browser must never send that SQL to your server to execute**: an endpoint that runs client-supplied SQL is an injection hole, parameters or not. So a browser run that needs server data is delegated: the browser sends the *program and inputs*, and the server prepares and runs it itself.
   - **(B) A structured data request**: a small logical query (table, filters, projection, aggregate, bound values) that the host answers however it likes and a server can validate against its own schema. It is safe to send from a browser, but the SQL compiler splits into a request builder (core) and a SQL emitter (an adapter), which touches every pushdown.
   
   Record (B) in the ADR as the upgrade path, in case browser-side execution against server data becomes a requirement. Most validation rules never touch the data port (the playground's "0 statements" rules), and those run in the browser instantly under either option.
2. **Schema up front, or on demand?** Checking is synchronous; a check that awaited the network per identifier would make an editor unusable. Recommended: the host's schema loader is called once, asynchronously, before preparing, and the result is cached under a version key.
3. **Host functions: yes or no, and where do their names fit?** If yes, they are a third source of callable names next to built-ins and user `fn`s. Reconcile them with Phase 10's naming rule; for example, host functions follow the user-function case rule and a user `fn` may not shadow one.
4. **Where programs run.** Recommended: the browser prepares, checks, previews compiled SQL and runs data-free programs locally; anything with `needsData` runs on the NestJS server through the same API.
5. **Packaging.** One package with subpath exports (`@shamsine/minab`, `/node`, `/browser`, `/nestjs`) and optional peer dependencies, or separate packages, which needs npm workspaces (the repo has avoided them so far). Recommended: subpaths.

**Tasks**
- [ ] Write ADR 0002 covering the above, with one sequence diagram per topology: prepare → run → data port → rows → result.
- [ ] A throwaway spike: run one correlated rule with a data port from a Vite page and from a NestJS controller using deep imports. The point is to hit the surprises (ESM/CJS, bundle size, concurrency) before committing to an API.
- [ ] Hamed's sign-off before Phase 17. This is the same gate Phase 5 used for ADR 0001.

**Done when:** ADR 0002 is signed off and gives a TypeScript interface for every port.

**Not in this phase:** implementing any of it.

---

## Phase 17 — One runtime API

**Goal:** the runtime API and the ports from ADR 0002 exist in `src/`, free of any environment, and both existing hosts use them. **Sign-off: Mechanical.** **Size: L.**

**Why here:** the CLI and the playground are two working hosts already. Moving both onto one API is the cheapest proof that the API is complete, before a third host depends on it.

**Tasks**
- [ ] **The API**: `createMinab`, `prepare`, `PreparedProgram`, `run`, `compile`, in a new module such as `src/runtime/`. It must not import `node:*`, `langium/node`, the DOM or `pg`; add a test that walks the import graph and fails if one appears.
- [ ] **A service cache.** Langium services are built per schema and rule context, about 80 ms each in production mode (Phase 6 measured it). Cache them by schema version, with a size cap.
- [ ] **Document lifecycle.** Every prepare uses its own document URI and releases it, so a long-running server doesn't accumulate documents in the shared workspace. The playground reuses one fixed URI, which is only safe because it runs one program at a time.
- [ ] **Concurrency.** Prove that N concurrent runs on one service set return correct, independent results. If Langium's `DocumentBuilder` can't guarantee that, isolate them: a pool of service sets, or parse and validate outside the shared workspace.
- [ ] **The ports:**
  - `data` keeps today's `QueryExecutor` shape.
  - `functions` is wired through the checker for signatures and through the interpreter for calls. The compiler refuses a host-function call, so it is never pushed into SQL.
  - `clock`.
  - `trace`, of which today's `onStatement` becomes one use.
  - `log`, replacing Phase 15's `onLog`. Logs are also collected in the run result, so a caller that passes no `log` port still gets them.
  - `write` gets its interface only; Phase 23 implements it.
- [ ] **Cancellation and limits.** Check the `AbortSignal` between interpreter steps and pass it to every port call; expose wall-time, statement and row limits as options.
- [ ] **Structured results**: a code, a message and a source range, for diagnostics and for run-time failures alike.
- [ ] **`needsData`**, computed at prepare time from the pushdown analysis the playground already surfaces.
- [ ] **A wire format for one run**: program, rule context, inputs and options in; result or diagnostics, plus logs, out. Version it, so Phase 18's server and Phase 19's browser client can be built in parallel against it.
- [ ] **Move both hosts onto it.** Rewrite `src/cli/main.ts` and `playground/src/engine/engine.ts` on the runtime API, with no deep imports into `src/language/`.

**Done when:** the CLI and the playground run entirely on the runtime API, both suites are green, and the core has no environment-specific import.

**Not in this phase:** any adapter beyond the ones the CLI and playground already have (fixture, `pg`, PGlite).

---

## Phase 18 — The server host: Node and NestJS

**Goal:** a NestJS app runs Minab programs against its own database, inside its own request lifecycle. **Sign-off: Mechanical**, plus one Node-version decision. **Size: M.**

**Tasks**
- [ ] **Data adapters for Node:**
  - `pg`, starting from the CLI's existing executor (`src/cli/executors.ts`);
  - a generic `fromQueryFunction((text, params) => rows)`, so TypeORM's `dataSource.query` or Prisma's `$queryRawUnsafe` plug in without Minab depending on either.
  
  Statements use Postgres's `$1` placeholders; an adapter for a driver that wants `?` has to translate them.
- [ ] **Transactions.** Ports are passed per run, so a request can hand Minab the connection of the transaction it is already in. Show it with a TypeORM `QueryRunner` or a Prisma interactive transaction.
- [ ] **A NestJS module:**
  - `MinabModule.forRoot` / `forRootAsync`, taking the schema loader, function implementations and limits;
  - an injectable `MinabService` exposing prepare and run;
  - an exception filter that maps structured errors to HTTP responses;
  - a `log` adapter onto Nest's `Logger`, tagged with the request and the program, and switched off by default in production (note N4).
- [ ] **An optional run endpoint**: a controller implementing Phase 17's wire format, for Phase 19's remote adapter. The server uses **its own** schema and data ports; it never accepts a schema or SQL from the client.
- [ ] **Security for user-authored programs.** The schema you hand Minab is its read surface: a program can reach any table in it. Scope the schema per user or tenant, or back it with database row-level security, and keep Phase 17's limits on. Document this prominently.
- [ ] **Multi-tenancy**: one service set per schema version, from Phase 17's cache.
- [ ] **ESM and CommonJS.** Minab and Langium are ESM-only (Langium exports only an `import` condition), and Nest's default template compiles to CommonJS. `require()` of an ES module works unflagged only from Node 20.19 / 22.12, but `engines` says `>=20.10`. Pick one:
  - raise `engines`;
  - document `await import()` for older Node versions;
  - ship a CommonJS build.
  
  Verify the choice in a freshly generated Nest project, not by reasoning about it.
- [ ] **An example app** in `examples/nestjs/`, its own package like `playground/`. It needs:
  - a validation endpoint that runs a stored rule per incoming record;
  - a query endpoint;
  - end-to-end tests against Postgres, run in CI.

**Done when:** the example app, compiled to CommonJS as `nest new` creates it, validates a record with a correlated rule against Postgres inside a transaction, and its end-to-end tests run in CI.

---

## Phase 19 — The browser host

**Goal:** a web app runs Minab through the same API: locally when a program needs no data, on the server when it does. **Sign-off: Mechanical.** **Size: M–L.**

**Tasks**
- [ ] **A worker runtime.** Langium and Chevrotain belong off the main thread, as the playground already does. Generalize `playground/src/engine/worker.ts` and `playground/src/client/engine-client.ts` into a published worker entry and a client with the Phase 17 API.
- [ ] **A two-way port bridge.** The playground's bridge only goes main → worker, because its database lives inside the worker. An app's ports live on the main thread, so the worker has to call *out* and wait: request ids, timeouts, `AbortSignal` propagation, and errors carried back across. This is "call outside and wait" in its browser form.
- [ ] **A remote adapter**: `createRemoteMinab({ endpoint })`, with the same API, speaking Phase 17's wire format to Phase 18's controller. App code calls `run` and doesn't care where the program ran.
- [ ] **Routing by `needsData`**: a helper that runs data-free programs locally and delegates the rest, following ADR 0002's topology.
- [ ] **Editor services from the worker.** Package the diagnostics, hover, completion and AST view that `playground/src/engine/intel.ts` already computes, for any Monaco host. Phase 24 does the same for VS Code; share the code.
- [ ] **Logs in the browser**: a `console` adapter for local runs, and the logs carried back in the result of runs delegated to the server.
- [ ] **PGlite as an optional in-browser data adapter**, lifted from the playground, for demos and offline use.
- [ ] **A bundle budget.** Measure the worker bundle, set a budget in CI, and make sure no Node-only module (`pg`, `node:fs`) can reach a browser bundle.
- [ ] **Move the playground onto the published browser entry.** It is the last proof that the API is enough.

**Done when:** a minimal Vite app in `examples/browser/` validates a form record locally, with zero network calls, for a data-free rule, and delegates a correlated rule to Phase 18's example app. A browser test covers both paths.

---

## Phase 20 — Package and document the runtime

**Goal:** a host application depends on Minab only through documented entry points. **Sign-off: Mixed.** **Size: M.** This absorbs the phase previously called "The embedding API".

**Tasks**
- [ ] **`exports` and `types` maps**, one subpath each:
  - `.`: the runtime and its types, environment-free;
  - `./node`;
  - `./browser`: the client and worker entries;
  - `./nestjs`;
  - `./lsp`;
  - `./host`: config parsing and the fixture adapter.
  
  Today `files` publishes `out/src` with no entry points at all.
- [ ] **Optional peer dependencies** for `pg`, `@nestjs/common` and `@electric-sql/pglite`; none becomes a hard dependency.
- [ ] **Consumer smoke tests in CI**: a CommonJS Node project, an ESM Node project, a Nest project and a Vite project, each installing the packed tarball. Phase 9 did this by hand once.
- [ ] **The embedding guide**: the ports, the two topologies, Phase 18's security note, and a NestJS walkthrough and a browser walkthrough that cite the two example apps rather than inventing code.
- [ ] **A compatibility policy** for the runtime API while the version is `0.x`.
- [ ] **`docs/README.md` as an index**: spec, showcase, roadmap, status, both ADRs, this plan and the embedding guide.

**Done when:** both example apps import only documented paths, the four smoke tests are green, and the guide alone is enough to wire up a new host.

**→ Release 0.3.0** after this phase: Minab is embeddable, in the browser and in NestJS.

---

## Phase 21 — The relational layer stops refusing ordinary expressions

**Goal:** constructs that work outside a query stop being refused inside one. **Sign-off: Mixed.** **Size: M–L.**

**Why here:** these are honest refusals, not wrong answers, so they rank below Phases 13–14 — but they are ordinary spec constructs (§5.6, §9.2), and a user meets them early.

**Decide first:** multi-key `KEY`; whether a user `fn` inside a query inlines into SQL or runs row by row.

**Tasks**
- [ ] `switch` and `if` → `CASE WHEN`.
- [ ] `is`/`isnot` → `IS NULL`/`IS NOT NULL`, and the five JSON kinds → `jsonb_typeof`.
- [ ] JSON object and list literals → `jsonb_build_object`/`jsonb_build_array`.
- [ ] **Multi-key `KEY`** (`minab-sql-compiler.ts:334`), per the decision.
- [ ] **`FROM` over a filtered related collection** (`minab-sql-compiler.ts:255`) — `FROM .orders[.status == "x"]` refuses today; reaching it through an aggregate or `EXISTS` works.
- [ ] **A user `fn` inside a query**, per the decision. Note a row-by-row fallback overlaps the interpreter work in Phase 22; if you pick that route, consider moving this item there.
- [ ] Every new form gets a Postgres test, not only a SQL diff.

**Done when:** each construct in this list either compiles and executes, or refuses for a *newly stated* reason that is in the spec.

**Not in this phase:** statements (Phase 22) and writes (Phase 23).

---

## Phase 22 — Statements run

**Goal:** everything that does not touch the database executes. **Sign-off: Mechanical** (ADR 0001 already settles the strategy). **Size: L.**

**Why here:** the largest remaining block of "parses, type-checks, refuses to run," and it is self-contained: no write path, no transactions.

**Tasks**
- [ ] **Blocks with statements** (`minab-interpreter.ts:285`) and **statements in a function body** (`:343`) — only `let` runs in a `fn` today, so a function containing an assignment or an `if!` fails.
- [ ] **Local assignment** (`x = …`, compound `+:` and friends, §9.3) — locals only; a path that writes through the record belongs to Phase 23.
- [ ] **`if!` statements** (§9.1.1) — largely falls out of statement execution.
- [ ] **Loops** (§9.4, all three forms, labeled `break`/`continue`) — push a frame per iteration; the scope resolver already models the loop's scope.
- [ ] **Guards**: a loop-iteration limit and a recursion-depth limit, enforced through Phase 17's limits and `AbortSignal`. A runaway `fn` currently has nothing stopping it.
- [ ] **`.$index`** (`:305`, §3.5) — array sources only.
- [ ] **Tuples** (§7.6) — confirm what the interpreter does today, then implement or label deliberately.
- [ ] Promote `examples/overdue-loop` from check-only. `test/examples.test.ts` asserts check-only examples are *refused*, so it will fail until the manifest is updated — that is the design, not a break.
- [ ] Update the playground's check-only labels and cheat sheet for what now runs.

**Done when:** `overdue-loop` runs and produces its documented answer, and no `"…" is not executed yet (Phase 5 scope)` message remains for a non-write construct.

**Not in this phase:** anything that persists a change.

---

## Phase 23 — Writes

**Goal:** `INSERT`/`UPDATE`/`DELETE` and path assignment execute. **Sign-off: Design → Mechanical.** **Size: L.**

**Why here:** last and largest, because it is the only phase that can damage data, and it needs the statement machinery from Phase 22 underneath it.

**Decide first**
- Does `minab run` write by default, or require `--apply`, with a dry-run default that prints the statements? (Recommendation: dry-run by default; a language runner that mutates on `run` is a sharp edge.)
- May a **validation rule** write? Spec §1 says Minab supports declarative, trigger-like writes, but when a rule fires is entirely the host's business and is unspecified anywhere.
- Transaction and atomicity semantics for a program that validates *and* writes.

**Tasks**
- [ ] Implement the `write` port ADR 0002 specified (Phase 16): a transaction boundary and affected-row counts, plus the Node adapters from Phase 18.
- [ ] **Relational DML → SQL DML**, per ADR 0001.
- [ ] **`JSON`-array targets → interpreted read-modify-write**, the other half of the ADR's split, including the ordinal forms (`DELETE .customers[2]`, `WHERE .$index > 2`).
- [ ] **Path assignment with `!` vivify** (§9.3), and §12 item 17 — `!` on a `collection` step is *assumed* to be a semantic error and has never been confirmed or implemented as a check.
- [ ] CLI surface for the safety decision, plus dry-run output a human can read.
- [ ] Promote `examples/order-dml` and `examples/reconcile-overdue-accounts` from check-only; update `test/examples.test.ts`.
- [ ] Postgres tests that assert the rows actually changed, and rolled back when they should.

**Done when:** all eleven examples execute, and a write can be previewed without performing it.

**→ Release 0.4.0** after this phase: the execution layer is complete.

---

## Phase 24 — Editor tooling worth using

**Goal:** the language server does more than squiggles and one hover. **Sign-off: Mechanical.** **Size: M–L.**

**Why here:** the playground already proves each feature against the same services (`playground/src/engine/intel.ts` implements hover, completion, go-to-definition and an AST view), so this is largely porting — but it is worth doing after the language stops changing underneath it.

**Tasks**
- [ ] **Per-document schema.** The server reads one `minab.config.json` at startup and shares it across every open document; two folders with different schemas get the wrong one. Re-discover per document and watch config files — a schema edit needs a server restart today.
- [ ] **Completion**: columns after `.`, tables after `FROM`/`#`, the eight built-ins, user `fn` names, keywords.
- [ ] **Hover beyond `#alias`**: a field's type, a function's signature, any expression's inferred type.
- [ ] Document symbols, rename and find-references for `let`/`fn`/aliases; signature help; semantic tokens; code actions for the two messages users hit most (`unknown function — did you mean …`, `add a CAST`).
- [ ] Hover and go-to-definition on a function name. After Phase 10 a callee `NameRef` resolves to its `FunctionDecl`, so this reuses what the checker already knows.
- [ ] **An automated stdio LSP test.** `test/lsp.test.ts` calls providers directly; the only end-to-end evidence is a manual handshake from Phase 9.
- [ ] Extension polish: snippets, an icon and gallery banner for the Marketplace, settings for a config path and trace level, a status-bar item naming the loaded config.
- [ ] A short README section on using the server from Neovim, Helix or Zed — it is stdio LSP, so this is a documented launch line, not work.

**Done when:** typing `.` in a `.minab` file offers that table's columns, two folders with different schemas both check correctly, and an automated test drives the server over a real connection.

---

## Phase 25 — Playground: design, deploy, launch

**Goal:** the wireframe becomes a site with a URL. **Sign-off: Mixed.** **Size: L.** **Parallel — depends on no language work.**

**Why separate:** it is a different skill and a different audience, and it blocks nothing.

**Tasks**
- [ ] **Hamed's open items** (`playground/design/brief.md`): the story behind the name "Minab", a domain, the portfolio URL (`src/content/landing.ts` has a `TODO(hamed)` and an empty `authorUrl`, so the footer link is blank), social handles, and the brand direction A/B/C.
- [ ] **The design pass**, Steps B–E of `playground/design/README.md`: the 15 prompts, then hand off to Claude Code on a `playground-design` branch. `design/contract.md` fences it — `src/ui/**`, tokens and styles may change; engine, state, hooks and content may not.
- [ ] **Deploy** (Step H): pick a host, set `PLAYGROUND_BASE` if it is served under a path, serve PGlite's `.wasm`/`.data` immutable and compressed, add a deploy workflow.
- [ ] **Step F verification** — it has never been run: light and dark at 1440 px and 375 px, keyboard-only, reduced motion, Lighthouse ≥ 90 performance on the landing page and ≥ 95 accessibility everywhere.
- [ ] **Launch material** (`design/launch-kit.md`): video, screenshots, case study, posts.
- [ ] Decide whether the playground gets a version and a CHANGELOG section; it is `0.1.0` and `private` with no entry today.
- [ ] Keep it honest as the language moves: Phases 14, 22 and 23 each retire a "check-only" label or a workaround here. Phase 19 moves the playground's engine onto the published browser runtime; `design/contract.md` already keeps the design pass out of `engine/`, so the two don't collide. Its own suite fails when a lesson's goal changes, so the drift announces itself.

**Done when:** the site is live at a URL you would put on a portfolio, and the Step F checklist is signed off.

---

## Phase 26 — Close the language backlog

**Goal:** §12 is empty or explicitly post-1.0, and the spec is under test. **Sign-off: Design.** **Size: M.**

**Why here:** most of these change the language, so they should land after the implementation is stable and before 1.0 freezes it.

**Tasks**
- [ ] **Close what is already settled by the implementation**, with a test pinning each: item 1 (the `CurrentRecord` AST shape evidently suits the evaluator), item 2 (`NOT` precedence), item 3 (`IN`/`LIKE` non-chaining), item 17 (vivify on a `collection`, if Phase 23 implemented the check).
- [ ] **Decide the rest**: item 4 (`[...]` list vs. filter ambiguity, and the standing Chevrotain warning in `Postfix`), item 8 (a second `let`: redeclaration or rebinding), item 13 (`const`).
- [ ] **A built-in library**, per the decision — `LOWER`, `LENGTH`, `COALESCE`, `NOW`, date arithmetic. The set is deliberately closed at eight today, which real validation rules will feel. Without `&`, a new built-in only stays non-breaking if Phase 10's naming rule holds; check each addition against it.
- [ ] **`ref` == primary key shorthand**, per the decision. Phase 4 flagged it and Phase 5 removed the blocker by adding `primaryKey` to the schema.
- [ ] **Write the two Phase 4 judgment calls into the spec** — "`INTEGER`/`DECIMAL` are one numeric family" and "a query used as a scalar needs no `LIMIT 1`" live in code comments and the roadmap, not in §5.5/§5.4.
- [ ] **Put the spec's own examples under test.** Only `showcase.md` is covered; two defects were found in the spec *after* Phase 1 for exactly that reason. Extract its fenced blocks into a parse-and-check test.
- [ ] **Diff §11's grammar block against `src/language/minab.langium`** in a test — it is a hand-copied duplicate.
- [ ] Define `daysSincePayment` in showcase §14; it is called there and defined nowhere.

**Done when:** §12 contains only items explicitly labeled post-1.0, and a spec example cannot drift from the grammar without a test failing.

---

## Phase 27 — 1.0

**Goal:** the version number stops apologizing. **Sign-off: Mixed.** **Size: S–M.**

**Criteria** (each already true or delivered by an earlier phase):
- [ ] Every construct the grammar accepts either runs or has been deliberately removed from the grammar.
- [ ] No known wrong-answer bug; the differential harness from Phase 13 is green.
- [ ] The Postgres suite runs in CI on every push.
- [ ] The runtime API is documented, with a stated compatibility policy, and runs in a browser and in a NestJS app through the same calls, with CI smoke tests for both (Phases 17–20).
- [ ] §12 is closed or explicitly post-1.0.
- [ ] The dialect decision is recorded: either a seam exists and a second target is tested, or "Postgres only" is written into ADR 0001's consequences and the README.

**Tasks:** a final audit against the list above, a CHANGELOG entry that states the 0.x → 1.0 compatibility promise, and a version bump across `package.json`, `vscode-extension/package.json` and the CHANGELOG (`test/release.test.ts` already guards that they match).

---

## Notes for review

Brainstorming notes from planning, kept here so they can be reviewed in one sitting rather than lost in a chat. None of them is decided. When one is settled, move it into the decisions table or a phase, and strike it through here. IDs are stable, so "S2" means the same thing in any conversation.

### Open questions

- **Q1. Who writes Minab programs?** Is it your developers, in a repository with review, or your app's end users, in a browser editor? The answer changes most of the runtime track:
  - security: whether the server should accept program text at all;
  - how strict the limits need to be;
  - how much editor tooling matters.
  
  → Phases 16–20, 24.
- **Q2. Where do programs live?** If rules are stored in your database and run by NestJS, they need ids, versions and a migration story (S2). → 17, 18.
- **Q3. Which database does the NestJS app use?** The compiled SQL is Postgres-flavored (ADR 0001). If the answer is Postgres, the dialect question can stay closed. → 18, 27.
- **Q4. How does a failed rule explain itself to an end user?** A rule only returns `true` or `false` today, but real validation needs a message, perhaps a field to attach it to, and translations. Is that a language feature (a message on the rule) or the host's job (a message stored next to the rule)? → 26.
- **Q5. Where does the Minab schema come from in a NestJS app?** Today it is a hand-written `minab.config.json`. Next to TypeORM entities or a Prisma schema, a hand-written copy will drift (S3). → 18.
- **Q6. Are logs only for debugging, or also for production?** The designs differ. Debug output can be dropped by default; production logs (audit trails, say) need levels, structure and retention. Phase 15 assumes debugging only. → 15.
- **Q7. Do browser users need to run data-touching rules offline?** If yes, the PGlite adapter and the structured data requests of Phase 16 option (B) move up. → 16, 19.

### Things to keep in mind

- **N1. `LOG` can't print from inside SQL.** In a compiled region it runs in the database, once per row, with no way back to the host. Phase 15 compiles through it with a warning. Users will still be surprised the first time, so the warning and the docs have to say why.
- **N2. What prints depends on evaluation order.** `A AND LOG(B)` prints nothing when `A` is false, and the same goes for `if`/`switch` branches not taken. Logging observes evaluation; it doesn't force it.
- **N3. stdout is for results.** `minab run --json` is meant to be piped, and anything else on stdout corrupts it. Logs go to stderr, as `--trace` already does.
- **N4. Logging on a server.**
  - Logged values can contain personal data from records.
  - One `LOG` inside a loop can produce a lot of output.
  - A logged value containing a newline can forge a log line, so adapters must escape newlines.
  
  The log cap and "off in production" should be defaults on the server, not options.
- **N5. Every data or host-function call is an `await`.** One correlated rule run per record over 10,000 records is 10,000 round trips (S5).
- **N6. A syntax change breaks stored programs.** Removing `&` would break any rule already stored in a database. Nothing is stored yet, which is one more reason to do Phase 10 first, but the next change won't be so lucky (S2).
- **N7. Bundle weight in the browser.** A page that only validates a form still ships Langium, Chevrotain and the grammar today. Phase 19 measures it (S4).

### Suggestions

- **S1. An "explain" mode for rules, alongside `LOG`.** Most Minab programs are one boolean rule, and the question while debugging is "why false?". An explain run could report every sub-condition's value with no `LOG` written at all, for example: `.end_date > .start_date` → `false` (`2026-10-01` vs `2026-10-05`). Two pieces already exist:
  - the interpreter visits every node;
  - the playground's Execution tab already maps evaluation back to source spans.
  
  For rules this is probably more useful than manual logging; `LOG` stays for functions and queries. It could also become the end-user message for Q4. → 15, or a phase right after it.
- **S2. Run stored programs by id, not by source.** NestJS keeps each program (id, version, source, prepared form). The browser then asks "run rule `booking-overlap` v3 on this record" instead of sending program text. This:
  - closes the "server runs whatever text it's sent" surface (Q1);
  - lets the server cache prepared programs;
  - gives syntax changes a migration path: a `minab migrate` codemod over stored programs, keyed by the language version each one was written for (N6).
  
  → 17–19, 10.
- **S3. Generate the schema rather than writing it.** Read it from Postgres (`information_schema` plus foreign keys), or from Prisma or TypeORM metadata. Minab's relations (`ref`/`collection` with a `foreignKey`) are exactly what a foreign-key scan produces. A `minab schema pull` command would serve the CLI too. → 18.
- **S4. Split "edit" from "run" in the browser.** Editing needs the parser and checker; running a program the server has already checked may not. The server could send a serialized, checked program (S2) for the browser to run with the interpreter alone. Whether this works depends on loading Langium's AST types without its parser, so measure it in Phase 19 before committing. → 16, 19.
- **S5. A batch API, `runMany(program, records)`.** Validating many records against one correlated rule could compile to a single set-based statement (the records passed as one array parameter and `unnest`ed) instead of a round trip per record. Bulk imports in a Nest app would benefit most. → after 18.
- **S6. One event stream instead of separate callbacks.** Trace (statements), logs, timings and progress could be one stream of typed events from the runtime, with one adapter per host: stderr, the playground's tabs, Nest's `Logger`, the wire format. That is simpler than a port per kind. Decide in the ADR. → 16.
- **S7. Step debugging, later.** The interpreter walks the tree, so breakpoints and stepping through the Debug Adapter Protocol in VS Code are feasible for the interpreted parts. Parts running as SQL can't be stepped into. Not before the language is stable. → after 27.

---

## Appendix — coverage map

Every item in [`remaining-after-v0.2.0.md`](remaining-after-v0.2.0.md), and where it lands. If something is missing from this table, it is missing from the plan.

| Inventory section | Item | Phase |
|---|---|---|
| 1 | Publish, tag, release, `.vsix` QA, CHANGELOG limitations | 11 |
| 2.1 | `CAST` no-op; text `+` | 13 |
| 2.1 | `switch`/`is`/JSON literal inside a query | 21 |
| 2.2 | Top-level collection filter; traversed `GROUPBY` | 14 |
| 2.2 | `CITEXT` vs. string literal | 13 |
| 2.3 | Division and `%`; `LIKE` under `CITEXT` | 13 |
| 2.3 | `ORDERBY` on a non-alias | 14 |
| 3 | Loops, blocks, function-body statements, local assignment, `if!`, `.$index`, tuples | 22 |
| 3 | DML, path assignment, transactions, rule-may-write, `--apply` | 23 (port designed in 16) |
| 3 | Multi-key `KEY`; `FROM` over a filtered collection; user `fn` in a query | 21 |
| 3 | Loop and recursion guards | 22 (limits mechanism from 17) |
| 3 | Built-ins beyond the eight | 26 |
| 3 | Non-Postgres dialects | 27 |
| 4.1 | Three unregistered node types | 14 |
| 4.1 | `ref`-to-PK shorthand; Phase 4 judgment calls into the spec | 26 |
| 4.1 | `TypeResult.origin` multi-range (optional polish) | 26 |
| 4.2 | §12 items 1–4, 8, 13, 17 | 26 (item 17 is implemented in Phase 23) |
| 4.3 | Spec examples under test; grammar-block diff; `daysSincePayment` | 26 |
| 4.4 | Remove the `&` call prefix (decided 2026-09-24) | 10 |
| 5.1 | Per-document schema, completion, hover, symbols, LSP test | 24 |
| 5.2 | Manual `.vsix` QA | 11 |
| 5.2 | Extension CI and `.vsix` content guard | 12 |
| 5.2 | Snippets, icon, settings; other editors | 24 |
| 6 | Design, brief open items, deploy, Lighthouse, launch, versioning | 25 |
| 6 | Playground follows the language | 14, 22, 23 (and 25) |
| 7.1 | Postgres CI job, Node 20.10, release workflow, extension build, lint decision | 12 |
| 7.2 | Lockfiles, `.vsix` build from a clean clone | 12 |
| 7.3 | `status.md` rewrite, roadmap pointer, README/CHANGELOG limitations | 11 |
| 7.3 | `.cursor/rules` upkeep | every phase (closing convention) |
| 7.3 | Embedding guide, `exports`/`types`, docs index | 20 |
| 9.1–9.2 | No runtime API; prepare-once; host functions, clock, write port; cancellation, limits, structured errors; concurrency | 16 (design), 17 (build) |
| 9.3 | Browser: two-way port bridge, no SQL from the browser, bundle budget | 16 (decision), 19 |
| 9.4 | NestJS: ESM/CommonJS, ORM adapters and transactions, schema as the security surface | 18 |
| 9.5 | `exports` map, optional peers, consumer smoke tests | 20 |
| 10 | `LOG` and where logs go | 15 (language, CLI, playground); 16–19 (port and adapters) |
