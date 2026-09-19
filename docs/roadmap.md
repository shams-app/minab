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
| 2 | Scope resolution (`ScopeProvider`) | Mechanical | Sigils (`.` `^` `#alias` `KEY`) resolve to real declarations; scoping test suite |
| 3 | Semantic validation (`Validator`) | Mixed | Invalid-but-parseable programs rejected with clear diagnostics; validation test suite |
| 4 | Type system | Mixed | A type-checking pass enforcing §3's traversal rules and no-implicit-coercion |
| 5 | Execution strategy + evaluator | Design → Mechanical | An ADR choosing interpret-vs-compile-to-SQL, plus a working evaluator for a real subset |
| 6 | CLI / runner | Mechanical | **Done** — `minab run`/`compile`/`check`, against a fixture or a real PostgreSQL |
| 7 | IDE tooling (LSP + VS Code) | Mechanical | Live diagnostics, hover, and syntax highlighting in an editor |
| 8 | Documentation & examples | Mechanical | **Done** — spec marked "Stable", `examples/` directory, README walkthrough |
| 9 | Packaging / release | Mechanical | Versioned, published package(s); CHANGELOG; tagged release |

---

## Phase 0 — Reconcile design history

**Sign-off: Design.**

**Status: Done (2026-09-13).**

The full backlog of prior design decisions has now landed. Hamed supplied the complete, already-negotiated v2 language design as two documents (`query-language-spec.md`, 12 sections, and a matching `docs/showcase.md` of runnable examples) — far broader than the five originally-flagged constructs (`LET`, loops, `CAST`, `is`/`isnot`, `SELECT DISTINCT`): it also replaced the `@alias` sigil with `#alias`, made `GROUPBY`/`ORDERBY`/`LEFTJOIN`/`CROSSJOIN` single compound keywords, added a full type system (§7.2), user functions (§8), `if`/`if!`/`switch` control flow (§9), and concrete `INSERT`/`UPDATE`/`DELETE` DML (§10) — resolving Phase 5's previously-open "concrete write syntax" task as a side effect.

Rather than accept it as a finished artifact, it was integrated as real Phase 1 work: replaced `src/language/minab.langium` and `docs/query-language-spec.md` wholesale, ran it through `langium generate` and `tsc -b` for real, and rebuilt `test/parsing.test.ts` from `docs/showcase.md`'s own 14 sections (49 tests). That surfaced three genuine defects the artifact itself hadn't caught — see Phase 1 below for what they were and how each was resolved.

**Output:** `docs/query-language-spec.md` (12 sections) and `src/language/minab.langium` are the single authoritative pair; `docs/showcase.md` is a synced example corpus; no orphaned prior decisions remain. Of the eighteen items logged in spec §12, several were resolved in later phases; the rest are deliberate deferrals, not oversights, and should go through the same proposal → example → approval cycle whenever picked up.

---

## Phase 1 — Grammar completeness & safety pass

**Sign-off: Mixed** (the constructs are Phase 0's decisions; encoding them in Langium syntax and checking they don't collide is mechanical).

**Status: Done (2026-09-13)** for the grammar that exists; revisit whenever spec §12's open items get resolved and add new constructs.

`npm run langium:generate` and `npm run build` are clean (one Chevrotain "ambiguous alternatives" warning in the `Postfix` rule — `TupleAccess`'s `[NUMBER]` vs. `FilterAccess`'s `[Expression]`, since a bare number is also a valid expression — expected and already tracked as spec §12 item 4, not a build error). `npm test` is 49/49 green, with coverage built directly from `docs/showcase.md`'s 14 sections (one `describe` block each), plus a block asserting that constructs the showcase flags as *semantic* errors (e.g. `let age: INTEGER = null;`) still parse cleanly — that distinction only becomes checkable once Phase 3's `Validator` exists.

Three real defects surfaced during this pass — exactly the kind of empirical verification spec §12 item 18 called for, though not the specific risk it named (that one — `AssignmentStatement`'s target sharing a leading token with a block's tail — turned out fine; Langium's generator reported no conflict there, and it's covered by dedicated tests):

1. **Clause-order regression.** `docs/showcase.md` §5 wrote `SELECT` before `HAVING`; the §11 grammar (correctly, matching the same decision Hamed already made once for this exact question, back when it first came up in the pipeline-only spec) requires `HAVING` before `SELECT`. Fixed the showcase example, not the grammar — Hamed's call.
2. **Vivify gap on the first path segment.** `CurrentRecord`'s grammar rule (`'.' (field=ID)?`) had no `vivify` flag, so `.doctor!.id = 21;` — a headline §9.3 example — didn't actually parse; only `MemberAccess` (later `.field` steps) had `vivify?='!'?`. Fixed by adding the same flag to `CurrentRecord` — Hamed's call; re-verified against the full suite afterward.
3. **`isnot` misused as general inequality.** `docs/showcase.md`'s §14 combined example wrote `newStatus isnot "ok"` — but §5.6/§11 define `is`/`isnot` strictly for JSON-shape testing (`test=JsonKind`: `null`/`array`/`object`/`string`/`number`/`boolean`), not arbitrary-value comparison; a string literal isn't a legal right-hand operand. This wasn't a grammar bug or an open design question — the spec's own §5.6 is unambiguous — so it was a one-line example fix to `!=`, the operator actually meant.

