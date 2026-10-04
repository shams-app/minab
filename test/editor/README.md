# test/editor

Tests for `src/editor/` (production plan E1).

- `support.ts`: a schema (`Order`, `Customer`, a Persian column name, a column with a SQL name), `setup()` for the services of one host (with or without host declarations), and `cursor()`. A test source has one `|` for the cursor, for example `.cus|tomer`.
- `complete.test.ts`: columns, tables, aliases, names in scope, built-ins, host inputs and functions, keywords.
- `hover.test.ts`: columns, functions, built-ins, host names, `#alias`, keywords.
- `definition.test.ts`: aliases, `fn`, parameters, `let`, loop variables.
- `signature-help.test.ts`: built-ins, user functions, host functions, the active parameter.
