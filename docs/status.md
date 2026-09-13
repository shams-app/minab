# Minab — Status

A running note of where things stand and what to do next. Update the top two sections every session; add a new dated entry to the log at the bottom rather than editing old ones.

## Current status

Repo is bootstrapped and working: Langium grammar (`src/language/minab.langium`) mirrors the spec's §7 reference grammar, parses the spec's own pipeline/validation examples (`test/parsing.test.ts`), and `npm run build && npm test` are green. No semantic services yet — no `ScopeProvider`, no `Validator`, no evaluator. `docs/query-language-spec.md` is the spec; `docs/roadmap.md` has the full phased plan; `.cursor/rules/` carries the same working conventions into Cursor.

Roadmap Phase 0 (reconcile design history) is nearly done. Resolved: the two flagged spec/example inconsistencies (§4.3 clause order; §6.2 `IN`-list syntax, now also documented to accept any collection-valued expression); and the two open design questions — null semantics (equality is null-safe/total, `null == null` is `true`, no SQL three-valued logic; traversal through null propagates rather than errors — spec §9) and read/write scope (Minab supports declarative writes, not read-only — spec §1). Those decisions spun off three residual, still-open items (spec §8, items 8-10): relational-operator null semantics, aggregate-over-null behavior, and the (undesigned) concrete write syntax.

Still open in Phase 0: the five prior constructs (`LET`, loops, `CAST`, `is`/`isnot`, `SELECT DISTINCT`) — Hamed has the original design artifact and is providing it next.

## Next job

**Finish Roadmap Phase 0.** Once the original artifact for the five prior constructs is in hand: fold each one into `docs/query-language-spec.md` and `src/language/minab.langium`, one at a time (confirm still wanted → concrete example → explicit approval → implement), following the spec-governance cycle. After that, Phase 0 is done and Phase 1 (grammar completeness & LL(k) safety pass) is next. See `docs/roadmap.md` Phase 0 for the full task list and definition of done.

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
