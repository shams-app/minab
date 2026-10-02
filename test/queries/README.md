# Query tests

Whole Minab queries run on Postgres. The test checks that `check` is clean
and that the rows are the expected rows.

## Files

- `harness.ts`: parses, checks, compiles and runs a program, then compares rows.
- `queries.test.ts`: loads every `cases/*.cases.ts` file. Do not edit it.
- `cases/`: the case files.

## How to add a case

Make a file `cases/<ID>-<topic>.cases.ts` (one file for each phase and topic) and export `cases`:

```ts
export const cases: QueryCase[] = [{ name, schema, rows, program, expectRows, ordered? }];
```

- `schema`: the host schema, as a JSON config writes it.
- `rows`: rows to insert, by table name. A `ref` column is filled through its `foreignKey` name (for example `customer_id`).
- `expectRows`: the rows the program must return. Column order does not matter.
  Row order matters only when `ordered: true` (use it with `ORDERBY`).
- `knownGap: { card, note }`: a known bug. The test asserts the rows differ today.

## Rules

- Each case gets its own schema, so rows never leak.
- The database is PGlite. Set `MINAB_TEST_DATABASE_URL` to use a real Postgres.
