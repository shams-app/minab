# Changelog

All notable changes to Minab are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/) — while the version is `0.x`, minor releases may still change behavior.

The npm package (`@shamsine/minab`, the CLI and language server) and the VS Code extension (`minab-vscode`) are versioned together.

## [0.2.0] - 2026-10-05

The first public release. Version 0.2.0 was packaged on 2026-09-19, but it was never published. This section covers the whole of it: the first build and everything that came after, up to the first release. Before 1.0, a minor release may change behavior. Entries marked **Breaking** changed something that only existed in the unpublished builds.

### Added

- **The language.** The complete language as a Langium grammar, with the spec ([`docs/query-language-spec.md`](docs/query-language-spec.md)) and a runnable example for every construct ([`docs/showcase.md`](docs/showcase.md)): the pipeline layer (`FROM`/`JOIN`/`WHERE`/`GROUPBY`/`HAVING`/`SELECT`/`ORDERBY`/`LIMIT`), record- and field-level validation rules, the `.`/`^`/`#alias`/`KEY` sigils, a full type system, user functions, `if`/`if!`/`switch`, three loop forms, and `INSERT`/`UPDATE`/`DELETE`.
- **Scope resolution and type checking.** Sigil resolution against the spec's scope stack, with diagnostics for misplaced `$`, `KEY` and unknown `#alias`. No implicit coercion, the collection-versus-scalar boundary, multi-hop `ref` traversal and the null-operand rules. Tables, columns and built-ins come from a host-supplied schema.
- **Execution.** A hybrid evaluator ([ADR 0001](docs/adr/0001-execution-strategy.md)): the relational layer compiles to parameterized SQL, and everything else is interpreted against the record the host holds. The generated SQL runs against PostgreSQL 16, and a differential test compares the interpreter with it.
- **The `minab` CLI.** `minab check`, `minab compile` and `minab run`, driven by a `minab.config.json` that supplies the schema, rule context, record under validation and data source. Diagnostics print as `file:line:col` with the source line and a caret. `--json` gives machine-readable output. `--database` runs the compiled SQL against PostgreSQL (needs the `pg` driver, which is not bundled). Writes are a dry run unless you give `--apply`.
- **Editor support.** A language server and a VS Code extension (`minab-vscode`) with syntax highlighting, distributed as a self-contained `.vsix` with the server bundled in.
- **Examples.** Eleven programs under `examples/`, one directory each, all run by tests. There are also a NestJS app and a browser app (below).
- Every diagnostic from the checker has a stable code, for example `type.implicitCoercion`, and parameters that name what went wrong. A host can translate a message by its code. The list of codes is in `docs/reference/diagnostics.md`.
- An `INTEGER` result outside ±9,007,199,254,740,991 is an evaluation error, `eval.integerOutOfRange`, instead of a silently wrong value.
- Editor services for completion, hover, go to definition and signature help are one library. A called `fn` now has hover and go to definition in the language server too.
- The language server shows an outline of functions, lets, parameters and aliases, finds references and renames them, colors names by meaning (semantic tokens), and offers quick fixes: "Did you mean …?" for unknown functions and names, and "Add CAST(… AS T)" for a type mismatch.
- `registerMinab(monaco, { client })` from `@shamsine/minab/monaco` gives a Monaco editor the Minab language: highlighting, brackets, comments, error markers with stable codes, completion, hover and signature help. The work runs in the browser worker, and the worker client gets `complete`, `hover` and `signatureHelp`.
- There is an embedding guide for NestJS and browser apps, a generated API reference (`npm run docs:api`), and one index page for all documentation. The public API now has doc comments, and the README has a "Use Minab from your app" section.
- A Shamsine integration guide (`docs/guides/shamsine.md`) shows how to connect Minab to Shamsine: a field type mapping for all 47 field types, schema, names, inputs, tiers, messages in Persian, Arabic and Turkish, and stored expressions.
- Node apps can give Minab their database with `queryFunctionDataPort` (TypeORM, Prisma) or `pgDataPort`, and set a time zone with `systemClock`. The package now loads with `require` too (CommonJS, Jest, NestJS), and with Bun.
- NestJS apps can import `MinabModule` from `@shamsine/minab/nestjs` and get `MinabService` (prepare, run, run a stored program by id), an exception filter that answers with HTTP statuses and codes, a logger that is off in production, and an optional run endpoint that speaks the wire format and runs stored programs only.
- A NestJS example app in `examples/nestjs` shows stored rules in a request transaction, a stored query and the run endpoint, with end-to-end tests against Postgres.
- `createWorkerMinab` runs Minab in a Web Worker with the same `prepare` and `run` as the server API. The worker can call ports that live on the main thread (data, host functions, clock, events), and a run can be cancelled with an `AbortSignal`.
- `createRemoteMinab` runs stored programs on a server by id, with batching and cancellation. `routeByTier` runs programs that need no data in the browser worker and sends the others to the server. `consoleEventSink` shows logs in the browser console, and `@shamsine/minab/browser/pglite` gives an optional in-browser database for demos.
- `examples/browser` shows Minab in a web app: a form checked in the browser with no network call, a rule that needs data sent to a NestJS server by program id, and a Monaco editor with highlighting, error markers and completion. Playwright tests run it in a real browser.
- `serveMinab` takes host `requests` and can `emit` events, and `createWorkerMinab` gets `request` and `onEvent`, so an app can keep its own work in the Minab worker. A worker file that imports the worker entry and calls `serveMinab` no longer runs two servers.
- Names can use any language (Persian, Arabic, Turkish and more) and names with spaces or symbols can be written in backticks, like `.`Order date``. A schema can give a table or column a `sqlName`, the name used in the database; result rows keep the Minab names.
- The `\` operator divides whole numbers and cuts toward zero (`7 \ 2` is `3`, `-7 \ 2` is `-3`), and a `GROUPBY` key can have a name (`GROUPBY .status AS s`).
- Built-in functions take several and optional arguments. New functions: `LOWER`, `UPPER`, `TRIM`, `LENGTH`, `SUBSTRING`, `REPLACE`, `STARTS_WITH`, `ENDS_WITH`, `CONTAINS`, `COALESCE`, `ROUND`, `ABS`, `FLOOR`, `CEIL`, `GREATEST` and `LEAST`. They give the same answer in the interpreter and in SQL.
- Date and time functions: `NOW`, `TODAY`, `YEAR`, `MONTH`, `DAY`, `HOUR`, `MINUTE`, `DATE_ADD` and `DATE_DIFF`, and `CAST(datetime AS DATE)` in the time zone of the run. A `DATETIME` is an instant, and every run has a time zone from the host clock. They give the same answer in the interpreter and in SQL, where `NOW()` is a bound parameter.
- `minab run` prints the output of `LOG` on stderr as `file:line:col label: value`, so `--json` output on stdout stays clean. `--no-logs` turns it off.
- `LOG(value, label?)` records a value while a program runs and returns it unchanged, so it can wrap any part of a rule. A call followed by `;` can now stand alone as a statement. A `LOG` inside a query prints nothing and gives the warning `call.logInSql`. Run results have `logs` and `logsTruncated`, and hosts get a `log` event for each line.
- A release is now one tag push: a workflow publishes the npm package, builds the VS Code extension and creates the GitHub release. Every merge to `main` can publish a `@shamsine/minab@next` prerelease for early integration.
- The package has a runtime API: `createMinab({ schema })`, then `prepare(source)` and `run`. It needs no Node, DOM or database driver. The package also lists all its entry points (`./node`, `./nestjs`, `./browser`, `./monaco`, `./lsp`, `./host`), and some are stubs for now.
- A host can declare typed inputs (such as `currentUser`) and typed functions (such as `fxRate`) in `createMinab`, and give their values and code to each run. A run also takes a clock, an event stream (statements and timing) and a data port.
- **Breaking:** A run stops at its limits (source length, nesting, time, statements, rows, function depth, loop iterations) and can be cancelled with an `AbortSignal`. Every failure is now a structured error with a stable code, a message, a source range and params. `run` returns `logs` and `stats`, and `compile` returns `{ ok: true, sql }`.
- A prepared program has an `analysis` that lists the tables, record fields, inputs and functions it uses, whether it needs data or writes, and its tier (`local` or `data`). `dependsOn(field)` tells which rules a field change affects.
- A versioned JSON wire format (v1) describes a batch of program runs and their results. It has exact value encoding (decimals as strings, dates as ISO 8601), request and response checks with stable `wire.*` error codes, JSON Schema files, and a reference page.
- A statement block inside a query refuses with the stable code `compile.blockInQuery`.
- Queries now accept `switch`, `if`, `is`/`isnot` and JSON object and list literals, and `FROM` can start from a filtered related collection such as `FROM .orders[.status == "paid"]`.
- New stable error codes: `query.unnamedGroupKey`, `query.keyNeedsName` and `query.functionNotInlinable`.
- `KEY.<name>` reads one key when `GROUPBY` has several keys, and a simple user function (one expression, no `let`, no recursion) can be called inside a query. Any other function in a query is a `check` error.
- Blocks with statements, function bodies with statements, assignment to local names (`=`, `+=`, `-=`, `*=`, `/=`, `?=`, `|=`) and `if!` now run. A function that calls itself too deeply stops with `limit.callDepth`.
- All three loop forms run, with `break` and `continue` (also with labels). `.$index` gives the position of an array element, and tuples run. Each loop step counts toward the loop limit.
- `INSERT`, `UPDATE` and `DELETE` on tables now run, as parameterized SQL in one transaction per run, with affected-row counts. A host chooses `writes: 'dry-run'` or `'apply'` (there is no default), `minab run` is a dry run unless you give `--apply`, and a validation rule cannot write (`rule.writeInRule`).
- Writes now cover the whole language. `INSERT`, `UPDATE` and `DELETE` work on a `JSON` array column (read, change in memory, write back with one `UPDATE`, with positions such as `DELETE .tags[2]` and `.$index`). Assignment through a record path runs too: `.doctor.id = 21;`, `.doctor!.name = "x";` (creates the missing record), `.doctor |= { … };` (merges) and filtered paths such as `.patients[.age > 60].active = true;`. A `!` that cannot create its record fails with `eval.cannotCreateRecord` and the run is rolled back.

### Changed

- `minab check --json` prints the diagnostics as JSON, with each `code`, also when the program has errors (`"ok": false`). It printed nothing to stdout in that case before.
- **Breaking:** `DECIMAL` values are exact in the interpreter, so `0.1 + 0.2 == 0.3` is `true`. A `DECIMAL` result now leaves Minab as a string in its shortest exact form (`"0.3"`, `"170"`), also in `minab run --json`. `INTEGER` results stay numbers.
- **Breaking:** `+` joins two texts (`"Ada" + " " + "Lovelace"`), in the interpreter and in SQL. `/` always gives a `DECIMAL` with 16 digits after the point, so `7 / 2` is `3.5` everywhere. `/` and `%` by zero are the error `eval.divisionByZero`.
- `TEXT` and `CITEXT` now compare without a `CAST`: `.email == "Ada@Example.COM"` ignores case when `.email` is `CITEXT`, in the interpreter and in the compiled SQL. `LIKE` follows Postgres in both: `%`, `_` and `\` as the escape, case-sensitive for `TEXT`.
- The language server uses the nearest `minab.config.json` for each file, so folders with different schemas are both checked correctly. A changed config is read again without a restart. Typing `.`, `#` or `(` gives completion, and hover, go to definition and signature help work.
- User functions are called by name, like built-ins: `discounted(200, 15)`. The `&` prefix is gone. A function name needs a lowercase letter, and a `let`, a parameter or a table may not reuse a function's name.
- **Breaking:** A second `let` with the same name in the same scope, and `!` on a collection step of an assignment path, are now errors (`scope.duplicateLet`, `type.vivifyOnCollection`). Comparing a relation with a key (`.customer == x`) is the error `type.relationComparedToKey`, which names the long form `.customer.id`.
- **Breaking:** `CAST(text AS DATETIME)` and `CAST(date AS DATETIME)` now give an instant (ISO 8601 UTC text). A zone in the text is used; without one, the text is read in the run's time zone. Before, the zone was ignored.
- **Breaking:** Minab needs Node.js 22.12 or newer (`engines.node` is `>=22.12.0`).
- Many schemas now share one parser, so 50 cached schemas use about half the memory and a new schema prepares in about 3 ms instead of 39 ms. Speed and size budgets are checked in CI, and `docs/performance.md` explains them.
- The `minab` command now runs on the runtime API, and `minab run --json` prints the stable error `code` (and `range`) of a failed run. The Postgres data port is exported as `pgDataPort` from `@shamsine/minab/node`.

