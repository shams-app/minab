# test/security

Tests that state a security claim of Minab (phase Q3, `docs/security.md`). A program written by an end user must
not hurt its host.

## Files

- `sql-injection.test.ts`: hostile table, column and `sqlName` values, and hostile string values, on PGlite. The
  queries work, nothing else runs, and no value is ever in the SQL text.
- `like.test.ts`: `LIKE` is fast on hard patterns, does not overflow the stack, and keeps its meaning.
- `prepare-limits.test.ts`: a 5,000-level program and a 1 MB source are coded diagnostics.
- `schema-surface.test.ts`: a table that is not in the schema is a scope error, and no data port is called.
- `../nestjs/security.test.ts`: the NestJS module takes the schema from the server, refuses source text and big batches,
  leaks nothing in errors, and keeps logs safe. It lives in `test/nestjs/` because that folder is compiled with the decorator options.

## Rules

- A test here names the claim in its title. If you change a claim, change `docs/security.md` too.
- Every bug found gets a test that fails without the fix. Undo the fix once and see it fail.
- The fuzz tests are in `test/fuzz/`.
