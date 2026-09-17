# Minab

Minab is a small language with two layers that share one expression sub-language:

- a **pipeline query layer** (`FROM` / `JOIN` / `WHERE` / `GROUPBY` / `HAVING` / `SELECT` / `ORDERBY` / `LIMIT`)
- a **validation layer** — a bare expression over `.` is a record-level rule, one using `$` is a field-level rule

It also has a full type system, user-defined functions, `if`/`if!`/`switch`, three loop forms, and declarative `INSERT`/`UPDATE`/`DELETE`. The full language reference lives in [`docs/query-language-spec.md`](docs/query-language-spec.md), with a runnable example for every construct in [`docs/showcase.md`](docs/showcase.md). This repo implements it with [Langium](https://langium.org).

## Status

Minab parses, resolves, validates, type-checks, compiles, and runs. [`docs/roadmap.md`](docs/roadmap.md) has the phased plan and what each phase actually shipped; [`docs/status.md`](docs/status.md) is the running session log.

- **Parsing** — the full v2 grammar.
- **Scope resolution** — `.` / `^` / `#alias` / `KEY` against the spec §2.2 scope stack.
- **Validation and type checking** — sigil placement, no implicit coercion, the §3.4 collection-vs-scalar boundary, §7.7 null rules.
- **Execution** — a hybrid ([ADR 0001](docs/adr/0001-execution-strategy.md)): the relational layer compiles to parameterized SQL, everything else is interpreted against the record the host holds, with the interpreter pushing the smallest table-touching subexpression down to the compiler.
- **A CLI** — `minab run` / `compile` / `check`, documented below.

Not executed yet, each failing with an explicit reason rather than a wrong answer: loops (§9.4), `INSERT`/`UPDATE`/`DELETE` (§10), and `.$index` (§3.5). No language server or editor integration yet (roadmap Phase 7).

## Setup

```bash
npm install
npm run build    # langium generate + tsc
npm test         # 175 tests (6 more run with a database — see below)
```

`npm run watch` regenerates the grammar and recompiles on file changes.

## Usage

After `npm run build`, the CLI is at `out/src/cli/bin.js`. Use it through `npm run cli --`, or put it on your `PATH` with `npm link` and call it `minab`:

```bash
npm run cli -- check examples/booking-overlap.minab
minab check examples/booking-overlap.minab      # same thing, after `npm link`
```

Three commands, each taking one `.minab` file:

| Command | What it does |
|---|---|
| `minab check <file>` | Parses, validates, and type-checks. Prints diagnostics; exits 1 if any are errors. |
| `minab compile <file>` | Prints the SQL the program compiles to, with its parameters. Runs nothing. |
| `minab run <file>` | Evaluates the program against a data source and prints the result. |

Options: `-c/--config <file>`, `-d/--database <url>`, `-r/--record <file>`, `--field <json>`, `--json`, `--trace`, `-h/--help`, `-v/--version`.

Exit codes are `0` for success, `1` for a program that is invalid or failed to run, `2` for a bad invocation. A validation rule that evaluates to `false` still exits `0` — the rule's answer is on stdout, and the exit status says whether the program *ran*, not what it decided. Diagnostics and `--trace` output go to stderr, so `minab run … --json` stays pipeable.

### Run a validation rule

[`examples/booking-overlap.minab`](examples/booking-overlap.minab) is the spec §6.1 rule: a booking must end after it starts and must not overlap another booking of the same room.

```console
$ minab run examples/booking-overlap.minab
true
```

`--trace` prints every statement the program sends to the data source, which is how you see the execution strategy rather than just the answer — the date comparison is settled from the record in hand, and only the correlated check reaches the database (the statement is one line; it's wrapped here to fit):

```console
$ minab run examples/booking-overlap.minab --trace
SELECT EXISTS (SELECT 1 FROM "Booking" AS "_r0" WHERE ((("_r0"."id" IS DISTINCT FROM $1
  AND "_r0"."room_id" IS NOT DISTINCT FROM $2) AND "_r0"."start_date" < $3)
  AND "_r0"."end_date" > $4)) AS "value"
-- parameters
--   $1 = "b-1"
--   $2 = "room-7"
--   $3 = "2026-10-05"
--   $4 = "2026-10-01"
true
```

### Run a query

```console
$ minab run examples/top-customers.minab
customer_name  total_spent  order_count
-------------  -----------  -----------
Ada Lovelace   4820.5       12
Grace Hopper   3180         9
```

### See the compiled SQL

```console
$ minab compile examples/top-customers.minab
SELECT (SELECT "_r0"."name" FROM "Customer" AS "_r0" WHERE "_r0"."id" = "Order"."customer_id") AS "customer_name", ...
-- parameters
--   $1 = 1000
```

A program that has no SQL form of its own (one calling a user `fn`, say) says so and points at `run`, which interprets it and pushes down the parts that do need the database.

### The config file

Minab source deliberately never names its tables, its own record, or a connection — the host application supplies all of it (see [`src/language/schema.ts`](src/language/schema.ts)). On a command line, `minab.config.json` stands in for that host. It is found by walking up from the `.minab` file's own directory, or named with `--config`. All of it is optional: `minab check` on a program that touches no tables needs no config at all.

```jsonc
{
  "schema": {
    "tables": [
      {
        "name": "Order",
        "primaryKey": "id",
        "columns": {
          "id": "UUID",
          "status": "TEXT",
          "total": "DECIMAL",
          "shipped_at": "DATETIME?",                                  // nullable
          "tags": "TEXT[]",                                           // array
          "customer": { "ref": "Customer", "foreignKey": "customer_id" },
          "lines": { "collection": "OrderLine", "foreignKey": "order_id" }
        }
      }
    ]
  },

  // What the host knows that the source doesn't: which table this rule is
  // attached to, and — for a field-level rule — the type of `$`.
  "rule": { "recordTable": "Order", "fieldType": "DECIMAL" },

  // The record under validation. An object, or a path to a JSON file.
  "record": { "id": "o-1", "status": "paid", "total": 42 },

  // Canned answers, for running without a database. The first response
  // whose "match" appears in the generated SQL wins; one with no "match"
  // answers anything. "value" is shorthand for a single-column row, which
  // is what a pushed-down subexpression reads back.
  "data": {
    "responses": [
      { "match": "EXISTS", "value": false },
      { "rows": [{ "name": "Ada", "spent": 1700 }] }
    ]
  }
}
```

Column types are written as in spec §7.2: a base type (`TEXT`, `CITEXT`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `DATE`, `TIME`, `DATETIME`, `UUID`, `JSON`), optionally `?` for nullable, optionally `[]` for an array, optionally a second `?` for a nullable array. `primaryKey` and `foreignKey` are what make a traversal executable — `.customer.country` has to become a join somehow, and nothing in Minab source says how.

### Run against a real database

`--database` runs the compiled SQL against PostgreSQL instead of the config's canned responses. It needs the `pg` driver, which is not a dependency of this package — install it yourself:

```bash
npm install pg
minab run examples/top-customers.minab --database postgresql://user:pass@localhost:5432/mydb
```

`MINAB_DATABASE_URL` does the same without the flag. Precedence is `--database`, then the environment variable, then the config's `"database"` key — so a config committed to a repo can be pointed elsewhere without editing it.

The same variable under the name `MINAB_TEST_DATABASE_URL` turns on [`test/postgres.test.ts`](test/postgres.test.ts), which executes the compiled SQL against a real server rather than diffing it against expected text. It drops and recreates its own tables, so point it at a throwaway database:

```bash
MINAB_TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/scratch npm test
```

## Project layout

```
docs/
  query-language-spec.md   # the language spec — source of truth for syntax and semantics
  showcase.md              # a runnable example per construct, kept in sync with the spec
  roadmap.md               # phased implementation plan
  status.md                # running session log
  adr/                     # architecture decision records
examples/                  # .minab programs the README walks through, plus their config
src/
  language/
    minab.langium          # the grammar (mirrors spec §11)
    minab-module.ts        # Langium DI wiring
    schema.ts              # the host-supplied table/column contract
    minab-scope-resolver.ts  # `.` / `^` / `#alias` / `KEY`
    minab-types.ts, minab-builtins.ts, minab-type-checker.ts
    minab-validator.ts     # diagnostics
    minab-sql-compiler.ts, minab-interpreter.ts, minab-executor.ts
    generated/             # `langium generate` output — gitignored, never hand-edited
  cli/                     # the `minab` command
test/                      # vitest suites, one per layer
```

## Working conventions

These carried over from language design discussion and apply to any future grammar change:

- No implicit type coercion.
- Every grammar addition must be checked for LL(k) parsing safety.
- Keyword casing is a deliberate convention: SQL-style pipeline keywords are uppercase (`FROM`, `WHERE`, `GROUPBY`, ...); loop/JSON/control-flow keywords are lowercase. Grep for collisions after each addition.
- The spec document is a controlled artifact — it changes only alongside (and in sync with) grammar changes, not ahead of them.
- Proposal → example review → explicit approval → implementation, in that order, for any language change.
