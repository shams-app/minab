# src/runtime

The runtime API of Minab (production plan R2, ADR 0002). One API for the CLI,
the playground, NestJS and the browser. It does not use Node, the DOM or a
database driver. A test checks the imports.

## Files

- `index.ts`: the public exports (the package entry `.`).
- `minab.ts`: `createMinab({ schema, functions?, inputs?, ruleContext?, limits?, mode?, serviceCacheSize? })`.
  It returns `{ prepare, cacheStats, dispose }`. `functions` and `inputs` are the host's
  declared functions and inputs (D27). They are checked here: a bad name or type word
  throws a `HostDeclarationError`.
- `ports.ts`: the ports a host implements and gives to each `run`: `DataPort`, `WritePort`
  (one transaction for the writes of a run, X5), `HostFunctions`, `ClockPort`, `EventSink`, and the event types.
- `limits.ts`: the `Limits` and their defaults (D36), `resolveLimits`, `tightenLimits`, and `RunBudget`,
  which counts what one run uses and stops it at a limit or an abort.
- `log-format.ts`: `formatLogValue` and `formatLogMessage`: the one-line text of a `LOG` entry (D37). Newlines are escaped.
- `errors.ts`: builds run errors from the registry, and maps a data port failure to a code.
- `prepare.ts`: `prepare` and the `PreparedProgram` it returns: `diagnostics`, `ok`,
  `kind`, `resultType`, `analysis`, `dependsOn()`, `compile()`, `run()`. Also the `expect` check.
- `analyze.ts`: program analysis (R5). `analyzeProgram` builds `PreparedProgram.analysis`
  from the AST and the schema. It never runs the program.
- `service-cache.ts`: Langium services, cached by schema version, rule context and host declarations.
- `program-kind.ts`: tells a query from a rule from a value, and finds the result
  type. The playground uses it too.
- `wire.ts`: wire format v1 (R6): request and response types, `parseRequest`, `parseResponse`,
  `encodeValue`, `decodeValue`. See `docs/reference/wire-format.md`. The JSON Schema files are in `schemas/`.
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
| `hostFunctions` | Called names that are not built-ins and not declared in the program. One that is not declared `local` makes `needsData` true. |
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

## Results and errors

`run` never throws for a failed program.

```ts
// run
{ ok: true, value, logs: string[], logsTruncated?: true, stats: { statements, rows, durationMs } }
{ ok: false, error: { code, message, range?, params } }

// compile
{ ok: true, sql: { text, params } }
{ ok: false, error: { code, message, range?, params } }
```

- `code` is stable and is in the registry (`docs/reference/diagnostics.md`). A host maps by code and
  never parses `message`. The message is English (D35). A host translates by `code` and `params`.
- `range` is the part of the source that failed (0-based, like the language server). The innermost
  failing expression sets it: for `1 + CAST("12a" AS INTEGER)` it is the `CAST`.
- `params` are JSON-safe values: `{ limit: 100 }`, `{ name: 'currentUser' }`, `{ sqlstate: '22012' }`.
- `logs` holds the lines of `LOG(value, label?)` (L7), one line each (`label: value`, newlines escaped, D37), in order. A run keeps at most the `logEntries` limit (100 by default). When more were made, the extra ones are dropped and `logsTruncated` is `true`. This is not an error. Each kept line also goes to `ports.events` as a `log` event with `message`, `value`, `label`, `range` and `time`. `logsTruncated` is not in the wire format yet.
- **The SQL text is never in an error.** A host that wants it reads the `statement` event.
- A failure of the data port is `data.error`. `params.sqlstate` is set when the driver error has a
  five-character `code`. The driver's own message is not copied. SQLSTATE `22012` is
  `eval.divisionByZero`, and `22P02` and `22003` are `eval.castFailed`, so both runtimes give the same code.
- A host function that throws is `eval.hostFunctionFailed`. Its message is not copied either.
- A failure with no special code is `eval.failed` (`params.reason` has the text). A refusal of the
  compiler with no special code is `compile.notSql`.