**Output:** `npm run build && npm test` green (confirmed 2026-09-13), 1:1 test coverage against every construct in `docs/showcase.md`.

---

## Phase 2 — Scope resolution (`ScopeProvider`)

**Sign-off: Mechanical** (the scoping *rule* is already fully specified in spec §2.2 — this is implementing it, not designing it).

**Status: Done (2026-09-14).**

This is the first real custom Langium service, and everything downstream (validation, hover, go-to-definition, the evaluator's variable resolution) depends on it. Minab's sigils resolve against a scope *stack*, not the lexical/AST-parent scoping Langium assumes by default:

- `.` → the innermost active scope's current record.
- `^` → the scope one level below the current one on the stack.
- `#alias` → a named scope, regardless of stack depth.
- `KEY` → the group key, valid only after `GROUPBY`.

**A finding that reshaped this phase:** `minab.langium` has zero Langium cross-references (`[Type:ID]`) anywhere — table names, join aliases, `#alias` names are all plain `ID`/string fields — and there are no in-file table/column declarations at all. This is by design, confirmed with Hamed: Minab is embedded in a larger web application (edited in-browser, inside Monaco), and table names, column names, and built-in function signatures are supplied by that host at runtime, not declared in `.minab` source. So a real Langium `ScopeProvider`/Linker (which only fires on `Reference<T>` grammar fields) has nothing to hook into. The implementation below is a standalone resolution service instead, with an explicit host-schema contract as its input — not a grammar change.

**What was built:**
- `src/language/schema.ts` — the host-schema contract (`MinabSchema`/`SchemaProvider`): tables with columns, and built-in function signatures. A first cut, expected to grow once Phase 4 needs richer types/relations.
- `src/language/minab-scope-resolver.ts` (`MinabScopeResolver`) — walks a sigil node's AST ancestor chain to reconstruct the §2.2 scope stack (pushed by a `Query`'s clauses, a `[...]` filter's condition, a `for-in` loop's body/guard — never by their own source/receiver/iterable) and resolves `.`/`^`/`#alias`/`KEY`/bare `NameRef` against it, falling back to the `SchemaProvider` for table names not backed by an in-file alias. Resolution is deliberately bounded to one hop of column access off a statically-known table; a multi-hop chain (`.customer.country`) fails explicitly with a "needs the Phase 4 type system" reason rather than guessing. Reporting an unresolved sigil as a diagnostic is Phase 3's job, not this one's — this phase only answers "what does this refer to here?"
- Wired into `minab-module.ts` as `schema`/`scopeResolver` services; `createMinabServices` now takes an optional `MinabSchema` parameter (defaults to empty for callers, like the parsing suite, that don't need it).
- `test/scoping.test.ts` (12 tests) — covers a plain `.field` in a `FROM` query, the §6.1 correlated `#Booking[. != ^ ...]` pattern (confirming `^` escapes the filter to the implicit "record under validation," not to `#Booking` itself), the showcase's §14 nested-filter-inside-loop disambiguation (bare `.` vs. the loop's own alias vs. `^` — all landing on the frames the showcase's own commentary describes), `KEY` valid only after `GROUPBY`, and unresolved `#alias`/columns coming back as `{found: false}` rather than throwing.

**Output:** cross-references resolve correctly for every scoping example in the spec, backed by tests — not just "it parses," but "`^` in this nested filter actually points at the row that opened it."

---

## Phase 3 — Semantic validation (`Validator`) — Done (2026-09-16)

**Sign-off: Mixed** (most checks are unambiguous restatements of the spec; the one design call this touches — how strict to be about implicit relation traversal — is already settled: spec §12 item 7 resolved the collection-traversal boundary at §3.4, so this phase just implements it).

**Tasks:**
- Implement a `Validator` catching at minimum: `$` referenced outside a `field` rule; `KEY` referenced outside a `GROUPBY`-scoped clause; `#alias` referencing an undeclared table; a to-many (`collection`) field used where a scalar is required without an aggregate or explicit filter.
- Each check needs a clear, actionable diagnostic message — this is user-facing the moment there's an editor extension (Phase 7).
- Build a validation test suite of deliberately-invalid snippets, one per rule, asserting the specific diagnostic fires.

**Output:** a program that parses cleanly but violates a semantic rule is rejected with a message pointing at the exact problem, for every rule in the checklist above.

**What actually shipped:** 3 of the 4 checks, decided with Hamed:
- `$` (`FieldValue`): the spec (§6.2, line 374) says any `$` usage makes the whole program "implicitly a field-level rule" — there's no AST marker for "inside vs. outside" a field rule, since a Minab program has exactly one top-level statement. Per Hamed, `$` is valid *anywhere* in the program (any nesting) as long as the host says up front this program is a field rule — so this became host-supplied context (`schema.ts`'s `MinabRuleContext`/`isFieldRule`), threaded through `createMinabServices` exactly like `MinabSchema` already is, not something derived from the AST.
- `KEY` (`GroupKeyRef`) outside `GROUPBY`, and `#alias` (`NamedScope`) referencing an undeclared table: thin wrappers around `MinabScopeResolver.resolveGroupKeyRef`/`resolveNamedScope` (Phase 2) — their existing `reason` strings are used as the diagnostic messages verbatim.
- **The 4th check (collection-vs-scalar) is deferred to Phase 4, not implemented here.** `schema.ts`'s `MinabColumnSchema.type` is still a free-form display string with no structured collection flag; per Hamed, building a throwaway representation just for this check isn't worth it when Phase 4 replaces the whole column-type representation anyway. Phase 4's task list below should pick this check up once a real type system exists to support it.

