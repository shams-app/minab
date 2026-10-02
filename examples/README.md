# examples

Complete, working Minab programs. Each folder holds one program and the
`minab.config.json` that it runs against. `test/examples.test.ts` runs every one
through the real CLI.

## One folder per example

```text
examples/<name>/
  <name>.minab        the program
  minab.config.json   the schema and the canned data it runs against
  expected.json       what the test expects (see below)
```

## expected.json

Each example keeps its own expected result, so two phases that change
different examples never edit the same file.

A run example:

```json
{ "mode": "run", "json": [{ "id": "o-104" }], "statements": 1, "compiles": true }
```

- `json` is what `minab run --json` prints.
- `statements` is how many statements reach the data source (`--trace`).
- `compiles` is `true` when `minab compile` prints SQL, and `false` when the
  program is run by the interpreter.

A check-only example (a construct that `minab run` does not execute yet):

```json
{ "mode": "check-only", "refusal": "\"LoopStatement\" is not executed yet" }
```

- `refusal` is the source of a regular expression that the `minab run` error must match.

## Rules

- A folder that contains `<folder name>.minab` must have an `expected.json`.
  If it does not, `test/examples.test.ts` fails.
- A folder without a `.minab` program of its own name is not an example and is
  ignored. Later phases add `examples/nestjs` and `examples/browser` this way.
- The program starts with a comment that says how to run it. A check-only
  program also says `CHECK-ONLY` in that comment.
- A new example is also listed in the table of the root `README.md`.
