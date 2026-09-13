# Minab Implementation Roadmap

Head-to-tail plan from the current state (grammar scaffolded, nothing semantic yet) to a working, documented implementation. Each phase has one job and one defined output, so it can be picked up in a fresh session — Claude, Cursor, or otherwise — without needing prior conversation context. Start each phase by reading `docs/query-language-spec.md` and this file; that's the whole handoff.

## How to use this doc

Every phase lists a **Sign-off** column value:

- **Design** — a language-design decision. Follow the spec-governance cycle (proposal → concrete example → Hamed's explicit approval → implementation) before writing code. This is the expensive kind of work to do with a model that reasons well about tradeoffs — cheap Cursor tokens are a poor place to make these calls alone.
- **Mechanical** — implementation of an already-approved decision. No design judgment required; a checklist. This is exactly the kind of work worth doing in Cursor to save Claude usage.
- **Mixed** — starts as Design (an architecture choice needs to be made) and becomes Mechanical once that choice is written down.

Update the **Status** column as phases complete, and update `docs/query-language-spec.md` / the Cursor rules alongside any phase that changes syntax or project structure — those documents drifting out of sync is worse than not having them.

## Phase overview

| # | Phase | Sign-off | Output |
|---|---|---|---|
| 0 | Reconcile design history | Design | One authoritative spec — no orphaned prior decisions, no unresolved contradictions |
| 1 | Grammar completeness & safety pass | Mixed | Updated `minab.langium`, clean `langium generate`, full example coverage in `test/parsing.test.ts` |
| 2 | Scope resolution (`ScopeProvider`) | Mechanical | Sigils (`.` `^` `@alias` `KEY`) resolve to real declarations; scoping test suite |
| 3 | Semantic validation (`Validator`) | Mixed | Invalid-but-parseable programs rejected with clear diagnostics; validation test suite |
| 4 | Type system | Mixed | A type-checking pass enforcing §3's traversal rules and no-implicit-coercion |
| 5 | Execution strategy + evaluator | Design → Mechanical | An ADR choosing interpret-vs-compile-to-SQL, plus a working evaluator for a real subset |
| 6 | CLI / runner | Mechanical | A `minab` command that runs or compiles a `.minab` file against a data source |
| 7 | IDE tooling (LSP + VS Code) | Mechanical | Live diagnostics, hover, and syntax highlighting in an editor |
| 8 | Documentation & examples | Mechanical | Spec marked "Stable", `examples/` directory, README walkthrough |
| 9 | Packaging / release | Mechanical | Versioned, published package(s); CHANGELOG; tagged release |

---

## Phase 0 — Reconcile design history

**Sign-off: Design.**

Past design conversations (outside this repo) settled on several constructs — `LET`-style variable declarations typed against a `PgSqlType` enum, three loop forms with labeled `break`/`continue`, explicit `CAST(expr AS TypeRef)`, an `is`/`isnot` JSON-shape-testing operator, `SELECT DISTINCT` — plus two open questions (null semantics across `ref` traversal and `LEFT JOIN`; whether Minab is read-only by design). None of this is reflected in the current `docs/query-language-spec.md` or `src/language/minab.langium`, which only contain the pipeline/expression/validation core.

Separately, the smoke-test suite in this repo found two places where the spec's prose/grammar and its own worked examples disagreed (§4.3 clause order; §6.2 `IN`-list syntax) — both resolved 2026-09-13 (see `docs/status.md`), and `IN`'s right-hand side is now documented as accepting any collection-valued expression, not just a list literal.

**Tasks:**
- Walk through the prior design decisions above one at a time. For each: confirm it's still wanted, get a concrete example, get explicit sign-off, and only then fold it into the spec and grammar (this phase can overlap with Phase 1's mechanics, but the decision-making itself is what belongs here). *(Not started — waiting on the original design artifact.)*
- ~~Resolve the two flagged spec/example inconsistencies.~~ Done 2026-09-13.
- ~~Resolve the two open design questions (null semantics; read/write scope).~~ Done 2026-09-13: null equality is null-safe/total and traversal through null propagates (spec §9); Minab supports declarative writes, not read-only (spec §1). Three residual details spun out as new Open Design Questions (spec §8, items 8-10): relational-operator null semantics, aggregate-over-null behavior, and the (undesigned) concrete write syntax.

**Output:** `docs/query-language-spec.md` contains every construct anyone intends to build, and nothing it doesn't; every internal contradiction is either fixed or logged as a deliberate, explained deferral (a short "Deferred Decisions" section in the spec is enough). No implementation work in Phases 1+ should surface a spec question this phase should have caught.

---

## Phase 1 — Grammar completeness & safety pass

**Sign-off: Mixed** (the constructs are Phase 0's decisions; encoding them in Langium syntax and checking they don't collide is mechanical).

