# test/fuzz

Property tests with `fast-check` (phase Q3, decision D09). They look for inputs that make Minab throw, hang or
break a limit.

## Files

- `support.ts`: the fixed seed and the number of cases (`fuzzParams`).
- `prepare.test.ts`: `prepare` never throws and ends in under 200 ms, for random tokens, random text and mutated
  programs from the spec, the showcase and the examples.
- `run.test.ts`: random well-typed expressions run on PGlite with tight limits. Every run ends with a value or a
  coded error, and not later than the wall time plus 50 ms.

## Rules

- The seed is fixed (`20261004`), so a failure on CI can be repeated. `fast-check` prints the seed, the path and the
  smallest input that fails. `MINAB_FUZZ_SEED` changes the seed.
- CI (the `CI` variable is set) runs 2,000 cases for each property. A local run uses 200. `MINAB_FUZZ_RUNS` sets any
  number: `MINAB_FUZZ_RUNS=20000 npx vitest run test/fuzz`.
- A bug that a fuzz test finds gets its own regression test in `test/security/` (or in the test file of that code). Do
  not only fix the seed.
- The `run` generator is small: arithmetic, comparisons, `IN`, `LIKE`, aggregates over `Order`. Add a rule to it when
  a new construct can fail at run time.
