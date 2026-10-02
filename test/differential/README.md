# Differential tests

One Minab expression runs twice: in the interpreter and as SQL in Postgres.
The test fails when the two answers differ.

## Files

- `harness.ts`: runs a case on both runtimes and compares the answers.
  Also exports `ITEM_SCHEMA`, a table with one column of every common type.
- `differential.test.ts`: loads every `cases/*.cases.ts` file. Do not edit it.
- `harness.test.ts`: checks that the harness fails when it should.
- `cases/`: the case files.

## How to add a case

1. Make a file `cases/<ID>-<topic>.cases.ts`. One file for each phase and topic.
   The file name is the only thing you need: no shared file changes.
2. Export `cases`:

```ts
import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

export const cases: DifferentialCase[] = [{ name: 'integer addition', schema, record: { a: 7, b: 3 }, expr: '.a + .b', expect: 10 }];
```

## Case fields

- `name`, `expr`: the test name and the Minab expression.
- `schema`, `record`, `table`: the table and the one row that `.` means.
  A column you leave out gets a neutral value (`null` if it may be null).
  Without `schema`, the case has one table `One` and no record.
- `expect`: the answer both runtimes must give. For an error use `{ error: 'division-by-zero' }`.
- `knownGap: { card, note }`: a bug we know. The test asserts the two answers **differ**.
  The card that fixes the bug removes `knownGap` and adds `expect`.
  When a gap case starts to agree, the test fails with "gap fixed? remove knownGap".

## Rules

- Both runtimes must agree. `DECIMAL` is compared by exact value, dates as text, `null` equals `null`.
  Two errors agree when they mean the same (for example division by zero).
- Do not use only literals (`1 + 2`): the compiler binds them untyped and Postgres refuses `$1 + $2`.
  Use columns.
- Cases run one after another. Each case gets its own schema, so rows never leak.
- The database is PGlite. Set `MINAB_TEST_DATABASE_URL` to use a real Postgres.
