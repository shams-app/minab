# Minab

Minab is a small language with two layers that share one expression sub-language:

- a **pipeline query layer** (`FROM` / `JOIN` / `WHERE` / `GROUPBY` / `HAVING` / `SELECT` / `ORDERBY` / `LIMIT`)
- a **validation layer** — a bare expression over `.` is a record-level rule, one using `$` is a field-level rule

It also has a full type system, user-defined functions, `if`/`if!`/`switch`, three loop forms, and declarative `INSERT`/`UPDATE`/`DELETE`. The full language reference lives in [`docs/query-language-spec.md`](docs/query-language-spec.md), with a runnable example for every construct in [`docs/showcase.md`](docs/showcase.md). This repo implements it with [Langium](https://langium.org).

## Status

Minab 0.2.0 is the first public release. It parses, resolves, validates, type-checks, compiles, and runs. Before 1.0, a release may break something. [`docs/roadmap.md`](docs/roadmap.md) has the phased plan of the first phases and what each one shipped; [`docs/status.md`](docs/status.md) is the running session log. [`docs/production/`](docs/production/README.md) is the plan to version 1.0, and [`docs/README.md`](docs/README.md) lists all the documentation.

What runs:

- **Parsing** — the full grammar.
- **Scope resolution** — `.` / `^` / `#alias` / `KEY` against the spec §2.2 scope stack.
- **Validation and type checking** — sigil placement, no implicit coercion, the §3.4 collection-vs-scalar boundary, §7.7 null rules.
- **Execution** — a hybrid ([ADR 0001](docs/adr/0001-execution-strategy.md)): the relational layer compiles to parameterized SQL, everything else is interpreted against the record the host holds, with the interpreter pushing the smallest table-touching subexpression down to the compiler. Statements, all three loop forms, `INSERT`/`UPDATE`/`DELETE` (a dry run unless you apply them), `LOG`, exact `DECIMAL` values and run limits all work.
- **A CLI** — `minab run` / `compile` / `check`, documented below.
- **Editor support** — a language server and a VS Code extension, and Monaco support for web apps; see [`vscode-extension/`](vscode-extension/README.md).
- **A web playground** — write, check, compile and run Minab in the browser against a real PostgreSQL (PGlite, WebAssembly), with a guided tour and a verified example gallery; see [`playground/`](playground/README.md).

What you can embed (see [Use Minab from your app](#use-minab-from-your-app)):

- **One runtime API** — `createMinab`, `prepare`, `run`, with ports for the database, host functions, the clock and events. The CLI and the playground use it too.
- **NestJS** — a module, a service, an exception filter and a run endpoint for stored programs (`@shamsine/minab/nestjs`).
- **The browser** — the runtime in a Web Worker, local runs, runs delegated to a server by program id, and Monaco (`@shamsine/minab/browser`, `@shamsine/minab/monaco`).

Known limitations (the same list is in the [CHANGELOG](CHANGELOG.md#020---2026-10-05)):

- A user function can be called inside a query only when its body is one expression (no `let`, no statements, no recursion). A host function, or a function that is not inlinable, in the value of an `INSERT` or `UPDATE` fails with `compile.notSql`.
- A statement block inside a query is refused (`compile.blockInQuery`). A `LOG` inside a query prints nothing and gives a warning.
- With several `GROUPBY` keys, `KEY.<name>` reads one key. A bare `KEY` has no value.
- Some writes are refused or do not check: assigning through a member of a local `JSON` variable, a relation step after a to-many step in a write path (`compile.writePath`), and a filter on the fields of a `JSON` array element.
- A dry run does not see its own writes in later reads (except `JSON` array columns), so a program that depends on its own writes can give another answer than with `--apply`.
- A `JSON` column that holds the JSON value `null` is `null` in the interpreter, but not in SQL.
- `minab.config.json` cannot declare host functions or inputs yet, so the CLI and the language server use none. Hosts declare them with `createMinab`.
- The compiled SQL targets PostgreSQL only.

The language is still in development, so any release before 1.0 may break something. The language spec §12 lists a handful of open questions; those are deferred additions to the language, not gaps in what's specified today.

## Install

Requires Node.js 22.12 or newer.

```bash
npm install -g @shamsine/minab    # puts `minab` on your PATH
minab --version
```

Or run it without installing: `npx @shamsine/minab check my-rule.minab`.

The package contains the CLI and the language server. The VS Code extension is a separate install: search for **Minab** (publisher `shamsine`) in the VS Code Marketplace, or in Open VSX for Cursor and VSCodium. You can also install a `minab-vscode-<version>.vsix` file with `code --install-extension minab-vscode-<version>.vsix` (see [`vscode-extension/`](vscode-extension/README.md)).

## Use Minab from your app

Minab is a library as well as a command line. A host app (a NestJS server, a web app) gives Minab a schema, and Minab checks and runs programs that your users write.

```ts
import { createMinab } from '@shamsine/minab';

const minab = createMinab({ schema, ruleContext: { isFieldRule: false, recordTable: 'Order' } });
const program = await minab.prepare('.total <= 1000', { expect: 'boolean' });
if (program.ok) console.log(await program.run({ record: { total: '24.90' } }));
```

- The [embedding guide](docs/guides/embedding.md) explains the ports, where programs run, and how to wire a NestJS server and a browser app.
- Two tested example apps show it: [`examples/nestjs`](examples/nestjs/README.md) (a rule inside a request transaction) and [`examples/browser`](examples/browser/README.md) (a worker, local and remote rules, Monaco).
- The API reference is generated with `npm run docs:api`. The [documentation index](docs/README.md) lists everything else.

## Setup (working on Minab itself)

Everything above is for using Minab; this is for changing it. Clone the repo, then:

```bash
npm install
npm run build    # langium generate + tsc
npm test         # the full suite (6 more tests run with a database — see below)
```

`npm run watch` regenerates the grammar and recompiles on file changes.

## Walkthrough: write and run your own program

Nothing here needs a database. Start in an empty directory (any name), with `minab` on your `PATH` (`npm install -g @shamsine/minab`, or `npm link` in a checkout), or substitute `npm run cli --` run from the repo.

**1. Describe your data.** Minab source never names its tables or columns — the host supplies them, and on a command line that host is a `minab.config.json` next to your program (details [below](#the-config-file)). Save this as `minab.config.json`:

```json
{
  "schema": {
    "tables": [
      { "name": "Customer", "primaryKey": "id",
        "columns": { "id": "UUID", "name": "TEXT", "country": "TEXT?" } },
      { "name": "Order", "primaryKey": "id",
        "columns": {
          "id": "UUID",
          "customer": { "ref": "Customer", "foreignKey": "customer_id" },
          "status": "TEXT",
          "total": "DECIMAL"
        } }
    ]
  },
  "data": {
    "responses": [
      { "rows": [{ "id": "o-104", "total": 980, "customer_name": "Ada Lovelace" }] }
    ]
  }
}
```

The `data` block is canned output, so you can `run` without a database; the first response whose optional `"match"` text appears in the generated SQL is returned (one with no `"match"` answers anything).

**2. Write a query.** Save as `first.minab`:

```
FROM Order
WHERE .status == "shipped" AND .customer.country == "US"
SELECT .id, .total, .customer.name AS customer_name
ORDERBY .total DESC
LIMIT 20
```

`.` is the current row; `.customer.name` walks the `ref` to the related customer, no `JOIN` needed.

**3. Check it.** This parses, resolves every `.field` against your schema, and type-checks:

```console
$ minab check first.minab
first.minab: no problems found
```

Now break it — change `"shipped"` to `5` and check again. Minab never coerces types implicitly, and says where:

```console
$ minab check first.minab
first.minab:2:7: error: "==" between TEXT and INTEGER requires an explicit CAST (no implicit coercion)
2 | WHERE .status == 5 AND .customer.country == "US"
  |       ^^^^^^^^^^^^
minab: 1 error — not a valid program
```

Change it back to `"shipped"` before moving on.

**4. See the SQL, then run it.**

```console
$ minab compile first.minab        # prints SQL and parameters; runs nothing
$ minab run first.minab
id     total  customer_name
-----  -----  -------------
o-104  980    Ada Lovelace
```

**5. Try a rule.** A bare expression over `.` is a record-level validation rule; one using `$` is a field-level rule. Point the config at the record under validation (`"rule": {"recordTable": "Order"}`, `"record": {…}`) and `minab run rule.minab` prints the rule's answer — [`examples/booking-overlap`](examples/booking-overlap/booking-overlap.minab) (record rule) and [`examples/customer-exists`](examples/customer-exists/customer-exists.minab) (field rule, `$`) are complete, working setups to copy.

From here: [`docs/showcase.md`](docs/showcase.md) is a progression of every construct, and the [spec](docs/query-language-spec.md) is the reference.

## Examples

Each directory under [`examples/`](examples/) holds one program and the `minab.config.json` it runs against, and every one is exercised by [`test/examples.test.ts`](test/examples.test.ts) — if it's listed here, it works as described.

| Example | Shows | Spec |
|---|---|---|
| [`first-query`](examples/first-query/first-query.minab) | A pipeline query: filter, `ref` traversal, `ORDERBY`, `LIMIT` | §4 |
| [`top-customers`](examples/top-customers/top-customers.minab) | `GROUPBY`, `HAVING`, aggregates, `KEY` | §4.3 |
| [`shipping-report`](examples/shipping-report/shipping-report.minab) | An explicit `JOIN … ON` | §4.3 |
| [`cancelled-orders-limit`](examples/cancelled-orders-limit/cancelled-orders-limit.minab) | Reducing a collection with a filter and `COUNT` | §3.4 |
| [`booking-overlap`](examples/booking-overlap/booking-overlap.minab) | A record-level rule with a correlated `#Booking` check | §6.1 |
| [`customer-exists`](examples/customer-exists/customer-exists.minab) | A field-level rule (`$`): a referential-integrity check | §6.2 |
| [`discounted-total`](examples/discounted-total/discounted-total.minab) | A user function, called by name | §8 |
| [`order-status-switch`](examples/order-status-switch/order-status-switch.minab) | `switch` as an expression in a rule | §9.2 |
| [`overdue-loop`](examples/overdue-loop/overdue-loop.minab) | A `for-in` loop | §9.4 |
| [`order-dml`](examples/order-dml/order-dml.minab) | `UPDATE` / `INSERT` (a dry run unless you use `--apply`) | §10 |
| [`reconcile-overdue-accounts`](examples/reconcile-overdue-accounts/reconcile-overdue-accounts.minab) | Functions, loops, `if`, `is`, and writes together | showcase §14 |

## Usage

Installed from npm, the CLI is just `minab`. In a checkout, after `npm run build` it is at `out/src/cli/bin.js`: use it through `npm run cli --`, or put it on your `PATH` with `npm link`:

```bash
npm run cli -- check examples/booking-overlap/booking-overlap.minab
minab check examples/booking-overlap/booking-overlap.minab      # same thing, after `npm link`
```

Three commands, each taking one `.minab` file:

| Command | What it does |
|---|---|
| `minab check <file>` | Parses, validates, and type-checks. Prints diagnostics; exits 1 if any are errors. |
| `minab compile <file>` | Prints the SQL the program compiles to, with its parameters. Runs nothing. |
| `minab run <file>` | Evaluates the program against a data source and prints the result. |

Options: `-c/--config <file>`, `-d/--database <url>`, `-r/--record <file>`, `--field <json>`, `--json`, `--trace`, `--apply`, `--no-logs`, `-h/--help`, `-v/--version`.

Exit codes are `0` for success, `1` for a program that is invalid or failed to run, `2` for a bad invocation. A validation rule that evaluates to `false` still exits `0` — the rule's answer is on stdout, and the exit status says whether the program *ran*, not what it decided. Diagnostics and `--trace` output go to stderr, so `minab run … --json` stays pipeable.

### Run a validation rule

[`examples/booking-overlap/booking-overlap.minab`](examples/booking-overlap/booking-overlap.minab) is the spec §6.1 rule: a booking must end after it starts and must not overlap another booking of the same room.

```console
$ minab run examples/booking-overlap/booking-overlap.minab
true
```

`--trace` prints every statement the program sends to the data source, which is how you see the execution strategy rather than just the answer — the date comparison is settled from the record in hand, and only the correlated check reaches the database (the statement is one line; it's wrapped here to fit):

```console
$ minab run examples/booking-overlap/booking-overlap.minab --trace
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
$ minab run examples/top-customers/top-customers.minab
customer_name  total_spent  order_count
-------------  -----------  -----------
Ada Lovelace   4820.5       12
Grace Hopper   3180         9
```

### See the compiled SQL

```console
$ minab compile examples/top-customers/top-customers.minab
SELECT (SELECT "_r0"."name" FROM "Customer" AS "_r0" WHERE "_r0"."id" = "Order"."customer_id") AS "customer_name", SUM("Order"."total") AS "total_spent", COUNT(*) AS "order_count" FROM "Order" GROUP BY "Order"."customer_id" HAVING SUM("Order"."total") > $1 ORDER BY "total_spent" DESC
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
minab run examples/top-customers/top-customers.minab --database postgresql://user:pass@localhost:5432/mydb
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
examples/<name>/           # one program + its minab.config.json each; tested by test/examples.test.ts
vscode-extension/          # the VS Code extension (a separate package — see its README)
playground/                # the web playground (a separate package — see its README and design/)
src/
  language/
    main.ts                # the language server entry point
    lsp/                   # hover and go-to-definition for `#alias`
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
