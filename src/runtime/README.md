# src/runtime

The runtime API of Minab (production plan R2, ADR 0002). One API for the CLI,
the playground, NestJS and the browser. It does not use Node, the DOM or a
database driver. A test checks the imports.

## Files

- `index.ts`: the public exports (the package entry `.`).
- `minab.ts`: `createMinab({ schema, ruleContext?, limits?, mode?, serviceCacheSize? })`.
  It returns `{ prepare, cacheStats, dispose }`.
- `prepare.ts`: `prepare` and the `PreparedProgram` it returns: `diagnostics`, `ok`,
  `kind`, `resultType`, `analysis`, `dependsOn()`, `compile()`, `run()`. Also the `expect` check.
- `analyze.ts`: program analysis (R5). `analyzeProgram` builds `PreparedProgram.analysis`
  from the AST and the schema. It never runs the program.
- `service-cache.ts`: Langium services, cached by schema version and rule context.
- `program-kind.ts`: tells a query from a rule from a value, and finds the result
  type. The playground uses it too.
- `types.ts`: the public types.

## Analysis (`prepared.analysis`)

Found at prepare time. Every list is sorted and has no duplicates.

| Field | Meaning |
|---|---|
| `tables` | Tables the program can read: `#T`, `FROM T`, joins, and the target of every relation column it uses. |
| `recordFields` | First step of each path read from the record under validation. `.a` gives `a`. `.customer.name` gives `customer`. |
| `dependencies` | `recordFields` plus the foreign key of each `ref` relation read (`customer` also depends on `customer_id`). |
| `readsWholeRecord` | `.` or `^` alone is read, so any field can matter. |
| `readsFieldValue` | `$` is read. |
| `inputs` | Names that are not a variable, parameter, alias or loop variable. The host must give them. |
| `hostFunctions` | Called names that are not built-ins and not declared in the program. |
| `userFunctions` | Functions declared in the program and called, also through other functions. |
| `builtins` | Built-in functions called. |
| `needsData` | The program can reach the data port: a table read, a relation column, a query, DML, a host function that is not local. |
| `writes` | `INSERT`, `UPDATE`, `DELETE`, or an assignment to a record path (not to a local variable). |
| `tier` | `local` when `needsData` and `writes` are both false. Otherwise `data`. |

`prepared.dependsOn(field)` tells if a change of that record field can change the result. Use it to
re-run only the rules a change affects. It is true for every field when the program reads the whole
record. It does not look at other tables: a rule that reads data may change when the data changes.

**The conservative rule.** When the analysis cannot be sure, it says `data`, never `local`. A wrong
`data` costs a network call. A wrong `local` gives a wrong answer. In detail:

- Both branches of `if` and `switch` count, even the one a run does not take.
- Analysis follows calls into user functions. A call inside its own body adds nothing new.
- A program with a syntax error gets the safe answer: `data`, `writes`, whole record.
- A field read with no record table is `data`: it cannot be told from a relation.
- Any query (`FROM ...`) and any DML is `data`.
- A call whose callee is not a plain name is `data`.
- A test runs every spec, showcase and example program that is called `local` with a data port
  that fails when it is called.

## Rules

- `prepare` never throws for a bad program. It returns diagnostics. It rejects only for
  a bad call (a disposed runtime, a source that is not a string).
- `run` never throws for a failed program. It returns `{ ok: false, error }`.
- Each `prepare` uses its own document URI and removes the document when done. A
  prepared program holds the AST, the interpreter and the compiler, and nothing of
  the workspace.
- Services are cached by `schema.version` (or a hash of the schema when it is
  missing). Two schemas with the same version must be the same schema.
- `mode` is `production` by default. `development` re-checks the grammar on every
  parser build and is slow (about 2.8 s per service set).
- Do not import `node:*`, `langium/node`, `vscode-languageserver/node` or `pg` from here.

- `expect` is optional. Without it nothing is checked and the program may return any type;
  `resultType` still reports the type.

## Not done yet

- `run` takes today's `QueryExecutor` as its data port. R3 adds the full ports.
- `limits` are stored, not enforced. R4 enforces them.
- The wire format (R6) comes later.
- Host functions are not declared yet (R3). Until then `localHostFunctions` names the ones that
  need no data, and a call to any other name is a host function that needs data.
