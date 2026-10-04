# Test support

Code shared by the test suites.

## Files

- `database.ts`: `openTestDatabase()`. PGlite in this process, or real Postgres when `MINAB_TEST_DATABASE_URL` is set.
  Same API for both: `exec`, `query`, `queryResult` (rows and the row count of a write), `executor`, `isolated`, `close`. It loads `citext` and pins the time zone to UTC.
  `numeric` comes back as a `Decimal`, `bigint` as a number, dates as text.
- `keywords.ts`: `ALL_KEYWORDS`, every alphabetic keyword of the grammar (read from the generated grammar).
- `minab.ts`: builds the language services for a schema, parses, checks and runs a program, and compares answers.

## Rules

- Open one database for each test file (in `beforeAll`), and close it in `afterAll`.
- Run each case with `db.isolated(...)`: it makes a new schema and drops it after.
