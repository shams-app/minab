# Changelog

## 1.0.0

Minab 1.0 is stable: within 1.x, valid programs, the diagnostic codes and the extension's settings keep working.

- `COUNT` accepts a `JSON` value and counts the elements of an array (it is `0` for anything else). `CAST` of a `JSON` text to `TEXT` or `CITEXT` now works and gives the text without quotes. A `JSON` cast that does not fit fails with `eval.castFailed` in PostgreSQL too, as it does in the interpreter.
- You can read a key of a `JSON` value: `.location.lat`, `.attachment["name"]`, `.timeTracking.sessions[0]`, and `url.tab` for a `JSON` host input. A key has the type `JSON`, so you `CAST` it to compare it. A missing key, a key of a value that is not an object, and a JSON `null` are all `null`. The interpreter and PostgreSQL give the same answer.
- **Breaking:** Literal-only parts of an expression, such as `.total > 50 + 50` or `.price * (1 + 0.2)`, now run in Postgres. Before, Postgres refused them, or compared two literals as text. `is array`, `is object`, `is string`, `is number` and `is boolean` on a value that is not `JSON` are now the check error `type.kindTestNeedsJson`. `is null` still works on every type. A user function that reads `.`, `^` or `#alias` can no longer be used inside a query: `check` reports `query.functionNotInlinable`.
- **Breaking:** A `null` value now gives one answer in the interpreter and in the compiled SQL. Arithmetic with a `null` operand gives `null` (also `null / 0`), and `<`, `<=`, `>`, `>=` and `LIKE` with a `null` operand give `false` instead of an error. `IN` is never `null` in SQL (`null IN [1, null]` is `true`), `IN` with a subquery now runs in the interpreter, and a JSON `null` counts as `null` for `is null` and `== null`.
- `ALL` and `ANY` now run inside a query and over a table (`FROM Customer WHERE ALL(.orders.paid)`). `GROUPBY` on a path through a relation now runs when `SELECT` writes the same path again, and when the key is a record (`GROUPBY .customer.region SELECT KEY.name`). `IN` and `switch` over only literals give the same answer in SQL as in the interpreter. `MIN` and `MAX` over the rows of a group accept text and dates and skip `null`. `check` now reports a branch of an `if` or `switch` that has no value (`type.blockNoValue`) and an unknown table after `FROM` (`scope.unknownTable`).
- **Breaking:** The type of an `if` or a `switch` now describes every branch: it may be `null` when a branch may be `null` (`if .a > 10 { 1 } else { null }` is `INTEGER?`), and `INTEGER` with `DECIMAL` is `DECIMAL`. Such a `DECIMAL` result, and one from `COALESCE` or `GREATEST`, now leaves the run as text (`"4"`, not `4`), like every `DECIMAL`. `x += v` with a `null` on either side gives `null`, as `x = x + v` does, instead of an error. In SQL, `CAST(… AS INTEGER)` now accepts whole numbers above 2,147,483,647 and a decimal literal (`CAST(2.5 AS INTEGER)` is `3`), and `"a" is null` no longer fails in Postgres.

## 0.3.0

- The VS Code extension is ready for the Marketplace: snippets, an icon, the settings `minab.configPath` and `minab.trace.server`, a status bar item that names the config file in use, the command "Minab: Restart Language Server", and a new README. A new `minab-lsp` command starts the language server for Neovim, Helix and Zed (see `docs/editors.md`).

## 0.2.0

The first public release of the extension: syntax highlighting, live diagnostics, and hover and go-to-definition for `.minab` files, with the language server bundled into the extension. See the [project changelog](https://github.com/shams-app/minab/blob/main/CHANGELOG.md) for the full history.

- Every diagnostic has a stable code, for example `type.implicitCoercion`.
- The server uses the nearest `minab.config.json` for each file, and reads a changed config again without a restart.
- Completion (type `.`, `#` or `(`), hover, go to definition and signature help work, also for called functions.
- The server shows an outline of functions, lets, parameters and aliases, finds references and renames them, colors names by meaning (semantic tokens), and offers quick fixes ("Did you mean …?" and "Add CAST(… AS T)").
- Names can use any language (Persian, Arabic, Turkish and more), and names with spaces or symbols can be written in backticks.
- User functions are called by name. The `&` prefix is gone.

[1.0.0]: https://github.com/shams-app/minab/releases/tag/v1.0.0
[0.3.0]: https://github.com/shams-app/minab/releases/tag/v0.3.0
[0.2.0]: https://github.com/shams-app/minab/releases/tag/v0.2.0
