# Performance

Minab has budgets for the speeds that matter to a host. CI checks them on every pull request that
changes `src/`. This page lists the numbers, what each one means for you, and how to profile.

Measured on Node 22, Linux x64 (a CI-like machine). Your machine will differ.

## The budgets

CI fails a row when it is **above its budget times 1.5** (the allowance for noisy machines). The size row
has no allowance, because a size does not change from run to run.

| What | Budget | Measured | What it means for a host |
|---|---|---|---|
| `prepare` a typical one-line rule, warm service cache (Node) | ≤ 5 ms median | 0.5 ms | Typing in a rule field can check the rule on every key press. |
| First `prepare` in a fresh process (new schema, `production` mode) | ≤ 150 ms | about 95 ms | The cost of the first rule after a start. It builds the parser. Do it at startup, not on the first request. |
| `prepare` with one more new schema, after the first | not budgeted | about 3 ms | A multi-tenant host pays little for each new schema (see "The parser is shared"). |
| `run` a prepared rule that needs no data (Node) | ≤ 0.05 ms median | 0.02 ms | A local rule is cheap enough to run for every row of a list. |
| Re-run 100 prepared local rules after one field changes (worker code, measured in Node) | ≤ 8 ms total | 5 ms | One frame is about 16 ms. A form with 100 rules stays inside it. |
| `run` a correlated rule with one data call (PGlite), without database time | ≤ 2 ms | 0.15 ms | Minab's own work around a data call is small. The database is the cost. |
| Browser worker bundle, gzip | ≤ 202,576 bytes (H5's 184,160 + 10%) | 189,121 bytes | The worker is mostly the parser (Langium). Load it lazily. |
| Language server completion on a 200-line file | ≤ 50 ms | about 46 ms | Completion feels instant. It parses the whole file each time. |
| Resident memory with 50 cached schemas | ≤ 200 MB | about 105 MB | 50 tenants fit in one Node process. |

The memory number is the whole process (Node and the code loaded, about 75 MB), not only Minab.

## Run the bench

```sh
npm run build          # the rows run the built code from out/
npm run bench          # prints a table, writes bench/results.json
npm run bench:check    # runs the bench, then fails when a row is above its limit
```

`bench:check` also writes the table to the job summary on GitHub Actions
(`.github/workflows/perf.yml`). The numbers and the rules for changing them are in
[`bench/README.md`](../bench/README.md).

## What changed in Q4

**The parser is shared.** The Langium parser (the Chevrotain tables and the lexer) was built again for every
schema. It is about 2 MB and has nothing of the schema in it. In `production` mode all service sets now share
one parser. Before: 50 cached schemas used about 203 MB, and a new schema cost about 39 ms to prepare.
After: about 105 MB and about 3 ms. The `development` mode still builds one parser per set, because grammar
work relies on its grammar check.

## Settings that matter

- **`serviceCacheSize`** (default 16): how many service sets a runtime keeps. One set is kept for each
  schema version, rule context and set of host declarations. A set costs about 1 MB without the shared
  parser. Give a multi-tenant host a size at least as big as the number of schemas it uses at once.
  When the cache is too small, the same sets are built again and again.
- **`schema.version`**: the cache key. Give every schema a version. Without one, Minab hashes the whole
  schema on every `prepare`. Two schemas with the same version must be the same schema.
- **`mode`**: keep the default, `production`. `development` re-checks the grammar and is slow (about 2.8 s per
  set). Use it for grammar work only.
- **Prepare once, run many times.** `prepare` parses and checks. `run` does neither. Keep the
  `PreparedProgram`, and use `dependsOn(field)` to re-run only the rules a change can affect.
- **Limits** (`wallTimeMs`, `statements`, ...) keep a bad program from using the host. They do not make a
  good program faster.

## How to profile

**Node.** Run your host or a bench row with the CPU profiler, then open the `.cpuprofile` file in
Chrome DevTools (Performance panel, "Load profile") or in VS Code:

```sh
node --cpu-prof --cpu-prof-dir=prof bench/rows/prepare-warm.mjs
```

For memory, run with `--expose-gc` and read `process.memoryUsage()` after `global.gc()`, as
`bench/rows/memory.mjs` does. `runtime.cacheStats()` shows the number of cached sets, hits and open documents.

**Browser worker.** Open Chrome DevTools, Performance panel, and record while you type. Pick the worker
thread in the flame chart. The main thread should show only message passing. In the Sources panel the
worker is under "Threads". `performance.mark` and `performance.measure` around `await program.run(...)` give
the time a rule needs, including the trip to the worker.

## Not measured yet

- A real Postgres over the network. The correlated row uses PGlite in the same process, so it shows
  Minab's own cost. A host that wants network numbers has to measure them against its own database.
- Set-based batch runs (after 1.0).
- Website scores (Lighthouse): phase W4.
