# Minab — Status

A running note of where things stand and what to do next. Update the top two sections every session; add a new dated entry to the log at the bottom rather than editing old ones.

## Current status

Repo is bootstrapped and working: Langium grammar (`src/language/minab.langium`) mirrors the spec's §7 reference grammar, parses the spec's own pipeline/validation examples (`test/parsing.test.ts`), and `npm run build && npm test` are green. No semantic services yet — no `ScopeProvider`, no `Validator`, no evaluator. `docs/query-language-spec.md` is the spec; `docs/roadmap.md` has the full phased plan; `.cursor/rules/` carries the same working conventions into Cursor.

The spec in this repo is narrower than some earlier (pre-repo) design discussion: `LET` variable declarations, loop forms, `CAST`, `is`/`isnot`, and `SELECT DISTINCT` were reportedly settled in an earlier conversation but never made it into `docs/query-language-spec.md` or the grammar here. That reconciliation hasn't happened yet.

## Next job

**Roadmap Phase 0 — Reconcile design history.** Before any more grammar work: go through the previously-discussed-but-unmerged constructs above one at a time (confirm still wanted → concrete example → explicit approval → fold into spec + grammar), and resolve or explicitly defer the two flagged spec/example inconsistencies (§4.3 clause order, §6.2 `IN`-list syntax) and the two open design questions (null semantics, read/write scope). See `docs/roadmap.md` Phase 0 for the full task list and definition of done.

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
