# test/editor

Tests for `src/editor/` (production plans E1 and E3).

- `support.ts`: `diagnose()` (the diagnostics, built like the server builds them), `applyEdits()`, a schema (`Order`, `Customer`, a Persian column name, a column with a SQL name), `setup()` for the services of one host (with or without host declarations), and `cursor()`. A test source has one `|` for the cursor, for example `.cus|tomer`.
- `complete.test.ts`: columns, tables, aliases, names in scope, built-ins, host inputs and functions, keywords.
- `hover.test.ts`: columns, functions, built-ins, host names, `#alias`, keywords.
- `definition.test.ts`: aliases, `fn`, parameters, `let`, loop variables.
- `signature-help.test.ts`: built-ins, user functions, host functions, the active parameter.
- `symbols.test.ts`: `fn` with parameters, `let`, aliases, order.
- `references.test.ts`: find references, rename (names, quoting, rule refusals, capture), prepare rename.
- `semantic-tokens.test.ts`: sigils, keywords, built-ins, user and host functions, host inputs, fields, aliases.
- `quick-fixes.test.ts`: "Did you mean …?" and "Add CAST(… AS T)". Each test applies the fix and checks the diagnostic is gone.