**Tasks:**
- Extend `minab.langium` with everything Phase 0 approved.
- Run `npm run langium:generate` after each addition — treat any LL(k)/ambiguity error as blocking, not a warning.
- Grep for keyword collisions between the uppercase (SQL-style) and lowercase (control-flow/JSON) keyword sets after each addition.
- Extend `test/parsing.test.ts` so every construct in the spec — not just the ones that existed at bootstrap — has at least one passing parse example, and every deliberately-invalid example (if any) has a corresponding failing-parse assertion.

**Output:** `npm run build && npm test` green, with the smoke suite's coverage matching the spec 1:1 — if you can point at a syntax box in the spec, there's a test parsing it.

---

## Phase 2 — Scope resolution (`ScopeProvider`)

**Sign-off: Mechanical** (the scoping *rule* is already fully specified in spec §2.2 — this is implementing it, not designing it).

This is the first real custom Langium service, and everything downstream (validation, hover, go-to-definition, the evaluator's variable resolution) depends on it. Minab's sigils resolve against a scope *stack*, not the lexical/AST-parent scoping Langium assumes by default:

- `.` → the innermost active scope's current record.
- `^` → the scope one level below the current one on the stack.
- `@alias` → a named scope, regardless of stack depth.
- `KEY` → the group key, valid only after `GROUP BY`.

**Tasks:**
- Implement a custom `ScopeProvider` (or equivalent Langium 4.x service — confirm the exact extension point against the installed version's types before assuming an API shape) that maintains this stack as it walks `FROM`/`JOIN` sources, `[...]` filters, subqueries, and inline `@Table` scopes.
- Wire it into `minab-module.ts` alongside the existing generated services.
- Write a scoping-specific test suite (separate from the parsing smoke tests) that resolves references in nested filters, correlated subqueries (the `@Booking[... ^...]` pattern from spec §6.1), and multi-level `.field` traversal, and asserts they point at the right declaration/table.

**Output:** cross-references resolve correctly for every scoping example in the spec, backed by tests — not just "it parses," but "`^` in this nested filter actually points at the row that opened it."

---

## Phase 3 — Semantic validation (`Validator`)

**Sign-off: Mixed** (some checks are unambiguous restatements of the spec; a few — like how strict to be about implicit relation traversal, spec §8 open question #7 — are design calls that should go through Phase 0/spec-governance if not already settled there).

**Tasks:**
- Implement a `Validator` catching at minimum: `$` referenced outside a `field` rule; `KEY` referenced outside a `GROUP BY`-scoped clause; `@alias` referencing an undeclared table; a to-many (`collection`) field used where a scalar is required without an aggregate or explicit filter.
- Each check needs a clear, actionable diagnostic message — this is user-facing the moment there's an editor extension (Phase 7).
- Build a validation test suite of deliberately-invalid snippets, one per rule, asserting the specific diagnostic fires.

**Output:** a program that parses cleanly but violates a semantic rule is rejected with a message pointing at the exact problem, for every rule in the checklist above.

---

## Phase 4 — Type system

**Sign-off: Mixed** (the *rules* — no implicit coercion, scalar/ref/collection traversal semantics — are already decided; mapping them onto `PgSqlType` and deciding exact coercion-error wording is closer to Design).

**Tasks:**
- Design (or confirm, if Phase 0 already pinned this down) how `PgSqlType` values map onto Minab's literal and expression types.
- Implement type inference/checking over the expression grammar: literals, sigil types (`.`/`$`/`^`/`@alias`/`KEY`), function return types (aggregates reduce a collection to a scalar; predicates return boolean), and the scalar/ref/collection traversal and broadcast rules from spec §3.
- Enforce no-implicit-coercion as a validator-level or dedicated type-checker error.
- Test both the happy path (correctly-typed programs type-check) and the enforcement path (a coercion that should be rejected, is).

**Output:** every well-typed example in the spec type-checks with no errors; a representative set of ill-typed programs (comparing incompatible types, treating a collection as a scalar without reducing it, etc.) is rejected with a clear message.

---

## Phase 5 — Execution strategy + evaluator

**Sign-off: Design → Mechanical.** This is the biggest undecided architectural question in the whole roadmap and should not be implemented before it's explicitly settled.

The open question: does Minab execute by compiling to SQL against a Postgres-shaped schema (consistent with the `PgSqlType` typing already in the design), by interpreting directly against in-memory or streamed data, or some hybrid (compile the pipeline layer to SQL, interpret validation rules standalone)? This decision affects almost everything downstream, including the CLI (Phase 6).

Two things Phase 0 already settled make this concrete rather than fully open: null semantics are null-safe/total, not SQL's three-valued logic (spec §9) — so a SQL-compiling strategy must translate `==`/`!=` to a null-safe form, not emit `=`/`<>` directly; and Minab supports declarative writes (spec §1), so the ADR needs to account for a write path, not just queries and validation. The concrete write *syntax* is still undesigned (spec §8, item 10) and should probably be settled before or alongside this ADR, since it affects which execution strategies are even viable.

**Tasks:**
- Design the concrete write syntax (spec §8, item 10) — its own proposal/example/approval pass — early enough in this phase to inform the ADR below, since it affects which execution strategies are viable.
- Write a short ADR (architecture decision record — a markdown file under `docs/adr/` is enough) comparing at least "compile pipeline queries to SQL" vs. "interpret against an in-memory record set," covering: how validation rules execute (per-record, likely outside SQL, even if queries compile to SQL); how correlated `@Table` scans perform if interpreted naively; how the null-safe equality from spec §9 gets implemented under each strategy; how declarative writes get executed (a generated trigger/function if compiling to SQL? an explicit write step in an interpreter?).
- Get Hamed's sign-off on the ADR before building anything.
- Implement a minimal but real evaluator/codegen for the chosen strategy, covering at least: a `FROM`/`WHERE`/`SELECT` pipeline, one aggregate `GROUP BY`/`HAVING` example, and one `VALIDATE` rule with a correlated `@Table` check.

**Output:** the ADR, plus a working evaluator (or SQL codegen, tested by diffing generated SQL against hand-written expected SQL for a few fixtures) proven against at least one non-trivial example from each of the pipeline and validation layers — not a toy that only handles the simplest case.

---

## Phase 6 — CLI / runner

**Sign-off: Mechanical.**

**Tasks:**
- Add a `minab` CLI entry point (a `bin` field in `package.json` is the natural place) that takes a `.minab` file and either executes it against a configured data source or prints the compiled output (SQL, if that's what Phase 5 chose).
- Basic error reporting: parse errors, validation errors, and type errors should all produce readable CLI output, not stack traces.
- A short "Usage" section in the README covering the common cases (run a validation rule, run a query, see compiled SQL).

**Output:** `minab run some-query.minab` (or equivalent) works end-to-end against a real or fixture data source, documented well enough that someone other than the implementer can use it from the README alone.

---

## Phase 7 — IDE tooling (LSP + VS Code)

**Sign-off: Mechanical** (Langium is built for exactly this; it's plumbing, not design).

**Tasks:**
- Switch `minab-module.ts` from core-only services to `langium/lsp`'s `createDefaultModule`/`createDefaultSharedModule`, adding the LSP-specific dependencies (`vscode-languageserver`, `vscode-languageserver-textdocument`, `vscode-uri`).
- Add a minimal VS Code extension (langium-cli can scaffold most of this) wiring the language server, syntax highlighting (via the grammar's existing token definitions), and live diagnostics from the Phase 3 validator.
- Verify hover/go-to-definition work for at least `@alias` references, using the Phase 2 scope provider.

**Output:** opening a `.minab` file in VS Code shows syntax highlighting and live diagnostics for the checks built in Phase 3, without needing to run the CLI separately.

---

## Phase 8 — Documentation & examples

**Sign-off: Mechanical.**

**Tasks:**
- Move `docs/query-language-spec.md`'s status from "Draft" to "Stable" once Phases 0-4 are done and there are no known open contradictions.
- Build an `examples/` directory with one realistic `.minab` file per major construct (a multi-join aggregate query, a correlated validation rule, a field rule with a referential-integrity check, etc.), each one covered by a test that it parses, validates, and (if Phase 5/6 are done) executes correctly.
- Update the README with a real walkthrough: install, write a query, run it, read the output.

**Output:** someone unfamiliar with the project can clone the repo, read the README and spec, and successfully write and run their own `.minab` file.

---

## Phase 9 — Packaging / release

**Sign-off: Mechanical.**

**Tasks:**
- Decide what actually gets published (the language server, the CLI, both, as one package or several) and version it.
- Add a CHANGELOG.
- Tag a release once Phase 8's documentation bar is met.

**Output:** an installable, versioned artifact with release notes — the point at which "Minab" stops being only a repo you have to clone and build.

---

## Cross-cutting: keeping Cursor and Claude in sync

Both this roadmap and the `.cursor/rules/` files describe the same conventions from two different angles — this file says *what to build next and in what order*, the rules say *how to work on this codebase regardless of which phase you're in*. When a Design-sign-off decision gets made (in Cursor, in Claude, or in conversation with neither), write it down in the spec and, if it changes working conventions, in the relevant `.cursor/rules/*.mdc` file — otherwise the next session (in either tool) re-derives or re-litigates it from scratch, which is the exact cost this document exists to avoid.
