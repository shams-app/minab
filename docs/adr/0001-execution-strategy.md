# ADR 0001: Execution strategy for queries, validation rules, and writes

**Status:** Accepted (Hamed, 2026-09-17). Implemented in `src/language/minab-sql-compiler.ts` and `src/language/minab-interpreter.ts` — see roadmap Phase 5 for what shipped.

**Date:** 2026-09-17

## Context

Phases 0-4 fixed the language (grammar, scoping, validation, type system) but never
decided how a parsed-and-checked Minab program actually *runs*. Three facts from
those phases bound the design space here:

1. **The host owns the data, at runtime, not Minab.** `SchemaProvider`
   (`src/language/schema.ts`) is Minab's only view of tables/columns — there is no
   in-file schema declaration. Minab is embedded in a larger web application, and
   the roadmap already frames the natural backing store as "a Postgres-shaped
   schema" (roadmap Phase 5). Any execution strategy has to consume a schema and a
   live connection supplied by that host, not assume a fixture.
2. **Null semantics are deliberately not SQL's.** Spec §7.7: `==`/`!=` are total
   and null-safe (`null == null` is `true`), never SQL's three-valued
   `UNKNOWN`. Whatever executes `==`/`!=` — compiled or interpreted — has to
   implement this explicitly; naively emitting SQL `=`/`<>` is wrong.
3. **The expression language is bigger than relational algebra.** Spec §7-9 give
   Minab closures, recursion, `if`/`switch`, three loop forms with labeled
   `break`/`continue`, and (§8) implicitly-async user functions. None of that is
   expressible as a single SQL statement in the general case — recursive CTEs
   cover *some* recursion shapes, but not arbitrary user-defined recursive `fn`s
   with side effects. At the same time, the pipeline layer (`FROM`/`JOIN`/`WHERE`/
   `GROUPBY`/`HAVING`/`SELECT`/`ORDERBY`/`LIMIT`) *is* exactly relational algebra,
   and §6's headline use case — a correlated `#Table[...]` existence check — is
   exactly the kind of thing a real database indexes and a naive in-memory scan
   does not.

The question: compile to SQL, interpret against fetched/streamed records, or a
hybrid of the two.

## Options considered

### A. Compile everything to SQL

Translate the full language — including validation rules, `fn` bodies, loops, and
recursion — into SQL (recursive CTEs, PL/pgSQL functions, etc.).

- **Pipeline queries + `GROUPBY`/`HAVING`:** natural fit, this is what SQL is for.
- **Correlated `#Table` checks:** natural fit — `EXISTS (SELECT ... )`.
- **Null-safe `==`/`!=`:** solvable — Postgres has `IS NOT DISTINCT FROM` / `IS
  DISTINCT FROM`, which *is* total null-safe equality, so this isn't a blocker on
  its own.
- **Loops, recursion, closures, async `fn`:** not a natural fit. General recursion
  with arbitrary side effects and closures over interpreter-level state doesn't
  reduce to one SQL statement; forcing it would mean either rejecting a large,
  already-shipped slice of the grammar (breaking backward compatibility with
  Phases 1-4's own test corpus) or building a bespoke SQL-emitting compiler for a
  Turing-complete subset of the language — a much larger and riskier project than
  Phase 5 is scoped for.
- **Writes:** `INSERT ... SELECT`/`UPDATE ... WHERE`/`DELETE ... WHERE` compile
  cleanly *if* the payload/target is itself SQL-expressible; a payload built from
  `fn` calls or loops runs into the same wall as above.

**Rejected** — it treats the imperative half of the language (which Phase 1-4
already built and tested: `fn`, loops, `if`/`switch`) as out of scope, which no one
has agreed to, and the parts of it that *are* forceable into SQL (recursive
functions, async calls) would require PL/pgSQL codegen of a fidelity this phase
has no evidence is achievable in one pass.

### B. Interpret everything against fetched/streamed records

A tree-walking evaluator holds the full AST and walks it against in-memory
records, fetching whatever tables it touches (via the host connection) as plain
row sets.

- **Validation rules, `fn`, loops, recursion, closures:** natural fit — this is
  exactly what a tree-walking interpreter is for, and it's the same shape of work
  `MinabScopeResolver`/`MinabTypeChecker` already do over the AST, just at runtime
  instead of compile time.
- **Null-safe `==`/`!=`:** trivial — the host language (TypeScript) already treats
  `null === null` as `true`; no special-casing needed the way SQL needs it.
- **Pipeline queries, `GROUPBY`/`HAVING`:** works, but reimplements a chunk of what
  a relational database already does well (joins, grouping, indexed lookups) in
  application code, against data a real Postgres-shaped schema (per the roadmap)
  is presumably already backed by.
- **Correlated `#Table` scans — the specific risk the roadmap flags:** this is
  where naive interpretation breaks down. §6.1's headline example,
  `EXISTS(#Booking[. != ^ AND .room_id == ^.room_id AND ...])`, opens every row of
  `Booking` as a scope. Interpreted naively, "every row of `Booking`" means
  fetching the whole table into memory and filtering client-side, once per
  validation. For a table with any real volume this is an unconditional full
  table scan on every validated record — the exact case a database index exists
  to avoid, and one this design would pay for on every single write.
- **Writes:** straightforward as an explicit "fetch candidate rows, mutate, write
  back" step, but for a `WHERE`/`ORDERBY`/`LIMIT`-qualified `UPDATE`/`DELETE`
  against a real table, this has the same full-table-fetch problem as the
  `#Table` scan case above.

**Rejected as the sole strategy** — it's the right shape for the imperative half
of the language, but the roadmap's own flagged risk (correlated `#Table`
performance) is a real, unforced defect of this option specifically, not a
hypothetical.

