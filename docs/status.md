# Minab — Status

A running note of where things stand and what to do next. Update the top two sections every session; add a new dated entry to the log at the bottom rather than editing old ones.

## Current status

Roadmap Phase 0 (reconcile design history) and Phase 1 (grammar completeness & safety pass) are both done. Hamed supplied the complete v2 language design as two documents added to the Claude Project — `query-language-spec.md` (12 sections, `#alias` sigil, full type system, functions, `if`/`if!`/`switch`, loops, `INSERT`/`UPDATE`/`DELETE`) and `docs/showcase.md` (14 sections of runnable examples) — replacing the old pipeline-only spec wholesale, not just adding the five originally-flagged constructs.

Both are now in the repo as the authoritative spec/grammar/example set. `npm run langium:generate` and `npm run build` are clean; `npm test` is 49/49 green, rebuilt directly from `docs/showcase.md`'s own sections. Three genuine defects were found and fixed along the way (see the session log below for the full detail): a clause-order regression in the showcase's grouping example, a missing `vivify` flag on `CurrentRecord` (so `.doctor!.id = 21;` didn't parse), and a misuse of `isnot` as general inequality where `!=` was meant. No semantic services yet — no `ScopeProvider`, no `Validator`, no evaluator.

`docs/query-language-spec.md` is the spec; `docs/showcase.md` is the synced example corpus; `docs/roadmap.md` has the full phased plan (updated to match); `.cursor/rules/` carries the same working conventions into Cursor (**not yet updated** for the new sigil/keywords/DML — see Next job).

## Next job

**Update `.cursor/rules/*.mdc` for the new syntax**, then start **Roadmap Phase 2 — Scope resolution (`ScopeProvider`)**. The Cursor rules still describe the old `@alias` sigil, two-token `GROUP BY`/`LEFT JOIN`, the `field`/`VALIDATE` wrapper keywords (now just bare `.`/`$` expressions), and old section numbers — anyone picking this up in Cursor needs those fixed first or they'll write invalid syntax. After that, Phase 2 implements the `.`/`^`/`#alias`/`KEY` scope-stack resolution described in spec §2.2 — see `docs/roadmap.md` Phase 2 for the full task list and definition of done.

## Session log

### 2026-09-13

- Bootstrapped the Minab repo from scratch: git init, Langium project scaffold (`package.json`, `tsconfig.json`, `langium-config.json`), grammar transcribed from spec §7, minimal `minab-module.ts` wired to Langium's core (non-LSP) services, vitest smoke suite parsing the spec's worked examples.
- Copied `docs/query-language-spec.md` into the repo.
- Found and documented (didn't silently fix) two inconsistencies between the spec's prose/grammar and its own examples — §4.3 clause order, §6.2 `IN`-list syntax.
- Repo written to `/Users/hamcker/sources/minab` (a connected folder on Hamed's machine) at his request, since the cloud sandbox it was built in doesn't persist. Verified `npm install && npm run build && npm test` there too.
- Hamed separately renamed the npm package to `@shamsine/minab` directly on his machine (commit `7401224`).
- Added `.cursor/rules/*.mdc` (project overview, Langium workflow, spec-governance approval cycle) so Cursor sessions on this repo follow the same conventions.
- Added `docs/roadmap.md`: 10 phases from reconciling design history to a released implementation, each with a defined output and a Design/Mechanical/Mixed sign-off marker.
- Commits: `04d720e` (bootstrap), `138d8c5` (Cursor rules + roadmap).

### 2026-09-13 (continued)

- Resolved both flagged spec/example inconsistencies with Hamed's sign-off: §4.3's grouped-query example now has `HAVING` before `SELECT` (matches §4.1/§7); §6.2's `IN` example uses `[...]`. Also documented (per his direction) that `IN`'s right-hand side accepts any collection-valued expression — a collection field (`$ IN .allowed_statuses`) or a cross-table field via `@Table` (`$ IN @CategoryConfig.valid_categories`) — no grammar change needed, since `IN`'s right operand was already an unrestricted `Additive` expression; this was a spec-clarity fix only. Added test coverage for both new examples (8/8 passing).
- Updated `.cursor/rules/spec-governance.mdc` and `docs/roadmap.md` Phase 0 to reflect the resolution.
- Started working through the two open design questions (null semantics, read/write scope) — see next entry once decided.
- Hamed has the original design artifact for the five unmerged constructs (`LET`, loops, `CAST`, `is`/`isnot`, `SELECT DISTINCT`) and is providing it next.

### 2026-09-13 (continued, part 2)

- Worked through both open design questions with Hamed:
  - **Null semantics:** `==`/`!=` are null-safe and total (`null == null` → `true`; no SQL-style `UNKNOWN`/three-valued logic). Traversal through a null value (e.g. `.customer.country` when `.customer` is null) propagates `null` rather than erroring. Documented as new spec §9. Three residual details spun out as new Open Design Questions (spec §8, items 8-10): null semantics for relational operators (`<`/`<=`/`>`/`>=`), aggregate behavior over a null-instead-of-collection, and the concrete write syntax below.
  - **Read/write scope:** Minab is *not* read-only — it will support declarative writes (trigger-/generated-column-like: what gets persisted when a rule fires or a value is computed). No concrete syntax for this exists yet; it's tracked as its own design task (spec §8 item 10) that needs to happen before/alongside roadmap Phase 5's execution-strategy ADR, since it affects which execution strategies are viable.
- Updated `docs/roadmap.md` Phase 0 (marked decided) and Phase 5 (folded in the write-path and null-safety implications for the ADR).
- Synced `docs/query-language-spec.md` to the Claude Project doc (`query-language-spec.md`) so both copies match.
- Still waiting on Hamed's original design artifact for the five unmerged constructs before Phase 0 can close out.

### 2026-09-13 (continued, part 3 — the v2 spec lands)

- Hamed added the promised artifact to the Claude Project — but it turned out to be a complete 12-section rewrite of the entire spec, not just the five flagged constructs: new `#alias` sigil (replacing `@alias`), compound keywords (`GROUPBY`/`ORDERBY`/`LEFTJOIN`/`CROSSJOIN`), a full type system (§7.2: `TEXT`/`CITEXT`/`INTEGER`/`DECIMAL`/`BOOLEAN`/`DATE`/`TIME`/`DATETIME`/`UUID`/`JSON`, each independently nullable and arrayable), tuples, JSON literals with shorthand properties, `is`/`isnot` shape-testing, `CAST`, user functions (`fn`/`&name(...)`, implicitly async, closures, recursion), `if`/`else` as an expression vs. `if!` as a statement, `switch`, three loop forms with labeled `break`/`continue`, assignment operators including path-based vivification (`!`), and concrete `INSERT`/`UPDATE`/`DELETE` DML with compound `SET` operators — plus a companion `docs/showcase.md` (14 sections of runnable examples kept in sync with the spec).
- Treated this as the real Phase 1 pass rather than accepting it blind: replaced `src/language/minab.langium` and `docs/query-language-spec.md` wholesale, added `docs/showcase.md`, ran `npm run langium:generate` (clean, one expected Chevrotain ambiguity warning in `Postfix` — spec §12 item 4, not a build error) and `npm run build` (clean), then rebuilt `test/parsing.test.ts` from scratch — one `describe` block per showcase section, 49 tests total, including a block confirming that constructs the showcase flags as *semantic* errors still parse cleanly.
- Found and fixed three real defects during this empirical pass (each confirmed with Hamed before touching anything, per spec-governance):
  1. §5's grouping example wrote `SELECT` before `HAVING`, contradicting the §11 grammar's required order (the same clause-order question resolved earlier in this log, regressed by the new artifact). **Fixed the showcase example** to put `HAVING` before `SELECT`.
  2. `.doctor!.id = 21;` (a headline §9.3 vivify example) didn't parse — `CurrentRecord`'s grammar rule had no `vivify` flag, only `MemberAccess` (later `.field` steps) did. **Fixed the grammar**: added `vivify?='!'?` to `CurrentRecord` too, in both `src/language/minab.langium` and the spec's embedded §11 grammar block.
  3. The §14 combined example wrote `newStatus isnot "ok"` — but `is`/`isnot` are strictly JSON-shape-testing operators (§5.6: right-hand side must be `null`/`array`/`object`/`string`/`number`/`boolean`, not an arbitrary value), so a string literal there is invalid. This wasn't ambiguous — the spec's own §5.6 settles it — so it was a plain typo fix to `!=` in the showcase example and the test suite, no design question needed.
- Updated `docs/roadmap.md`: rewrote Phase 0 and Phase 1 to reflect what actually shipped and was found, and fixed stale terminology throughout later phases (`@alias`→`#alias`, `GROUP BY`→`GROUPBY`, `PgSqlType`→the new type system, the now-resolved write-syntax task, an outdated open-question reference).
- **Not yet done:** syncing the finalized spec/showcase back to the Claude Project (there are currently two `query-language-spec.md` docs there — one stale, one superseded by the repo copy — needs cleanup), and updating `.cursor/rules/*.mdc` for the new sigil/keywords/DML. Both are the top of the next job list.