Implementation: `src/language/minab-validator.ts` (`MinabValidator` + `registerValidationChecks`, wired from `createMinabServices`), `test/validation.test.ts` (7 tests, using Langium's `validationHelper` test helper — first use of the validation pipeline in this repo).

---

## Phase 4 — Type system — Done (2026-09-17)

**Sign-off: Mixed** (the *rules* — no implicit coercion, scalar/ref/collection traversal semantics — are already decided; mapping them onto the type system's logical types (§7.2) and deciding exact coercion-error wording is closer to Design).

**Tasks:**
- Design (or confirm, if Phase 0 already pinned this down) how the type system's logical types (§7.2) map onto Minab's literal and expression types.
- Implement type inference/checking over the expression grammar: literals, sigil types (`.`/`$`/`^`/`#alias`/`KEY`), function return types (aggregates reduce a collection to a scalar; predicates return boolean), and the scalar/ref/collection traversal and broadcast rules from spec §3.
- Enforce no-implicit-coercion as a validator-level or dedicated type-checker error.
- Test both the happy path (correctly-typed programs type-check) and the enforcement path (a coercion that should be rejected, is).
- Pick up the Phase 3 check deferred here: a to-many (`collection`) field used where a scalar is required without an aggregate or predicate-over-filter (spec §3.4). Needs `schema.ts`'s `MinabColumnSchema.type` replaced by this phase's real type representation first — see Phase 3's "what actually shipped" note.

**Output:** every well-typed example in the spec type-checks with no errors; a representative set of ill-typed programs (comparing incompatible types, treating a collection as a scalar without reducing it, etc.) is rejected with a clear message.

**What actually shipped:**

Two roadmap-blocking open design questions (spec §12 items 10 and 11) were resolved with Hamed before implementation, per the usual spec-governance cycle:
- **Item 10 (built-in vs. user-function disambiguation):** a closed set of 8 built-in names (`SUM`/`COUNT`/`AVG`/`MIN`/`MAX`/`EXISTS`/`ALL`/`ANY`) may only be called bare; any other bare call is an error pointing at `&name(...)`; the 8 names are reserved and can't be used for a user `fn`. Written up in spec §5.3/§5.3.1 (including a formal signature table — none existed before).
- **Item 11 (query-tailed function return type):** a function whose tail is a `Query` always returns `JSON` — an array of the selected shape (`SELECT *` → array of objects; `SELECT <col>` → array of that column's type). Its declared return type must be `JSON`, checked once at the `FunctionDecl`. Written up in spec §8.6.

Implementation: `src/language/minab-types.ts` (the structured `MinabType` representation — `scalar`/`tuple`/`record`/`collection`/`null` — replacing `schema.ts`'s free-form column-type string), `src/language/minab-builtins.ts` (the 8 built-in signatures), `src/language/minab-type-checker.ts` (`MinabTypeChecker.inferType`, following the same `{ok,reason}` pattern Phase 2's `ScopeResolution` established), and a matching expansion of `src/language/minab-validator.ts`'s check set (coercion, the §3.4 boundary, §7.7 null-operand rules, unknown-function calls, the two `FunctionDecl` rules above). `test/typechecking.test.ts` (39 tests) plus updated fixtures in `test/validation.test.ts`/`test/scoping.test.ts` for the new structured schema shape. `npm run build && npm test`: 107/107 green.

Two findings along the way, each handled the same "confirm scope, fix, document" way Phase 1's empirical pass did:
- **A design gap, not in the original task list:** a top-level validation rule (spec §6 — the language's primary use case) has no statically-known table under Phase 2's scope resolver (deliberately — nothing in Minab source names it), so `.field` at the top level of *every* record-/field-level rule would have been untypeable. Fixed by extending the host-supplied `MinabRuleContext` (already home to `isFieldRule`) with `recordTable`/`fieldType`, mirroring the existing pattern rather than inventing a new one.
- **A real defect surfaced empirically, same category as Phase 1's:** three worked examples (spec §4.2's join-condition example, and both `cancelledOrdersFor`-style query-tailed-function examples in §8.2/§8.6, mirrored in `docs/showcase.md` §10 and §6) compared a `ref` field directly against a scalar (`.customer == customerId`) — under the traversal rule (§3.1), `.customer` is the *related record*, not its key, so this is a genuine type mismatch. Fixed all four occurrences to `.customer.id == customerId` (or the join equivalent). A `ref`-to-primary-key comparison shorthand might be a real feature worth having, but it would need a primary-key marker in the schema contract that doesn't exist — flagged as a separate, unimplemented design question rather than added unilaterally.

Two narrower implementation judgment calls, documented in code comments and worth Hamed's attention if they turn out wrong: `INTEGER`/`DECIMAL` are treated as one numeric family, freely inter-comparable without `CAST` (spec §5.5's literal wording is stricter, but applying it literally to bare numeric literals rejected most of the existing showcase corpus); and a query used as a scalar value (a `let` initializer, a comparison operand) infers as its single `SELECT` column's type unconditionally, rather than requiring `LIMIT 1` — with `IN (subquery)` specifically special-cased as the one place a query is read as a set instead.

---

## Phase 5 — Execution strategy + evaluator

**Sign-off: Design → Mechanical.** This is the biggest undecided architectural question in the whole roadmap and should not be implemented before it's explicitly settled.

**Status: Done (2026-09-17).** ADR written, signed off, and implemented — see "What actually shipped" below.

The open question: does Minab execute by compiling to SQL against a Postgres-shaped schema (consistent with the logical type system already in the design (§7.2)), by interpreting directly against in-memory or streamed data, or some hybrid (compile the pipeline layer to SQL, interpret validation rules standalone)? This decision affects almost everything downstream, including the CLI (Phase 6).

Two things Phase 0 already settled make this concrete rather than fully open: null semantics are null-safe/total, not SQL's three-valued logic (spec §9) — so a SQL-compiling strategy must translate `==`/`!=` to a null-safe form, not emit `=`/`<>` directly; and Minab supports declarative writes (spec §1), so the ADR needs to account for a write path, not just queries and validation. The concrete write syntax is now settled (spec §10 — `INSERT`/`UPDATE`/`DELETE`), so this ADR only needs to account for executing it, not design it.

**Tasks:**
- Write a short ADR (architecture decision record — a markdown file under `docs/adr/` is enough) comparing at least "compile pipeline queries to SQL" vs. "interpret against an in-memory record set," covering: how validation rules execute (per-record, likely outside SQL, even if queries compile to SQL); how correlated `#Table` scans perform if interpreted naively; how the null-safe equality from spec §9 gets implemented under each strategy; how declarative writes get executed (a generated trigger/function if compiling to SQL? an explicit write step in an interpreter?).
- Get Hamed's sign-off on the ADR before building anything.
- Implement a minimal but real evaluator/codegen for the chosen strategy, covering at least: a `FROM`/`WHERE`/`SELECT` pipeline, one aggregate `GROUPBY`/`HAVING` example, and one record-level validation rule with a correlated `#Table` check.

**Output:** the ADR, plus a working evaluator (or SQL codegen, tested by diffing generated SQL against hand-written expected SQL for a few fixtures) proven against at least one non-trivial example from each of the pipeline and validation layers — not a toy that only handles the simplest case.

**What actually shipped:**

`docs/adr/0001-execution-strategy.md` compares all three options and chooses the **hybrid**: pure SQL compilation was rejected because arbitrary recursion, closures, and implicitly-async `fn`s (§8) don't reduce to one SQL statement without a PL/pgSQL-codegen project nobody has scoped; pure interpretation was rejected as the *sole* strategy because it turns this phase's own flagged risk — a correlated `#Table` scan like §6.1's booking-overlap check — into an unconditional full-table fetch on every validated record.

- `src/language/minab-sql-compiler.ts` (`MinabSqlCompiler`) — compiles the relational layer: the full `Query` pipeline (joins, `GROUPBY`/`HAVING`, `DISTINCT`, `ORDERBY` by select alias, `LIMIT`/`OFFSET`), ad-hoc `#Table` scopes, relation traversal, and the built-in aggregates/predicates over either. Emits parameterized SQL. Refusing to compile is load-bearing, not a gap: `{ok:false, reason}` for `&fn`/`if`/`switch`/loops is how the interpreter knows to take a node itself.
- `src/language/minab-interpreter.ts` (`MinabInterpreter`) — evaluates everything else against the record the host already holds, pushing the *smallest* subexpression that actually needs table data down to the compiler (deliberately not the largest compilable one: pushing `COUNT(.orders) < 5` down whole would leave SQL comparing two untyped placeholders). Async throughout, since every `fn` is implicitly async.
- `src/language/minab-executor.ts` — `QueryExecutor`/`SqlQuery`, the host connection contract, in the same "the host supplies what Minab source can't say" shape as `SchemaProvider`.
- `src/language/schema.ts` — `foreignKey` on `ref`/`collection` columns and `primaryKey` on a table. Both optional, both genuinely required to *execute* a traversal (Phases 2-4 only needed the target table, never the join key); a relation missing one fails with an explicit reason instead of guessing a naming convention. This closes the primary-key gap Phase 4 flagged.
- `test/sql-compilation.test.ts` (18 tests) — generated SQL diffed against hand-written expected SQL, per this phase's Output. `test/evaluation.test.ts` (18 tests) — the §6.1 rule end to end against a recording executor, asserting the *strategy* (one parameterized `EXISTS`, no scan; the local half never reaching the database at all) and not just the answer.

Two spec rules drove most of the non-obvious codegen, and both are covered by their own tests: `==`/`!=` compile to `IS NOT DISTINCT FROM`/`IS DISTINCT FROM`, never `=`/`<>` (§7.7's total equality), while join predicates the *compiler itself* synthesizes stay plain `=` so a null FK matches nothing; and `ref` traversal compiles to a correlated scalar subquery rather than a join, so a null FK yields `null` (§7.7 rule 1) instead of dropping the row.

Deliberately left for the next increment, each failing with an explicit reason rather than a wrong answer: loops (§9.4), `INSERT`/`UPDATE`/`DELETE` *execution* (§10 — the ADR settles how they execute; building it is separate), and `.$index` (§3.5).

---

## Phase 6 — CLI / runner — Done (2026-09-17)

**Sign-off: Mechanical.**

**Tasks:**
- Add a `minab` CLI entry point (a `bin` field in `package.json` is the natural place) that takes a `.minab` file and either executes it against a configured data source or prints the compiled output (SQL, if that's what Phase 5 chose).
- Basic error reporting: parse errors, validation errors, and type errors should all produce readable CLI output, not stack traces.
- A short "Usage" section in the README covering the common cases (run a validation rule, run a query, see compiled SQL).

**Output:** `minab run some-query.minab` (or equivalent) works end-to-end against a real or fixture data source, documented well enough that someone other than the implementer can use it from the README alone.

**What actually shipped:**

`src/cli/` — three commands over the services Phases 1-5 already built, adding no language behavior of its own: `check` (parse + validate + type-check), `compile` (print the SQL, run nothing), `run` (evaluate, printing rows as a table and a rule's answer as a value). `bin` in `package.json` points at the built `out/src/cli/bin.js`; `runCli(argv, io)` in `src/cli/main.ts` takes its argv and output sinks as parameters so the suite drives whole commands in-process.

- `src/cli/config.ts` — `minab.config.json`, the stand-in for the host: schema, rule context, the record under validation, canned data, a connection string. Found by walking up from the `.minab` file's own directory, so a config lives with the programs it describes. Columns take a shorthand (`"TEXT?"`, `"INTEGER[]"`, `{"ref": "Customer", "foreignKey": "customer_id"}`) rather than the nested internal `MinabSchema` shape, and every rejection names the JSON path that caused it.
- `src/cli/executors.ts` — two `QueryExecutor`s: canned responses from the config (running out of them is an error that prints the unanswered statement, not a silent empty result), and PostgreSQL through a dynamically-imported `pg` that is deliberately *not* a dependency of this package.
- `src/cli/diagnostics.ts` — `file:line:col`, the source line, a caret under the offending span. Lexer, parser, and validator diagnostics all arrive through the same Langium channel, so all three satisfy this phase's "readable output, not stack traces" task by one path.
- `examples/` — the two programs the README walks through (the §6.1 correlated rule and the §4.3 grouped query) plus their config. (Reorganised in Phase 8 into one directory per example.)
- `test/cli.test.ts` (32 tests) — asserts on what a user sees: exit codes, messages, the caret, the table. `test/postgres.test.ts` (6 tests, opt-in via `MINAB_TEST_DATABASE_URL`) — **executes** the compiled SQL against a real server, which is new: until now the compiler had only ever been diffed against hand-written expected SQL.

Three things surfaced by running the thing, each fixed rather than noted:

- **A crash on a partial AST.** `MinabTypeChecker.inferType` assumed every child node exists, so a file with a syntax error (`.a >> .b` leaves a `BinaryExpression` with no `right`) produced a `TypeError` and a stack trace instead of a diagnostic. Guarded in `minab-type-checker.ts`; it would have hit the Phase 7 language server on every keystroke mid-expression.
- **A 2.8-second startup.** Langium's `development` mode (what `langium generate` writes into `generated/module.ts`) has Chevrotain re-validate the whole grammar on every parser construction — measured at ~2.8s against this grammar, versus ~80ms in `production`. `createMinabServices` gained a `MinabServiceOptions` parameter and the CLI asks for `production`; the test suite stays on `development`, where the ambiguity warnings that mode exists to produce are actually wanted. CLI startup is now ~0.25s.
- **Duplicate diagnostics.** `MinabValidator` registers its type checks on every expression node, so one mistake is reported again by each enclosing node that re-infers it — the same message over a widening range. The CLI keeps the innermost, which is the one pointing at the mistake. This is presentation only; the underlying re-reporting is untouched and would be worth a look when Phase 7 puts the same diagnostics in an editor.

---

## Phase 7 — IDE tooling (LSP + VS Code) — Done (2026-09-18)

**Sign-off: Mechanical** (Langium is built for exactly this; it's plumbing, not design).

**Tasks:**
- Switch `minab-module.ts` from core-only services to `langium/lsp`'s `createDefaultModule`/`createDefaultSharedModule`, adding the LSP-specific dependencies (`vscode-languageserver`, `vscode-languageserver-textdocument`, `vscode-uri`).
- Add a minimal VS Code extension (langium-cli can scaffold most of this) wiring the language server, syntax highlighting (via the grammar's existing token definitions), and live diagnostics from the Phase 3 validator.
- Verify hover/go-to-definition work for at least `#alias` references, using the Phase 2 scope provider.

**Output:** opening a `.minab` file in VS Code shows syntax highlighting and live diagnostics for the checks built in Phase 3, without needing to run the CLI separately.

**What actually shipped:**

- `src/language/minab-module.ts` — switched to `langium/lsp`'s `createDefaultModule`/`createDefaultSharedModule`; `MinabServices` is now `LangiumServices & MinabAddedServices` (was `LangiumCoreServices`). `createMinabServices`'s signature is unchanged in practice — `DefaultSharedModuleContext` is a superset of the old `DefaultSharedCoreModuleContext` (an optional `connection`), so every existing call site (the CLI, every test file) kept working with no changes.
- `src/language/main.ts` (new) — the language server entry point: `createConnection` over stdio, one `MinabSchema`/`MinabRuleContext` for the whole process discovered from `minab.config.json` (reusing `src/cli/config.ts`'s `discoverConfig`, now exported), then `startLanguageServer`. Per-document schema was explicitly out of scope — this phase's stated output doesn't need it.
- `src/language/lsp/minab-hover-provider.ts`, `minab-definition-provider.ts` (new) — hover and go-to-definition for `#alias`, hand-written rather than the Langium defaults: `#alias` isn't a Langium cross-reference (Phase 2's own finding — Minab has none), so the reference-based default providers have nothing to key off. Both call `MinabScopeResolver.resolveNamedScope` directly, the same resolution the `Validator`'s `NamedScope` check already uses, and point at the declaring `Query.alias`/`JoinClause.alias`.
- `langium-config.json` — added `textMate.out`, so `langium generate` now also emits `vscode-extension/syntaxes/minab.tmLanguage.json` from the grammar's own keyword/token definitions — no hand-written syntax grammar.
- `vscode-extension/` (new) — a separate, non-workspace npm package (own `package.json`/`node_modules`/`tsconfig.json`) rather than an npm workspace member, since this repo has never had workspaces and the extension is a different publishing target (a `.vsix`, not an npm package) from the CLI. `src/extension.ts` starts a `LanguageClient` pointed at the root package's compiled `out/src/language/main.js` by relative path — no npm dependency between the two, since neither is published. `contributes.languages`/`contributes.grammars`/`language-configuration.json` wire up the id, file extension, and generated TextMate grammar.
- **The duplicate-diagnostics fix** (carried forward from Phase 6's "Next job," not a new finding): `TypeResult`'s failure branch gained an `origin?: AstNode` — the node whose own inference first produced the failure. `MinabTypeChecker.inferType` is now a thin wrapper that stamps `origin` only once (on the innermost node), around the renamed `inferTypeDispatch`; since every recursive call in the file already went through the public method, no call site needed touching. `MinabValidator.checkExpressionTypeChecks` now only reports when `origin === node`, so an ancestor re-inferring the same failing subexpression sees `origin` pointing at its descendant and stays quiet — one mistake, one diagnostic. `src/cli/main.ts`'s `dedupe`/`rangeKey`/`contains` (the old CLI-only post-pass this was standing in for) were removed as redundant. A regression test (`test/typechecking.test.ts`) reproduces the original bug (verified it fails without the fix) and confirms it's gone.
- One design note, not a defect: broadening `checkExpressionTypeChecks`'s registration to the whole abstract `Expression` type (rather than the original 11 concrete container types) was tried and reverted — it also visits `Expression` subtypes that are never independently inferred (`is`/`isnot`'s `array`/`object`/`string`/`number`/`boolean` kind markers, and a bare call's callee `NameRef`, e.g. `COUNT` in `COUNT(...)`), producing spurious diagnostics `inferType` was never designed to answer for those nodes on their own. The original 11-type registration is kept; a handful of node types with their own direct failure paths (`ParentRecord`, plain `NameRef`, `Subquery`) remain unregistered, same as before this phase — a narrower, pre-existing gap, not something this fix was asked to close.
- `test/lsp.test.ts` (new, 4 tests) — hover/definition called directly against a `parseHelper`-built document, no real JSON-RPC connection, the same pattern `test/scoping.test.ts`/`test/validation.test.ts` already use for the services underneath.
- `npm run build && npm test`: 180/186 green (175 existing + 1 new regression test in `typechecking.test.ts` + 4 new in `test/lsp.test.ts`; skip count unchanged at 6).
- **Not automated, deliberately:** actually opening a `.minab` file in a VS Code Extension Development Host to eyeball syntax highlighting and hover/F12 UX — no GUI in the environment this phase was built in. Manual QA checklist for whoever verifies this: `cd vscode-extension && npm install && npm run build`, then `npm run build` at the repo root (so `out/src/language/main.js` exists), open this repo in VS Code, press F5 (or `Run Extension` in the Debug panel) to launch the Extension Development Host, open an `examples/*.minab` file, confirm highlighting, hover over an `#alias`/`#Table` reference, F12 to its declaration, then introduce a type error and confirm exactly one live squiggle.

---

## Phase 8 — Documentation & examples — Done (2026-09-19)

**Sign-off: Mechanical.**

**Tasks:**
- Move `docs/query-language-spec.md`'s status from "Draft" to "Stable" once Phases 0-4 are done and there are no known open contradictions.
- Build an `examples/` directory with one realistic `.minab` file per major construct (a multi-join aggregate query, a correlated validation rule, a field rule with a referential-integrity check, etc.), each one covered by a test that it parses, validates, and (if Phase 5/6 are done) executes correctly.
- Update the README with a real walkthrough: install, write a query, run it, read the output.

**Output:** someone unfamiliar with the project can clone the repo, read the README and spec, and successfully write and run their own `.minab` file.

**What actually shipped:**

- **Spec is Stable.** `docs/query-language-spec.md`'s status line flipped from Draft, and §12's intro reworded (with Hamed's sign-off) to say the open items — 1–4, 13, 17, and the second-`let` sub-question of 8 — are deferred additions, not blockers to what is specified today. No grammar or semantic change.
- **`examples/<name>/`** — eleven directories, each one program plus the `minab.config.json` it needs (the previous shared config was split, since config discovery stops at the first file found walking up). Eight execute against their fixture: `first-query`, `top-customers`, `shipping-report`, `cancelled-orders-limit`, `booking-overlap`, `customer-exists` (a field rule), `discounted-total` (a user `fn`), `order-status-switch`. Three are **check-only** because the evaluator doesn't run loops or writes yet: `overdue-loop`, `order-dml`, `reconcile-overdue-accounts` (showcase §14).
- **`test/examples.test.ts`** — drives every example through `runCli` in-process: `check` clean; `run --json` equals the documented answer; the `--trace` statement count (strategy, not just result); `compile` either prints SQL or explains it's interpreted. Check-only examples assert that `run` *refuses* with the specific "not executed yet" reason, so the label fails loudly when execution lands. A drift guard fails if a directory and the manifest disagree, and the README's output blocks (query table, compiled SQL, `--trace`) are asserted against real CLI output.
- **README** — a from-scratch walkthrough (config → query → `check` → a deliberate type error with its caret → `compile` → `run` → a rule), an examples table, corrected Status/layout (the language server and VS Code extension were missing), the full `compile` output. The walkthrough was followed literally in a scratch directory. `vscode-extension/README.md` is new.

Two findings, neither fixed here since both are outside "documentation":

- **A top-level rule filtering a collection doesn't type-check.** `COUNT(.orders[.status == "cancelled"]) < 5` — showcase §1's own example — fails `minab check` with `column "status" needs a statically known table` when written as a bare rule with `rule.recordTable` set; it works inside `FROM Customer WHERE …`. `MinabScopeResolver` doesn't see the host's `recordTable` (only `MinabTypeChecker`'s outermost `.field` does), and `test/evaluation.test.ts` bypasses the validator, so nothing caught it. The example uses the `FROM … WHERE` form; `overdue-loop` loops over `#Order` instead of `.orders` for the same reason. Split out as its own task.
- **`daysSincePayment` in showcase §14 isn't defined anywhere** — the showcase calls it as if it existed. The check-only example defines it in-file (a small query-tailed `fn`) so the program type-checks on its own; the showcase text is unchanged.

---

## Phase 9 — Packaging / release — Done (2026-09-19; not yet published)

**Sign-off: Mechanical.**

**Tasks:**
- Decide what actually gets published (the language server, the CLI, both, as one package or several) and version it.
- Add a CHANGELOG.
- Tag a release once Phase 8's documentation bar is met.

**Output:** an installable, versioned artifact with release notes — the point at which "Minab" stops being only a repo you have to clone and build.

**What actually shipped:**

- **What gets published (decided with Hamed):** one npm package, `@shamsine/minab`, holding the CLI and the language server together; and the VS Code extension as a separate `.vsix` with the server bundled in. Not two npm packages — that needs workspaces, which this repo has deliberately avoided. Both are versioned together at **0.2.0**, not 1.0: the spec is Stable, but loops, DML execution, and `.$index` still refuse to run and the top-level collection-filter bug is open. License **MIT**.
- **npm package.** `package.json` is no longer `private`; it has `license`, `repository`, `files` (an allowlist: `out/src`, README, LICENSE, CHANGELOG, `docs`, `examples`), `publishConfig.access: public`, and `engines.node` corrected from `>=18` to `>=20.10.0` (what Langium 4.4 itself requires — the old value was a lie). `tsconfig.build.json` compiles `src/` only, keeping `rootDir` at `.` so the `out/src/...` layout (and `bin`) doesn't move; `npm run build:release` wipes `out/` first and `prepack` calls it, so a tarball can't pick up stale compiled tests (`out/test/_scratch-showcase.test.js` was sitting in `out/` from a since-deleted file). `pg` is still not bundled or depended on.
- **VS Code extension.** It used to find the server at `../out/src/language/main.js`, which only exists in a clone. `npm run bundle` now uses esbuild to produce the client (`out/extension.js`, CJS) and the server as one ESM file (`server/main.mjs`, with a `createRequire` banner for the CJS dependencies it inlines); `extension.ts` points at `server/main.mjs`. `npm run package` builds `minab-vscode-0.2.0.vsix` (9 files, ~350 KB, no sources or `node_modules`). Publisher is the placeholder `shamsine`.
- **`CHANGELOG.md`** (root and extension), Keep-a-Changelog format, with a "Known limitations" list; **`LICENSE`**; README "Install" section ahead of a "Setup (working on Minab itself)" section.
- **`test/release.test.ts`** — versions match across both packages and the changelog; the tarball (via `npm pack --dry-run`) contains the bin target, the language server, the generated grammar, and docs, and contains no tests, source maps, or extension files.
- **Verified:** the tarball installed into an empty directory runs `minab --version` (0.2.0), `check`, and `run --json` on a copied example with no repo present; the bundled server completes an LSP `initialize` + `didOpen` → `publishDiagnostics` handshake over stdio, same as the unbundled one.

**Not done, deliberately (outward-facing):** `npm publish`, pushing a `v0.2.0` tag, a GitHub release, and a Marketplace publish. Also unverified: that the `@shamsine` npm scope and a `shamsine` Marketplace publisher are Hamed's to publish under, and opening the `.vsix` in a real VS Code (manual QA: `code --install-extension` the `.vsix`, open an `examples/*/` folder, confirm highlighting, a live squiggle on a type error, and hover/F12 on `#alias`).

---

## Cross-cutting: keeping Cursor and Claude in sync

Both this roadmap and the `.cursor/rules/` files describe the same conventions from two different angles — this file says *what to build next and in what order*, the rules say *how to work on this codebase regardless of which phase you're in*. When a Design-sign-off decision gets made (in Cursor, in Claude, or in conversation with neither), write it down in the spec and, if it changes working conventions, in the relevant `.cursor/rules/*.mdc` file — otherwise the next session (in either tool) re-derives or re-litigates it from scratch, which is the exact cost this document exists to avoid.