### C. Hybrid — compile the relational layer to SQL, interpret the rest, and let the interpreter push relational subexpressions down to SQL (recommended)

Two cooperating pieces:

- **A SQL compiler** for anything that is pure relational algebra: a top-level
  `Query` (`FROM`/`JOIN`/`WHERE`/`GROUPBY`/`HAVING`/`SELECT`/`ORDERBY`/`LIMIT`),
  an ad-hoc `#Table[filter]` reference, and the DML statements' SQL-expressible
  forms (§10) — `INSERT ... SELECT`, `UPDATE ... WHERE ... SET`,
  `DELETE ... WHERE`.
- **A tree-walking interpreter** for everything else — the record/field-level
  validation rule itself (§6), `let`/assignment/`if`/`switch`/loops (§9), and
  `fn` calls including recursion and closures (§8) — operating on the single
  record already in hand (the row being validated, inserted, or updated is
  supplied by the host; there's no need to round-trip it through SQL).

The two are not separate execution paths chosen up front — they cooperate within
one evaluation. Whenever the interpreter, walking an expression, hits a
subexpression that is itself relational — a `#Table[filter]` reference, a
parenthesized subquery (§5.4), a DML target/payload that resolves to a table —
it hands *that subexpression* to the SQL compiler, binding any outer `.`/`^`-
derived values the interpreter already holds as query parameters, executes it
against the host's connection, and resumes interpreting with the scalar/row-set
result. This is precisely the scope-stack relationship `MinabScopeResolver`
(Phase 2) already models statically (`^` reaching out of a pushed scope) — at
runtime, "reaching out" becomes "this outer interpreted value becomes a bind
parameter in the pushed-down SQL."

Walking through the roadmap's four required concerns:

1. **Validation rules execute per-record, via the interpreter**, exactly as the
   roadmap anticipated ("likely outside SQL, even if queries compile to SQL").
   `.`/`$` bind directly to the record/field the host is already validating —
   no fetch needed for the base record itself.
2. **Correlated `#Table` scans compile to SQL**, not naive interpretation. §6.1's
   example becomes one `EXISTS (SELECT 1 FROM booking WHERE booking.id <> $1 AND
   booking.room_id = $2 AND booking.start_date < $3 AND booking.end_date > $4)`
   with `$1..$4` bound from the interpreter's current `.`/`^` values — an indexed
   lookup, not a full-table fetch. This is the specific failure mode of Option B
   that this hybrid avoids by construction.
3. **Null-safe `==`/`!=`:** the SQL compiler emits `IS NOT DISTINCT FROM` /
   `IS DISTINCT FROM` (native Postgres, exactly total null-safe equality per
   spec §7.7) everywhere a compiled `==`/`!=` appears; the interpreter uses
   ordinary host-language equality, which is already null-safe/total for the
   same reason Option B's was. One rule (§7.7) implemented twice, once per
   runtime, each in the natural idiom of that runtime — not one shared code path,
   but not two independently-designed semantics either.
4. **Declarative writes (§10):** §10 gives a DML target three possible shapes —
   "a relational `collection(Table)` field, a `JSON`-array field, or a whole
   table via `#Table`" — and the split between them falls on the same seam as
   everything else here:
   - **Relational targets** (`#Table`, `#Table[...]`, a `collection(Table)`
     field) compile straight to SQL DML. This is the common case and the
     performance-sensitive one: a bulk `UPDATE .customers WHERE ... SET {...}`
     should be one SQL statement, not a fetch-mutate-write loop. An
     `INSERT ... VALUES` whose payload is itself relational (`#Customers`, a
     filtered `#Customers[...]`, or a full `Query`) becomes one
     `INSERT ... SELECT`.
   - **`JSON`-array targets** stay on the interpreter side. Mutating one is a
     read-modify-write of a single column value, not a table operation — and
     §3.5's `.$index`/positional forms (`DELETE .customers[2]`,
     `UPDATE ... WHERE .$index > 2`) are *only* legal against a `JSON` array or
     an in-memory `T[]`, never against a relational collection, precisely
     because a relational collection has no stable position. So the ordinal
     DML forms in §10's examples are, by §3.5's own rule, always the
     interpreted case; they never need a SQL ordinal concept that SQL doesn't
     have.
   - A single-row `VALUES {...}` payload is evaluated by the interpreter first
     (its fields may reference `.`, `fn` calls, or anything else in the
     expression language) down to concrete values, then executed as one
     parameterized `INSERT`.

   Nothing here needs generated triggers or PL/pgSQL — every relational DML form
   in §10 names a single target table per statement.