| Area | Codes | Meaning |
|---|---|---|
| `eval.*` | `divisionByZero`, `castFailed`, `integerOutOfRange`, `missingInput`, `hostFunctionMissing`, `hostFunctionFailed`, `writesNotSupported`, `cannotCreateRecord`, `programInvalid`, `failed` | The program failed while it ran |
| `compile.*` | `programHasErrors`, `nothingToCompile`, `notSql`, `hostFunctionInSql`, `blockInQuery` | The program cannot become SQL |
| `limit.*` | see below | A limit stopped the program |
| `data.*` | `error`, `noPort` | The data port failed or is missing |
| `cancelled` | | The host aborted the run |

## Limits

Limits are always on (D01). `createMinab({ limits })` sets them. A run can only be tighter:
`run(…, { limits })` takes the smaller of its value and the host's. A limit must be a number above zero.

| Limit | Default | Checked | Code |
|---|---|---|---|
| `sourceLength` | 64 KB (UTF-8 bytes) | `prepare`, before parsing | `limit.sourceTooLong` (a diagnostic) |
| `nestingDepth` | 200 | `prepare`: a bracket scan before parsing, then the depth of the expressions | `limit.tooDeep` (a diagnostic) |
| `wallTimeMs` | 1,000 | `run`: between steps, and around every port call | `limit.timeout` |
| `statements` | 100 | before each data call | `limit.tooManyStatements` |
| `rowsPerStatement` | 10,000 | after each data call | `limit.tooManyRows` |
| `loopIterations` | 100,000 | each loop step, over all loops (X4 calls `RunBudget.countIteration`) | `limit.tooManyIterations` |
| `callDepth` | 64 | each user `fn` call | `limit.callDepth` |
| `logEntries` | 100 | when an entry is made (L7) | extra entries are dropped and counted |
| `batchRuns` | 100 | the run endpoint (H2) | |

A program that a prepare-time limit stops has one error diagnostic and no analysis. `run` and
`compile` refuse it.

## Cancellation

`run(…, { signal })`. A signal that is already aborted ends the run with `cancelled` before any port is
called. Otherwise every port call gets **one** signal that joins the host's signal and the wall-time
timer, and the interpreter checks it between steps. The run also stops *waiting* for a port call when
the signal aborts, so a host function that ignores the signal cannot hold the run past its wall time.
A statement that is already running in the database stops only if the data port passes the signal on
to its driver. The timer is cleared when the run ends.

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

- A run gets its inputs (`record`, `fieldValue`, `hostInputs`) and its ports (`data`, `write`,
  `hostFunctions`, `clock`, `events`). Inputs are given. Ports are asked.
- A `statement` event goes out just before each data call. The duration comes in the
  `timing` event (`phase: 'data'`) after it. The whole run ends with `timing` `run`. A sink
  must not throw: the runtime drops a throw.
- The clock is read once for each run. The default is the system clock in UTC.
- Host functions run in the interpreter only. `compile()` refuses them with
  `compile.hostFunctionInSql`.
- `expect` is optional. Without it nothing is checked and the program may return any type;
  `resultType` still reports the type.

## Writes (X5, D26)

- A program with `INSERT`, `UPDATE` or `DELETE` needs `run(inputs, ports, { writes })`. `'dry-run'` collects the statements
  and runs none. `'apply'` runs them in one transaction of `ports.write`. There is no default: a missing choice is
  `eval.writeModeMissing`, before any port is called. A program that does not write ignores the option.
- In an applied run the reads share the transaction, so they see what the run wrote. Any failure rolls everything back.
- The result has `writes: { mode, statements: [{ sql, params, range, rowCount? }] }` and `stats.writes: { statements, rows }`.
  Writes count toward `limits.statements`. The event `dryRun` comes when a dry run collects a write; an applied write sends `statement`.
- A record rule or field rule cannot write: the checker reports `rule.writeInRule`.

## Not done yet

- A `QueryExecutor` (one argument) still fits the data port. The CLI (R7) and the playground (R8)
  use `DataPort`.
- The HTTP endpoint is built (H2, `src/nestjs/`). The browser client (H5) is not built yet.
