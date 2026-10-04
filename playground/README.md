# Minab Playground

A website where you can write Minab, see it checked, see the SQL it compiles to, and run it against a **real PostgreSQL**. Nothing runs on a server:
- The whole Minab toolchain (Langium parser, validator and type checker, SQL compiler, hybrid interpreter) runs in a Web Worker.
- The database is [PGlite](https://pglite.dev), PostgreSQL compiled to WebAssembly.

| Route | What |
|---|---|
| `/` | Landing page with a live demo (snippets run against the engine; the SQL shown is compiled live) |
| `/play` | The workbench: Monaco editor, output tabs (Result · SQL · **Execution** · **Console** · Problems · AST), host panel (Schema · Data · Record · Field) |
| `/learn/:lesson` | A 12-lesson guided tour; each goal is checked against the real engine |
| `/examples` | 29 examples: the repository's 11 `examples/` plus 18 written for the playground |
| `/reference` | The cheat sheet (also a drawer inside the workbench) |
| `/embed` | A compact workbench for `<iframe>`s: `?example=…&theme=dark&tabs=result,sql&readonly=1&autorun=0`, or `#s=<share>` |

The visual design is a deliberate **wireframe**. The finished look comes from Claude Design. See [`design/README.md`](design/README.md) for the whole process and [`design/contract.md`](design/contract.md) for what a redesign may change.

## Run it

It needs Node ≥ 20. The playground compiles the language from `../src`, so the repository root needs its dependencies too:

```bash
npm install                 # in the repository root, once
cd playground
npm install
npm run dev                 # http://localhost:5173
```

The `predev`, `prebuild` and `pretest` scripts run `scripts/prepare.mjs`, which regenerates the Langium parser (`../src/language/generated/`) when it is missing or older than the grammar.

| Script | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm test` | Vitest (Node): the engine against in-process PGlite, every example, every lesson, the tokenizer, share links |
| `npm run build` | `tsc -b`, then a production bundle in `dist/` (plus a `404.html` copy for SPA hosting) |
| `npm run preview` | Serve `dist/` locally |
| `PLAYGROUND_BASE=/sub/path/ npm run build` | Build for hosting under a path (GitHub Pages, a portfolio sub-path) |

## How it's built

```
src/
  engine/     the Minab engine — runs in ONE Web Worker, no DOM
    engine.ts       check / compile / run through the runtime API (`src/runtime/`) → RunReport; two queues (language, database)
    language.ts     one `Minab` runtime per host (schema + rule context), and the syntax tree for editor intelligence
    program.ts      program info for the UI: kind and type from the runtime, check-only constructs and symbols from the syntax tree
    intel.ts        calls src/editor/ for hover, completion and go-to-definition; builds the AST view
    database.ts     PGlite: lazy boot, citext, JSON-shaped results, preview, SQL console
    ddl.ts          host schema + seed rows → CREATE TABLE / INSERT (also the exported seed.sql)
    protocol.ts     every type that crosses the worker boundary
    worker.ts       message router
  client/     the UI thread's promise API over the worker (restartable)
  state/      zustand store, the controller (debounced analyze, auto-run, host application), share links, persistence
  hooks/      view models: useWorkbench, useHost, useTour, useGallery, useShare, useCommands, useEngine, useTheme, useSnippet
  monaco/     Monaco, trimmed; Minab language + providers; theme generated from CSS tokens; lazy wrapper
  syntax/     one tokenizer for Monaco and every static snippet; SQL highlighter and pretty-printer
  content/    datasets (Brewline), examples, tour lessons, cheat sheet, landing copy, config JSON Schema
  ui/         presentational components — the part a redesign replaces
  routes/     pages: hooks in, ui out
  styles/     tokens.css (the design contract) + wireframe.css (the placeholder skin)
```

**Things worth knowing:**
- **Console (`LOG`).** The runtime sends a `log` event for each `LOG(value, label?)` (`src/runtime/ports.ts`). The engine collects them in `RunReport.logs`, and `ui/output/ConsoleView.tsx` lists them in order. Hovering a line highlights the `LOG` call; clicking selects it.
- **Hybrid execution, made visible.** The runtime sends a `statement` event, with the source range, just before each statement reaches the data port (`src/runtime/ports.ts`). The engine keeps each range, so the Execution tab can highlight exactly which span of the program became which SQL.
- **One parse serves everything.**
  - The engine answers `analyze` (diagnostics, program kind, compiled SQL) on every pause in typing.
  - It answers `run` on auto-run or ⌘↵.
  - Analysis runs on a language queue and execution on a database queue. So typing stays responsive while Postgres boots, and a rule that never touches the database never waits for it.
- **The host is the config.** The playground plays the host application: it supplies the schema, the rule context, the record and `$`. It uses the same JSON shape as the CLI's `minab.config.json`, parsed by the same code (`../src/host/config.ts`), plus a playground-only `seed`.
- **Storage choices, invisible to Minab source.**
  - `UUID` columns are stored as `text`, so demo ids stay readable (`cus-ada`).
  - There are no foreign-key constraints.
  - `numeric` and `bigint` come back as numbers; dates as strings.
- **Nothing drifts silently.**
  - The repo's examples are imported as raw files.
  - `test/tokens.test.ts` fails if the grammar gains a keyword the highlighter doesn't know.
  - `test/content.test.ts` runs every example, preset and lesson, and checks the starter doesn't already pass and the solution does.

## Adding content

- **An example:** add an entry to `src/content/examples/index.ts` with an `expect`. For a rule, add `presets` whose first entry matches the default record. Run `npm test`.
- **A lesson:** add a folder `src/content/tour/NN-slug/` with `lesson.md`, `starter.minab` and `solution.minab`, then register it in `src/content/tour/index.ts` with a `goal`. The test requires that the starter *doesn't* meet the goal and the solution does.
- **Demo data:** `src/content/datasets/demo.ts`. Order totals are computed from order lines. Keep the examples' `expect`s in mind; the tests will tell you.

## Known limits

These come from the language implementation, not the playground, and the site labels them as they occur:
- `INSERT`/`UPDATE`/`DELETE` are **check-only**. They parse and type-check, and the evaluator explains that it doesn't run them yet. Blocks, function-body statements, assignment to local names and `if!` run since X3. Loops, `.$index` and tuples run since X4.
- A top-level query that calls a user `fn` doesn't compile to SQL.
- Two compiler gaps found while building the gallery:
  - `GROUPBY .customer.country` (grouping by a traversed column) produces SQL Postgres rejects.
  - A bare rule that filters a collection (`COUNT(.orders[…]) < 5`) fails to check. This one is already in `docs/status.md`.

  The gallery sidesteps both; the equivalent `COUNT(#Order[.customer == ^ …])` works.
