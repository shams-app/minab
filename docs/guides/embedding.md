# Embedding Minab in your app

This guide is for a developer who puts Minab inside an app: a NestJS server, a
browser app, or both. You do not need to read the source. Every code sample
here comes from the two example apps, which have tests:

- [`examples/nestjs`](../../examples/nestjs/README.md): a server (NestJS, TypeORM, Postgres).
- [`examples/browser`](../../examples/browser/README.md): a web app (Vite, a Web Worker, Monaco).

Other documents: the [language spec](../query-language-spec.md), the
[wire format](../reference/wire-format.md), the
[error codes](../reference/diagnostics.md), and
[ADR 0002](../adr/0002-runtime-ports.md) (why the runtime looks like this).
The full API is in the generated API reference (see [section 9](#9-the-api-reference)).

**Before 1.0 anything may break** (decision D38). Pin an exact version of
`@shamsine/minab`. From 1.0 on, the [compatibility rules](#8-limits-logs-security-and-versions) apply.

## Contents

1. [What Minab gives you, and what you give Minab](#1-what-minab-gives-you-and-what-you-give-minab)
2. [The API in ten lines](#2-the-api-in-ten-lines)
3. [The ports](#3-the-ports)
4. [Where programs run](#4-where-programs-run)
5. [Walkthrough: NestJS](#5-walkthrough-nestjs)
6. [Walkthrough: a browser app](#6-walkthrough-a-browser-app)
7. [Errors and codes](#7-errors-and-codes)
8. [Limits, logs, security and versions](#8-limits-logs-security-and-versions)
9. [The API reference](#9-the-api-reference)

## 1. What Minab gives you, and what you give Minab

Minab is a language for rules and queries. A **program** is text, for example
`COUNT(#Order[.customer == ^.customer AND .status == "open"]) <= 5`.
Your users write programs. Your app checks them and runs them.

**Minab gives you:**

- `prepare`: parse and check a program. You get diagnostics (with a stable
  code and a range), the type of the result, and an **analysis**: which tables
  and record fields the program reads, and whether it needs data (`tier`).
- `run`: run a prepared program and get a value, or a coded error.
- `compile`: the program as one SQL statement, when it is one.
- Editor help for Monaco: markers, completion, hover, signature help.
- A NestJS module with a run endpoint, and a browser client with a worker.

**You give Minab:**

| What | How | Who asks whom |
|---|---|---|
| The **schema**: the tables and columns a program may read | `createMinab({ schema })` | Given once. It is the whole read surface of every program |
| The **record** under validation, `$`, and **host inputs** (`currentUser`, `url`) | `run(inputs)` | Given with each run |
| The **database** | `ports.data` | Minab asks, when a program reads data |
| **Host functions** (for example `fxRate`) | `ports.hostFunctions` | Minab asks, when a program calls one |
| The **clock** and time zone | `ports.clock` | Minab asks, once per run |
| A place for **events** (logs, statements) | `ports.events` | Minab tells |

Minab never opens a database connection, never reads a file and never calls
the network by itself. Everything outside goes through a port.

## 2. The API in ten lines

```ts
import { createMinab } from '@shamsine/minab';
import { pgDataPort } from '@shamsine/minab/node';

const minab = createMinab({ schema, ruleContext: { isFieldRule: false, recordTable: 'Order' } });

const program = await minab.prepare('COUNT(#Order[.customer == ^.customer]) <= 5', { expect: 'boolean' });
if (!program.ok) return program.diagnostics; // each has `code`, `message`, `range`, `params`

const result = await program.run({ record }, { data: pgDataPort(pool) }, { signal });
if (result.ok) console.log(result.value, result.stats);
else console.error(result.error.code); // for example `limit.timeout`
```

- `createMinab` once. Keep the result. It caches the parser for each schema `version`.
- `prepare` once for each program, `run` as often as you like. A prepared
  program is safe to run many times, also at the same time.
- `prepare` does **not** throw for a bad program. It returns `diagnostics`.
  `run` does **not** throw for a failed program. It returns `{ ok: false, error }`.
  Both reject only for a bad call (a disposed runtime, source that is not text).
- `schema.version` names the schema. Two schemas with the same `version` must be
  the same schema. Change the schema, change the `version`.
- `ruleContext` says where the program sits: which table a bare `.` means, and
  whether `$` exists (and its type). Give it to `createMinab`, or to each `prepare`.
- `expect` is optional. It is one of `text`, `number`, `boolean`, `date`,
  `dateTime`, `list`, or `{ minab: 'INTEGER[]' }`. A program with another result
  type gets the diagnostic `type.unexpectedResultType`.
- Host functions and host inputs are declared at `createMinab`
  (`functions`, `inputs`). Their values and code come with each run.

## 3. The ports

Ports are plain TypeScript interfaces. None of them names Node, the DOM or a
driver. They are all in `@shamsine/minab`. Each `run` gets its own ports:
`run(inputs, ports, options)`. That is how a request's own transaction reaches
the program.

```ts
interface RunPorts {
    data?: DataPort;
    write?: WritePort;
    hostFunctions?: HostFunctions;
    clock?: ClockPort;
    events?: EventSink;
}
```

### Data port

```ts
interface DataPort {
    execute(query: SqlQuery, context: { signal: AbortSignal }): Promise<Row[]>;
}
interface SqlQuery { text: string; params: unknown[] } // `$1`, `$2`, ... placeholders
type Row = Record<string, unknown>;
```

Minab sends SQL text with Postgres placeholders. Values never go into the text.
Without a data port, a program that reads data fails with `data.noPort`.
Pass `context.signal` to your driver if it can cancel a statement.

Ready-made ports in `@shamsine/minab/node`:

| Function | Use it with |
|---|---|
| `pgDataPort(clientOrPool)` | `pg`. For a transaction, give the client that ran `BEGIN` |
| `queryFunctionDataPort((text, params) => rows)` | TypeORM, Prisma, or any function that runs SQL |
| `connectPostgres(url)` | Scripts and the CLI. It loads `pg` from your install |
| `systemClock(timeZone?)` | The real time, in an IANA zone (default `UTC`) |

`pg`, TypeORM and Prisma are never dependencies of Minab.
In the browser, `@shamsine/minab/browser/pglite` has a data port over PGlite.
It is for demos and playgrounds only (see [section 4](#4-where-programs-run)).

### Write port

```ts
interface WritePort {
    transaction<T>(work: (tx: WriteTransaction) => Promise<T>, context: { signal: AbortSignal }): Promise<T>;
}
```

The interface is fixed, but programs do not write yet. A run with a write
statement fails with `eval.writesNotSupported`.

### Host functions and host inputs

```ts
const minab = createMinab({
    schema,
    functions: [{ name: 'fxRate', params: [{ name: 'currency', type: 'TEXT' }], returns: 'DECIMAL', local: true }],
    inputs: { currentUser: { id: 'TEXT', roles: 'TEXT[]' }, url: 'JSON' }
});

await program.run(
    { record, hostInputs: { currentUser: { id: 'u1', roles: ['admin'] }, url: { tab: 'open' } } },
    { hostFunctions: { call: (name, args, { signal }) => (name === 'fxRate' ? rates[args[0] as string] : undefined) } }
);
```

- A host **input** is a typed, read-only name (`currentUser.id`). You give its
  value in `RunInputs.hostInputs`. A declared input with no value is the run
  error `eval.missingInput`.
- A host **function** runs only in the interpreter, never in SQL. A program that
  calls one cannot be compiled to a single statement (`compile.hostFunctionInSql`).
  Its name needs a lowercase letter, so it can never collide with a built-in.
- `local: true` says the function is safe in the browser. A program that calls a
  function that is not `local` has tier `data`.
- Minab checks the argument count before the call and the result type after it.
  Minab does not check what your function does. Write it as if every argument is hostile.
- A function that throws is the run error `eval.hostFunctionFailed`. The message of
  your error is not copied into the result.

### Clock

```ts
interface ClockPort { now(): Date; readonly timeZone: string }
```

Minab reads it once for each run, so every `NOW()` in a run gives the same
instant. The default is the system clock in UTC. Tests pass a fixed clock.

### Events

```ts
interface EventSink { emit(event: MinabEvent): void }
// MinabEvent: { kind: 'statement', sql, params, range? }
//           | { kind: 'log', message, value?, label?, range?, time? }
//           | { kind: 'timing', phase: 'prepare' | 'compile' | 'run' | 'data', durationMs }
```

One stream for trace, `LOG(...)` output and timing. `emit` must not throw:
the runtime catches a throw and drops it. The result of `run` also holds the
`logs` and `stats`, so a caller with no sink still gets them.

## 4. Where programs run

There are five places. The API is the same in all of them. Only the ports and
the place of the code change. The sequence diagrams are in
[ADR 0002, section 8](../adr/0002-runtime-ports.md#8-topologies).

| Place | What happens | Entry points |
|---|---|---|
| **CLI** | One process. The data port is a fixture or `pg` | `minab run` |
| **NestJS server** | The server runs **stored programs by id and version**, in the request's transaction | `@shamsine/minab/nestjs`, `/node` |
| **Browser, local** | A Web Worker prepares and checks programs and runs the ones with tier `local`. No network | `/browser`, `/browser/worker` |
| **Browser, delegated** | A program with tier `data` goes to the server as an **id, a version and inputs** | `/browser` |
| **Playground** | The engine worker holds PGlite. Only for demos | `/browser/pglite` |

Three rules decide the design (decisions D28, D30, D34):

1. **The browser never sends SQL, a schema or program text to the server.** It
   sends a program id, a version and values. The server has its own schema, its
   own data port and its own host functions.
2. **The server runs only stored programs.** Your app keeps each program as
   `{ source, languageVersion }` with an id and a version. A program with an id
   and a version never changes: a new rule is a new version.
   (A development mode can accept program text. It is off by default.)
3. **The analysis decides the place.** `analysis.tier` is `local` when the
   program needs no data, has no writes and uses only `local` host functions.
   Otherwise it is `data`. The analysis is conservative: when it is not sure, it
   says `data`. A wrong `data` costs one network call. A wrong `local` would
   give a wrong answer.

There is no offline data run in the browser for 1.0. A `data` program needs the server.

## 5. Walkthrough: NestJS

The app in [`examples/nestjs`](../../examples/nestjs/README.md) is a small shop
with `Customer` and `Order`. It has one rule that runs inside a transaction
and one stored query. Its end-to-end tests are in
[`test/app.e2e.ts`](../../examples/nestjs/test/app.e2e.ts). The app installs
Minab from the **packed tarball** (`npm run setup`), so the tests use what a
user gets from npm.

### Install

```sh
npm install @shamsine/minab
npm install @nestjs/common @nestjs/core rxjs reflect-metadata   # the optional peers
```

`pg`, TypeORM and Prisma stay your own dependencies. A CommonJS app (the Nest
default) and Jest work: the package has a CommonJS build for `.`, `/node` and `/nestjs`.

### 1. The schema

[`src/schema.ts`](../../examples/nestjs/src/schema.ts) is the schema Minab
programs may read: tables, columns, `ref` and `collection` relations, and a `version`
(`shop-1`). It is the **whole read surface**. A program can read every column
in it and nothing else. Keep it small. When it changes, change the `version`:
prepared programs are cached by it.

### 2. The program store

[`src/program-store.ts`](../../examples/nestjs/src/program-store.ts) reads the
table `minab_program (id, version, source, language_version)`. The table and two
programs are made by the migration
([`src/migrations/1700000000000-init.ts`](../../examples/nestjs/src/migrations/1700000000000-init.ts)).
`ProgramStore.get(id, version)` returns the program or `undefined`. The module
caches the prepared program by schema version, id and version.

### 3. The module

[`src/app.module.ts`](../../examples/nestjs/src/app.module.ts) sets it up:

```ts
MinabModule.forRootAsync({
    inject: [DataSource],
    endpointPath: 'minab/run',
    useFactory: (dataSource: DataSource) => ({
        schemaLoader: () => schema, // with tenants, pick the schema from the request
        ruleContext: { recordTable: 'Order', isFieldRule: false },
        programStore: new DatabaseProgramStore(dataSource),
        endpoint: { ports: () => ({ data: queryFunctionDataPort((text, params) => dataSource.query(text, params)) }) }
    })
})
```

- `schemaLoader(context)` runs for each request. Its result is cached by `version`.
  With tenants, choose the schema from the request, and give each schema its own `version`.
- `endpoint.ports` gives the data port of the run endpoint. The **server** decides
  this. The client never does. Use `endpoint.hostInputs` for server-owned values
  such as `currentUser`: they replace a value of the same name from the client.
- Put a guard on the endpoint (`endpoint.guards`, or the app's global guards).
  Without one, anyone who can reach the route can run stored programs. The example
  has no guard, to stay short. Do not copy that.

### 4. A rule inside a transaction

[`src/orders.controller.ts`](../../examples/nestjs/src/orders.controller.ts)
handles `POST /orders/validate`:

1. Open a TypeORM `QueryRunner` transaction and insert the order.
2. Make the data port **from the same runner**:
   `queryFunctionDataPort((text, params) => runner.query(text, params))`.
   The rule now reads the row that was just written, so it counts the new order too.
3. `minab.runStored('order-limit', version, { record }, { data })`.
4. `true`: commit, answer 201. `false`: roll back, answer 422 with the rule id.
   A failed run (`!result.ok`) throws `MinabException`: roll back and answer with
   the code (the `MinabExceptionFilter` does this). A broken program never leaves a half-saved order.

Make the data port **for each request**. Never use a pool for a transaction:
each pool call may use another connection.

### 5. A stored query

[`src/reports.controller.ts`](../../examples/nestjs/src/reports.controller.ts)
runs the stored query `top-customers` with a data port on the pool. A query
writes nothing, so it needs no transaction.

### 6. The run endpoint

With `endpointPath` set, `POST /minab/run` takes a [wire format](../reference/wire-format.md)
v1 request: `{ v: 1, runs: [{ id, program: { ref: { id, version } }, record, inputs }] }`.
The answer has one result for each run. A valid request is HTTP 200, even when
some runs fail. The endpoint refuses `program.source` unless `endpoint.allowSource`
is true. That is for development. Never set it from `NODE_ENV`.
The browser example calls this endpoint.

### Run the example

```sh
cd examples/nestjs
npm ci && npm run setup && npm run migrate   # needs Postgres 16 (see its README)
npm test
```

## 6. Walkthrough: a browser app

The app in [`examples/browser`](../../examples/browser/README.md) has two
pages. A form with two rules (one local, one delegated to the server) and a
Monaco editor. Its tests are in
[`tests/browser.spec.ts`](../../examples/browser/tests/browser.spec.ts)
(Playwright, Chromium). Like the server example, it installs the packed tarball.

### 1. The worker

[`src/minab.worker.ts`](../../examples/browser/src/minab.worker.ts) is one line:
`import '@shamsine/minab/browser/worker'`. Importing it starts the worker. The
parser and the checker run there, off the main thread. The ports stay on the
main thread: the worker calls them over a message bridge and waits.

### 2. The clients, made once

[`src/minab.ts`](../../examples/browser/src/minab.ts):

```ts
export const local = createWorkerMinab({ worker: () => new MinabWorker(), schema, ruleContext });
export const remote = createRemoteMinab({ endpoint: '/minab/run', types: { schema, ruleContext } });
export const router = routeByTier({ local, remote });
```

[`src/schema.ts`](../../examples/browser/src/schema.ts) is the browser's schema.
It is used to check programs. It is **never sent** to the server.
[`vite.config.ts`](../../examples/browser/vite.config.ts) proxies `/minab` to the
server, so the page and the server share one origin (no CORS).

### 3. Local rules and remote runs

[`src/form.ts`](../../examples/browser/src/form.ts) prepares two rules with
`router.prepare({ id, version, source })`:

- `.end_date > .start_date` needs no data. Its tier is `local`, so every `run`
  stays in the worker. The tests check that the page makes **no request** to `/minab`.
- `COUNT(#Order[...]) <= 5` reads other orders. Its tier is `data`, so `run`
  sends `{ ref: { id, version } }` and the record fields to the server, in one
  wire request. The page sends only the fields in `analysis.recordFields`.
  The server runs its own stored program. The source text in the browser is
  used only to learn the tier. It must match the stored program.

`routed.route` tells where a program goes: `local` or `remote`.
A program that fails its check stays local and gives its diagnostics.
Runs made in the same tick go out in one request (up to 100).
An `AbortSignal` ends a remote run with `cancelled` at once.

### 4. Routing and re-running

`analysis.recordFields` and `program.dependsOn(field)` tell which rules a field
change can affect. Re-run only those. A rule that reads other tables can change
when the data changes, which the browser does not see.

### 5. Monaco

[`src/editor.ts`](../../examples/browser/src/editor.ts) makes the editor with one call:

```ts
registerMinab(monaco, { client: local, ruleContext });
```

You get highlighting, brackets, error markers (with the stable code),
completion, hover and signature help. The work runs in the same worker.
Monaco is passed in, never imported by Minab. `monaco-editor` is an optional peer.
In a right-to-left page (Persian, Arabic), put the editor in an element with
`dir="ltr"`. More in the [`src/monaco` README](../../src/monaco/README.md).

### Run the example

```sh
cd examples/browser
npm ci && npm run setup
npx playwright install chromium   # once
npm test                          # also starts the NestJS example
```

## 7. Errors and codes

Every diagnostic and every run error has a **stable code**, an English
`message` and `params` (JSON-safe values). Map by `code`. Never parse `message`.
All codes are in the [error code reference](../reference/diagnostics.md).

```ts
const text = translations[error.code]?.(error.params) ?? error.message;
```

- Minab ships English only. **You translate**: keep one text for each code, and fill
  it from `params`. Shamsine keeps its Persian, Arabic and Turkish texts in its own files.
- A **diagnostic** (from `prepare`) has a `range` (0-based, like the language
  server) and a severity. Map it to an editor marker.
- A **run error** (from `run`) has an optional `range` and the same shape.
- The areas: `syntax`, `scope`, `type`, `null`, `call`, `rule` (the check),
  `compile`, `eval` (a run failed), `limit`, `data` (the data port), `wire` (the
  request), and `cancelled`.
- The SQL text is never in an error. Read it from the `statement` event.
- A driver failure is `data.error`. `params.sqlstate` is set when the driver
  gives one. The driver's own message is not copied.

### HTTP

The `MinabExceptionFilter` maps codes to HTTP statuses for you:

| Code | Status |
|---|---|
| `wire.programNotFound` | 404 |
| other `wire.*` | 400 |
| `cancelled` | 499 |
| `data.*` | 500, without the driver message |
| a check failure, `compile.*`, `eval.*` | 422 |
| `limit.*` | 422 |
| anything else | 500, without detail |

A valid run request is always 200. Each run in it has its own `ok` and `error`.

## 8. Limits, logs, security and versions

### Limits

Limits are always on. A program written by an end user cannot run forever.
`createMinab({ limits })` sets them, and a single run can only be **tighter**
(`run(…, { limits })`).

| Limit | Default | Code |
|---|---|---|
| `sourceLength` | 64 KB | `limit.sourceTooLong` (a diagnostic) |
| `nestingDepth` | 200 | `limit.tooDeep` (a diagnostic) |
| `wallTimeMs` | 1,000 | `limit.timeout` |
| `statements` | 100 | `limit.tooManyStatements` |
| `rowsPerStatement` | 10,000 | `limit.tooManyRows` |
| `loopIterations` | 100,000 | `limit.tooManyIterations` |
| `callDepth` | 64 | `limit.callDepth` |
| `logEntries` | 100 | extra entries are dropped (`logsTruncated`) |
| `batchRuns` | 100 | `wire.tooManyRuns` |

`run(…, { signal })` cancels a run. Minab checks the signal between steps and
passes it to every port call. It cannot interrupt one SQL statement that is
already running: pass the signal to your driver, and set a **statement timeout
in your database**.

### Logs

`LOG(value, label?)` output is for debugging. It may hold personal data.
Each entry is one line (newlines are escaped). The NestJS module writes logs
only when `NODE_ENV` is not `production`, writes at most 100 lines for each run,
and tags them with the program id and request id. SQL statement lines have the
text, never the parameter values.

### Security

- Every program is untrusted input. The limits above are always on.
- The schema is the read surface. Scope it for each tenant or user, or back it
  with row-level security.
- SQL goes out with positional parameters. Table and column names come from the
  schema, never from program text.
- The browser sends an id, a version and values. The server owns the schema, the
  ports, `currentUser`, the clock and the time zone.
- A 500 answer never has SQL, a driver message or a stack.
- Host functions are your code. Treat their arguments as hostile.

[ADR 0002, section 12](../adr/0002-runtime-ports.md#12-security-model) has the
full security model. A security policy and a security guide (`docs/security.md`)
are planned (phase Q3). A performance guide (`docs/performance.md`, phase Q4)
and a compatibility policy (`docs/compatibility.md`, phase Q5) are planned too.
This guide will link to them when they exist.

### Stored programs and versions

Store each program as `{ id, version, source, languageVersion }`.
`StoredProgram` has these fields (see `@shamsine/minab/nestjs`). The example
table `minab_program` has a `language_version` column.

- A program with an id and a version never changes. A new rule is a new version.
- `languageVersion` says which version of the language the program was written
  for. Phase Q5 builds the rules around it. Until then it is stored and not yet used.
- Before 1.0, anything may break: the language, the runtime API, the wire format
  and the codes (decision D38). Pin an exact version of the package.
- From 1.0, within 1.x: no breaking change to the language, the runtime API, the
  wire format or the codes. A deprecated form warns for at least one minor
  release before it goes. A golden set of programs from every release must keep
  giving the same results.
- Node 22.12 or newer. The package is ES modules plus a CommonJS build.

## 9. The API reference

The reference is made by [TypeDoc](https://typedoc.org) from the TSDoc comments
of the public entry points: `@shamsine/minab`, `/node`, `/nestjs`, `/browser`
and `/monaco`.

```sh
npm run docs:api   # writes HTML to out/api/ (not committed)
```

CI runs this command with warnings as errors, so a public symbol without a doc
comment fails the build. A property of an interface does not need its own comment.

| Entry | For | Main names |
|---|---|---|
| `@shamsine/minab` | Everything. No Node, no DOM | `createMinab`, `PreparedProgram`, the port interfaces, `Limits`, the wire functions |
| `@shamsine/minab/node` | Node hosts | `pgDataPort`, `queryFunctionDataPort`, `connectPostgres`, `systemClock` |
| `@shamsine/minab/nestjs` | NestJS | `MinabModule`, `MinabService`, `MinabExceptionFilter`, `ProgramStore` |
| `@shamsine/minab/browser` | Web apps | `createWorkerMinab`, `createRemoteMinab`, `routeByTier` |
| `@shamsine/minab/monaco` | Monaco | `registerMinab` |

`@shamsine/minab/browser/worker`, `/browser/pglite`, `/lsp` and `/host` are
entry points without an API of their own to call: import the worker, or see
their folders' READMEs.