### Removed

- **Breaking:** A schema no longer has a `functions` list. Declare host functions with the `functions` option of `createMinab`. A host config that still has `schema.functions` gets an error that says so.

### Fixed

- **Breaking:** `CAST` now converts values in the interpreter, exactly as the compiled SQL does: `CAST(3.5 AS INTEGER)` is `4`, `CAST(" 12 " AS INTEGER)` is `12`, `CAST(2.50 AS TEXT)` is `"2.5"`. A value that cannot convert fails with the error `eval.castFailed`. Spec §5.5 lists every rule.
- `check` accepts a collection filter at the top of a rule, such as `COUNT(.orders[.status == "cancelled"]) < 5`. It uses the host's `recordTable` to find the table of `.`.
- `GROUPBY` on a field of a related record, such as `GROUPBY .customer.country`, now compiles to SQL that Postgres accepts and returns the right rows.
- `check` now reports an unknown name, a bad `^` or a broken subquery even when it sits inside another expression. Before, such a program could pass `check` and then fail. `ORDERBY` may use any expression over the source row, or a `SELECT` alias.
- Every Minab example in the spec and the showcase now parses, and most are type-checked by a test. Four examples that contradicted the grammar are fixed, and showcase §14 now defines `daysSincePayment`.
- A negative number literal such as `-5` now compiles to SQL when it is an argument or an operand. Before, Postgres refused it (`operator is not unique: - unknown`).