## Decision

Adopt **Option C, the hybrid**: a SQL compiler for the pipeline layer, ad-hoc
`#Table` references, subqueries, and SQL-expressible DML; a tree-walking
interpreter for validation rules, variables, control flow, loops, and functions;
with the interpreter pushing any relational subexpression it encounters down to
the SQL compiler rather than fetching and filtering it in memory.

This is the specific hybrid the roadmap's own Phase 5 write-up names as a
candidate ("compile the pipeline layer to SQL, interpret validation rules
standalone") — this ADR is choosing it explicitly, with the reasoning above, over
either pure strategy.

### Consequences

- Two runtimes to build and maintain instead of one, with a defined seam between
  them (relational subexpression → SQL compiler; everything else → interpreter).
  The seam is small and mechanical: "is this AST node relational (`Query`,
  `#Table[...]`, a SQL-expressible DML statement)?" — yes → compile; no →
  interpret and recurse.
- The interpreter needs a runtime counterpart to `MinabScopeResolver`'s scope
  stack (to track `.`/`^`/`#alias`/`KEY` bindings at evaluation time, not just
  resolution time) and a way to turn a bound outer value into a SQL parameter
  when handing a subexpression to the compiler.
- The SQL compiler only ever needs to target the subset of the grammar that's
  actually relational — it does not need to represent `fn`, loops, or closures at
  all, which keeps its scope bounded and testable by diffing generated SQL
  against hand-written fixtures (per the roadmap's Output requirement).
- User `fn`s that are "implicitly async" (§8.1) stay entirely on the interpreter
  side; a `fn` is never partially compiled.
- This requires a real Postgres connection (or equivalent) to test against, not
  just fixtures — at minimum for Phase 5's own "diff generated SQL against
  hand-written expected SQL" requirement, and later for the CLI (Phase 6) to
  execute anything for real. Doesn't require deciding *which* concrete host
  driver yet — that can stay behind a small interface the host supplies, the same
  pattern `SchemaProvider` already established for schema.
- **It commits to a SQL dialect, which the spec deliberately does not.** Spec §7.2
  calls the type vocabulary "storage-agnostic ... not tied to any particular
  storage backend," and that stays true — this ADR is choosing a *compilation
  target*, not a type mapping. But the compiler does emit dialect-specific text:
  `IS NOT DISTINCT FROM`/`IS DISTINCT FROM` for null-safe `==`/`!=`. That
  spelling is standard SQL (SQL:1999) and works on Postgres as-is; a host on a
  backend that lacks it would need the equivalent (`<=>` on MySQL, `IS`/`IS NOT`
  on SQLite) or the expanded `(a = b OR (a IS NULL AND b IS NULL))` form. Phase 5
  targets Postgres — consistent with the roadmap's "Postgres-shaped schema" and
  with `CITEXT` being in §7.2's type table at all — and keeps the emitted
  operator spellings in one place so a second dialect is a substitution, not a
  rewrite.
- **The host schema has to say how tables link, which it previously didn't.**
  Found while implementing: `ColumnType`'s `ref`/`collection` named the
  target table but no join key, and `MinabTableSchema` had no primary key —
  enough for Phases 2-4, which only ever needed to know *what* a traversal
  lands on. Executing one needs to know *how*: `.customer.country` has to
  become a join, `COUNT(.orders[...])` a correlated subquery, and §6.1's
  `. != ^` a comparison of row identities. Both were added as optional
  fields (`foreignKey`, `primaryKey`), so a relation that declares neither
  fails with an explicit reason rather than guessing at a naming
  convention. This also closes the gap Phase 4 flagged when it found the
  four `ref`-compared-to-scalar defects ("needs a primary-key marker in the
  schema contract that doesn't exist yet").
- **`CITEXT` needs the interpreter to honor case-insensitive equality itself.**
  Compiled to SQL against a real `citext` column, `=` is already case-insensitive
  and nothing special is needed; interpreted in memory, ordinary host-language
  equality is case-*sensitive* and would silently disagree with the compiled
  path. The interpreter therefore has to consult the column's declared type
  (which `MinabTypeChecker` already infers) rather than comparing raw values —
  the one place where "implement §7.7 twice, once per runtime" needs care beyond
  null handling.

## Phase 5 implementation scope (once signed off)

Per the roadmap's Definition of Done, build a minimal but real instance of this,
not a toy:

1. SQL compiler: one non-trivial `FROM`/`WHERE`/`SELECT` pipeline, and one
   `GROUPBY`/`HAVING` aggregate example, each verified by diffing generated SQL
   against a hand-written expected fixture.
2. Interpreter: one record-level validation rule that includes a correlated
   `#Table` check (§6.1's booking-overlap example is the natural candidate),
   verified end-to-end — the correlated part must actually be pushed down to SQL,
   not fetched and filtered, per the Decision above.