### Security

- A program with thousands of `%` in a `LIKE` pattern, or thousands of `-`, `+` or `NOT` in a row, no longer crashes or hangs the host: `LIKE` no longer overflows the stack, and a deep run of prefix operators is the error `limit.tooDeep`. Security notes for hosts and a security policy are new.

### Known limitations

This is what does not run or does not check yet. Each item fails with an explicit error or warning, unless it says otherwise.

- **Functions in a query.** A user function can be called inside a query only when its body is one expression: no `let`, no statements, no recursion. Any other function is a `check` error (`query.functionNotInlinable`). A host function, or a function that is not inlinable, in the value of an `INSERT` or `UPDATE` fails with `compile.notSql`.
- **Statements and `LOG` in a query.** A statement block inside a query is refused with `compile.blockInQuery`. A `LOG` inside a query prints nothing and gives the warning `call.logInSql`.
- **Several `GROUPBY` keys.** `KEY.<name>` reads one key. A bare `KEY` has no value when there are several keys.
- **Some writes.** Assigning through a member of a local `JSON` variable (`j.a = 1`) is a `check` error. A relation step after a to-many step in a write path (`.patients[…].doctor.name = "x";`) is refused with `compile.writePath`. A filter on the fields of a `JSON` array element (`.tags[.k == "a"]`) does not check yet (`scope.columnNeedsTable`); positions and `.$index` work.
- **A dry run does not see its own writes.** In a dry run, a later read in the same program does not see an earlier write, except for `JSON` array columns. A program that depends on its own writes can give another answer than with `--apply`. No error or warning tells you.
- **`is null` on a `JSON` column.** A `JSON` column that holds the JSON value `null` is `null` in the interpreter, but not in SQL. No error or warning tells you.
- **The config file.** `minab.config.json` cannot declare host functions or host inputs yet, so the CLI and the language server use none. Hosts declare them with `createMinab`.
- **PostgreSQL only.** The compiled SQL targets PostgreSQL.
- **Requires Node.js 22.12 or newer.**

### Playground

- The playground runs on the same browser worker bridge as apps, and a run that you replace is stopped in the worker.
- The playground has a Console tab next to Execution. It lists the lines a program logged with `LOG`. Clicking a line selects the call in the editor.
- The playground engine checks, compiles and runs programs through the runtime API. A run now stops at the runtime limits (a run may use up to 10 seconds).
- The playground footer now links the author's name to the author's portfolio.
- The playground workbench has a new design: a dark-first theme with a light option, a new mark and wordmark, a new top bar, toolbar, output tabs, host panel and overlays, and Geist and JetBrains Mono fonts that load from the site itself.
- The landing page, tour, example gallery, reference, embed view, 404 page and error page have the new design, in light and dark, and they work on a phone. The landing demo shows loading, rule and type-error states.
- The playground website is deployed from `main` to Cloudflare Pages, with preview deploys for pull requests and long caching for the large database files. The footer shows the Minab version. Lighthouse, accessibility and smoke checks run in CI, and they led to small fixes: keyboard focus on code blocks, a name for the tour progress bar, and better contrast for string and key colors in the light theme.
- The playground runs loops, `.$index` and tuples, and the `overdue-loop` example runs.

[0.2.0]: https://github.com/shams-app/minab/releases/tag/v0.2.0
