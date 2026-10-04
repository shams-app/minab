# Minab in Shamsine

This guide is for the Shamsine team and for AI sessions that work in
`shams-app/monorepo`. It tells you how to wire Minab into `core/service` and
`core/web`. It is the written answer to card M.0, and it is the input for
M.4–M.16.

Read it with [ADR 0002](../adr/0002-runtime-ports.md) (section 13 is about
Shamsine) and the [wire format](../reference/wire-format.md).

**State of things.** Shamsine integrates at Minab **0.3.0** (decision D02).
`@shamsine/minab` is **not published yet** (on 2026-10-01 it was not on npm).
The package in this repo says `0.2.0`. Before 1.0 anything may break (D38), so
pin an exact version.

**How this guide was checked.** The Shamsine facts come from a read-only copy of
the monorepo (commit `357e7bd`, 2026-10-01). Every example expression below was
run through the real `prepare` of this repo. Every API name was looked up in the
code of this repo. Where the monorepo and this guide disagree, trust the code
and tell the owner (see [section 12](#12-monorepo-follow-ups)).

## Contents

1. [Map of the GM cards](#1-map-of-the-gm-cards)
2. [Field type mapping](#2-field-type-mapping)
3. [The schema](#3-the-schema)
4. [Names](#4-names)
5. [`expect`](#5-expect)
6. [Inputs and the clock](#6-inputs-and-the-clock)
7. [Where things run](#7-where-things-run)
8. [The data port, per application](#8-the-data-port-per-application)
9. [Messages in fa, ar and tr](#9-messages-in-fa-ar-and-tr)
10. [Stored expressions](#10-stored-expressions)
11. [Jest, CommonJS and Bun](#11-jest-commonjs-and-bun)
12. [Monorepo follow-ups](#12-monorepo-follow-ups)
13. [Limits you will meet in 0.3.0](#13-limits-you-will-meet-in-030)

## 1. Map of the GM cards

One package, `@shamsine/minab`, with these entry points:

| Entry | Runs in | Use it for |
|---|---|---|
| `@shamsine/minab` | anywhere | `createMinab`, types, wire helpers |
| `@shamsine/minab/node` | Node | `queryFunctionDataPort`, `pgDataPort`, `systemClock` |
| `@shamsine/minab/nestjs` | Node + NestJS | `MinabModule`, `MinabService`, the run endpoint |
| `@shamsine/minab/browser` | browser | `createWorkerMinab`, `createRemoteMinab`, `routeByTier` |
| `@shamsine/minab/browser/worker` | Web Worker | the worker file |
| `@shamsine/minab/monaco` | browser | `registerMinab` for the expression editor |

Bundle sizes (minified, from `bench/bundle.json`): the browser client is
84 KB (25.5 KB gzip), the worker is 796 KB (189 KB gzip), the Monaco glue is
8.6 KB. The worker holds the parser, so load it lazily, in its own chunk.

| Card | What it needs | Minab API, in concrete terms |
|---|---|---|
| **M.0** discovery | A description of Minab | This guide and ADR 0002. Close M.0 with them. |
| **M.1** library entry | `check` with ranges and codes | `createMinab({ schema, inputs, functions, limits })`, then `await minab.prepare(source, { ruleContext, expect })`. Read `prepared.ok` and `prepared.diagnostics`. Each diagnostic is `{ severity, code, message, range, params }`. `range` is 0-based (`{ start: { line, character }, end }`). This replaces `parse` and `check(source, schema, expect)`. |
| **M.2** dependency analysis | Fields, inputs, functions, tier | `prepared.analysis` (`recordFields`, `dependencies`, `inputs`, `hostFunctions`, `builtins`, `tables`, `needsData`, `writes`, `tier`) and `prepared.dependsOn(field)`. This replaces `analyze(ast)`. |
| **M.3** evaluator | `evaluate` with clock, limits, errors | `await prepared.run(inputs, ports, options)`. `inputs` is `{ record, fieldValue, hostInputs }`. `ports` is `{ data, hostFunctions, clock, events }`. `options` is `{ signal, limits }`. The answer is `{ ok: true, value, logs, stats }` or `{ ok: false, error: { code, message, range, params } }`. It never throws for a failed program. A `local` program needs no port at all, so there is no "in-memory data source". |
| **M.4** add Minab | One adapter per side | Service: `@shamsine/minab/nestjs` (or `/node`). Web: `@shamsine/minab/browser`, loaded with `import()` in its own chunk. Keep the two adapter files from the card as the only importers. |
| **M.5** schema bridge | `toMinabSchema(dataset)` | Sections [2](#2-field-type-mapping) and [3](#3-the-schema). The function lives in the monorepo (Minab ships none). |
| **M.6** validate on save | Errors with element id and path | Service: `MinabService.prepare(source, { ruleContext, expect, context })`. Block the save when `!prepared.ok`. Add the element id and property path to each diagnostic yourself. |
| **M.7** Dynodb data source | Read-only data | The `DataPort`, not a `DataSource`. Section [8](#8-the-data-port-per-application). Row cap and time limit are Minab limits (`rowsPerStatement`, `wallTimeMs`). |
| **M.8** evaluate API | Batch endpoint | `MinabModule.forRoot({ …, programStore, endpoint })` mounts `POST minab/run` (wire format v1). Or call `MinabService.runStored(id, version, inputs, ports, { context })` from your own controller. Section [7](#7-where-things-run) and [10](#10-stored-expressions). |
| **M.9** local evaluation | Browser runs, re-run only dependents | `createWorkerMinab({ worker, schema, inputs })`, then `prepared.analysis.tier === 'local'` and `prepared.dependsOn(fieldName)`. |
| **M.10** remote evaluation | Batched remote runs | `createRemoteMinab({ endpoint, headers, maxBatch, types })` and `routeByTier({ local, remote })`. The client already batches runs made in the same tick (default 100 per request). Debounce (~150 ms) and the cache by dependency values are Shamsine's job. |
| **M.11** editor design | None | Nothing from Minab. |
| **M.12** editor: syntax and errors | Monaco language and markers | `registerMinab(monaco, { client })` from `@shamsine/minab/monaco`. Markers carry the stable `code`. Put the editor in `<div dir="ltr">` inside RTL pages. |
| **M.13** editor: help | Completion and hover | `client.complete(source, offset)`, `client.hover(source, offset)`, `client.signatureHelp(source, offset)` on the `WorkerMinab`. `registerMinab` already wires them to Monaco. The field list comes from the schema you gave. |
| **M.14, M.15** designer, behavior | Nothing new | `prepared.run(...)` for each bound property. |
| **M.16** hardening | Performance numbers | Phase Q4 of the Minab plan sets the budget. The bundle sizes above are known now. |

A minimal start, on the service side:

```ts
import { createMinab } from '@shamsine/minab';

const minab = createMinab({
    schema, // section 3
    inputs: { currentUser: { id: 'TEXT', email: 'CITEXT', roles: 'TEXT[]' } }, // section 6
});
const prepared = await minab.prepare('.status == "open"', {
    ruleContext: { isFieldRule: false, recordTable: 'Order' },
    expect: 'boolean',
});
if (!prepared.ok) throw new Error(prepared.diagnostics[0]!.code);
const result = await prepared.run({ record: { status: 'open' }, hostInputs: { currentUser } });
// { ok: true, value: true, logs: [], stats: { statements: 0, rows: 0, durationMs: 4 } }
```

## 2. Field type mapping

`DatasetFieldDataType` has **47** values (counted from
`packages/core/service/prisma/schema.prisma`; the comments there say "5 variants" for
choices and "7" for relations, but the real counts are 3 and 8). The table has one row for
each, in the order of the enum.

The "Dynodb column" is what `packages/core/service/src/dynodb/dynodb.constants.ts`
and `dynodb.service.ts` (`createTable`) create. It is the truth for SQL. The
Minab type must be one the column can really give.

| # | Field type | Dynodb column | Minab type | Note |
|---|---|---|---|---|
| 1 | `text` | `text` | `TEXT` | |
| 2 | `longText` | `text` | `TEXT` | |
| 3 | `richText` | `text` | `TEXT` | The raw string. Its format (markdown, html, blocksuite) is the editor's. |
| 4 | `integer` | `integer` | `INTEGER` | |
| 5 | `decimal` | `numeric` | `DECIMAL` | Exact (D17). |
| 6 | `currency` | `numeric(19,4)` | `DECIMAL` | Exact. Money is never a float. |
| 7 | `percent` | `numeric(7,4)` | `DECIMAL` | Minab does not scale it. A program sees the stored number. |
| 8 | `rating` | `smallint` | `INTEGER` | |
| 9 | `numberRange` | `numrange` | *unsupported* | Not `JSON`. Leave it out of the schema. See [section 13](#13-limits-you-will-meet-in-030). |
| 10 | `boolean` | `boolean` | `BOOLEAN` | |
| 11 | `singleSelect` | `text` | `TEXT` | |
| 12 | `multiSelect` | `text[]` | `TEXT[]` | |
| 13 | `date` | `date` | `DATE` | |
| 14 | `time` | `time` | `TIME` | |
| 15 | `dateTime` | `timestamptz` | `DATETIME` | |
| 16 | `week` | `varchar(10)` | `TEXT` | A short text. Compare it with `==` and `!=` only. The format is the editor's. |
| 17 | `timeline` | `tstzrange` | *unsupported* | A range type. Leave it out of the schema. |
| 18 | `timeTracking` | `jsonb` | `JSON` | `is` / `isnot` only. The shape is not in `AGENTS.md`'s table: ask the owner. |
| 19 | `duration` | `bigint` | `INTEGER` | Total milliseconds. Minab reads a `bigint` that arrives as text. |
| 20 | `user` | `text` | `TEXT` | An opaque id such as `usr_…`. Not a UUID. |
| 21 | `users` | `text[]` | `TEXT[]` | |
| 22 | `linkToRecord` | none (a foreign key column) | `ref` | See [section 3](#3-the-schema). |
| 23 | `linkToList` | none (a foreign key on the other table) | `collection` | See [section 3](#3-the-schema). |
| 24 | `lookup` | `jsonb` | `JSON` | Read-only. Dynodb caches it as JSON. |
| 25 | `rollup` | `numeric` | `DECIMAL` | Read-only. |
| 26 | `formula` | `jsonb` | `JSON` | Read-only. The column is JSON, so Minab sees `JSON`. `CAST` a JSON number or boolean to `INTEGER`, `DECIMAL` or `BOOLEAN`. |
| 27 | `count` | `integer` | `INTEGER` | Read-only. |
| 28 | `attachment` | `jsonb` | `JSON` | `{ objectKey, name, size, mimeType }` |
| 29 | `barcode` | `text` | `TEXT` | |
| 30 | `color` | `varchar(9)` | `TEXT` | |
| 31 | `icon` | `jsonb` | `JSON` | `{ name, fill, color }` (weight, grade, opsz are optional) |
| 32 | `canvas` | `jsonb` | `JSON` | `{ width, height, strokes: [{ points: [x, y][] }] }` |
| 33 | `email` | `citext` | `CITEXT` | Case-insensitive compare. |
| 34 | `url` | `text` | `TEXT` | |
| 35 | `phone` | `varchar(50)` | `TEXT` | |
| 36 | `location` | `jsonb` | `JSON` | `{ lat, lng, address }` (`address` may be null) |
| 37 | `address` | `jsonb` | `JSON` | `{ text, parts }` (`parts` may be null) |
| 38 | `id` | `integer` (identity) or `serial` | `INTEGER` | The primary key column. `createTable` makes it `INTEGER`. The map in `dynodb.constants.ts` says `uuid`, but no column of that type is created. Check once on a real application database. |
| 39 | `createdAt` | `timestamptz` | `DATETIME` | Read-only. Column `created_at`. |
| 40 | `createdBy` | `text` | `TEXT` | Read-only. Column `created_by`. A user id, not a UUID. |
| 41 | `updatedAt` | `timestamptz` | `DATETIME` | Read-only. Column `updated_at`. |
| 42 | `updatedBy` | `text` | `TEXT` | Read-only. Column `updated_by`. |
| 43 | `deletedAt` | `timestamptz` | `DATETIME` | Read-only. Column `deleted_at`. |
| 44 | `deletedBy` | `text` | `TEXT` | Read-only. Column `deleted_by`. |
| 45 | `pinToApplication` | `boolean` | `BOOLEAN` | Column `pin_to_application`. |
| 46 | `kanbanHistory` | `jsonb` | `JSON` | System field, read-only. |
| 47 | `kanbanOrder` | `numeric` | `DECIMAL` | System field, read-only. |

Count: 47 rows, one for each enum value, in enum order. 43 map to a Minab scalar type
(9 of them `JSON`), 2 become relations (`linkToRecord`, `linkToList`), and 2 are
unsupported for now (`numberRange` and `timeline`). The `JSON` rows are `timeTracking`,
`lookup`, `formula`, `attachment`, `icon`, `canvas`, `location`, `address` and `kanbanHistory`.

**`JSON` types are weak in 0.3.0.** You can test the shape (`is object`,
`is array`, `is null`, `isnot null`) and `CAST` a JSON number or boolean. You
**cannot** read a key (`.location.lat` fails with `type.memberOnNonRecord`), index by
a text key, or compare a `JSON` value with `==` to a text or a number. Treat the
`JSON` fields as "can be tested for null, not read" until a richer type exists.

**Read-only** only matters for writes (phase X5). Expressions read all of these.

## 3. The schema

The schema is the whole read surface of a program (D29). Build it **per
application**, from that application's datasets, on the server. Never take it from the
client (D01, D28).

```ts
const schema = {
    version: hashOf(datasets.map(d => d.fields)), // D29: a hash of the datasets' fields
    tables: [
        {
            name: 'Order',          // the dataset name, what the author types
            sqlName: 'ds_8f2k…',    // the dataset id: Dynodb names the table by the id
            primaryKey: 'id',       // dataset.primaryKey.name
            columns: [
                { name: 'id', type: scalar('INTEGER') },
                { name: 'status', type: scalar('TEXT') },
                { name: 'total', type: scalar('DECIMAL') },
                { name: 'createdAt', sqlName: 'created_at', type: scalar('DATETIME') },
                { name: 'customer_id', type: scalar('INTEGER') },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: true, foreignKey: 'customer_id' } },
            ],
        },
    ],
};
```

`scalar(base, { array, nullable })` is a small helper you write in the monorepo. The type
object is `{ kind: 'scalar', type: { kind: 'scalar', base, nullable, array, arrayNullable } }`
(see [section 13](#13-limits-you-will-meet-in-030): Minab does not export a helper yet).

Rules:

- **One Minab table per dataset.** `name` is the dataset's name. `sqlName` is the
  dataset's **id** (`ds_…`): `DynodbService.createTable` names the Postgres table by the
  id, not by the name. The card for G2 said `sqlName` is not needed. It is needed for
  tables.
- **Columns.** A user field's column name is the field name (`createColumn` uses it
  as it is), so `sqlName` is not needed for user fields. The **system fields** are
  different: `createTable` makes `created_at`, `updated_at`, `deleted_at`,
  `created_by`, `updated_by`, `deleted_by` and `pin_to_application`, while the fields
  are named `createdAt`, `updatedAt` and so on. Set `sqlName` to the snake-case column for these seven.
  I found no code that renames them. Check one real application database and drop the
  `sqlName` if both spellings exist.
- **`primaryKey`** is `dataset.primaryKey.name`. Minab needs it to compare two records
  and to follow a `ref`.
- **Relations.** Dynodb has three kinds (`ReferenceType`):
  - `manyToOne` (a `linkToRecord`): the foreign key column is on **this** table. Make a
    `ref` column with `foreignKey` = that column. Also list the key column itself (as
    `customer_id` above), because the analysis counts it as a dependency.
  - `oneToMany` (a `linkToList`): the foreign key is on the **other** table. Make a
    `collection` column with `foreignKey` = the column on the target table.
  - `manyToMany`: Dynodb makes a join table `<left>_<right>` with `left_id` and
    `right_id`. Minab has no many-to-many link. Add the join table as a table of its own
    with two `ref` columns, and a `collection` to it from each side. Do this only when a
    rule needs it.
- **`version`** is a hash of the datasets' fields (D29). Two schemas with the same
  `version` **must** be the same schema, because services are cached by it. Change
  the version whenever a field is added, renamed, retyped or removed.
- **Scope the schema.** A program can read every table and column in it. Leave out
  datasets and fields the signed-in user may not read, or give the data port a
  read-only database role with row-level security.
- **Deleted rows.** Dynodb rows have a `deleted_at` column. Minab does not filter it.
  If Dynodb soft-deletes, add the filter yourself (in the rule, or a database view)
  and check this against the data service before M.7.
- **Prepared once.** `createMinab` is cheap to call but a service set is not. Keep one
  `Minab` per schema version (the NestJS module does this for you, `runtimeCacheSize`
  default 16).

## 4. Names

Persian, Arabic and Turkish names work as they are (decision D12). A plain name
starts with a Unicode letter or `_`, then letters, digits, `_` and the zero-width
joiners that Persian words use. Names are case-sensitive and compared exactly.

```
// table سفارش, columns مبلغ (DECIMAL) and وضعیت (TEXT)
#سفارش[.وضعیت == "ارسال‌شده"]
```

A name with a space, a symbol, a leading digit, or the spelling of a keyword needs
**backticks**:

```
.`Order date` <= CAST(NOW() AS DATE)
.`مبلغ کل` > 100
```

Inside backticks, `` \` `` is a backtick and `\\` is a backslash. The name in a
diagnostic is shown without backticks. So the schema holds the real field name
(`Order date`), and the author types it between backticks. A completion item for such a
name should insert the backticks (the Monaco glue does).

Monaco shows code left to right. Persian and Arabic names inside code display well in
a left-to-right line. In an RTL page, wrap the editor: `<div dir="ltr">`.

## 5. `expect`

Shamsine's `MINAB_EXPECT_TYPES` (`condition.schema.ts`) are six words. They go to
`prepare({ expect })` as they are. A different result type is the diagnostic
`type.unexpectedResultType` (params `actual`, `expected`).

| Shamsine `expect` | Minab accepts a result of type |
|---|---|
| `text` | `TEXT` or `CITEXT` |
| `number` | `INTEGER` **or** `DECIMAL` |
| `boolean` | `BOOLEAN` |
| `date` | `DATE` |
| `dateTime` | `DATETIME` |
| `list` | **any array type** `T[]` (`TEXT[]`, `INTEGER[]`, …) |

- `number` accepts both numeric types as a result. Minab never converts by itself
  (spec §5.5): the program must give the right type, with `CAST` when needed.
- `list` accepts a column such as `.tags` (`TEXT[]`) and a query result such as
  `#Order[.status == "open"]` (a collection). It does not accept `JSON`.
- To ask for **one exact type**, pass `{ minab: 'DECIMAL' }` (or `'INTEGER[]'`,
  `'TEXT'`, …). Use it where `number` is too loose, for example money.
- Leave `expect` out when any type may come back (a formula field). `resultType` still tells you the type.
- A boolean condition (`isTrue`) is `expect: 'boolean'`.

## 6. Inputs and the clock

**Host inputs** are typed, read-only names you declare in `createMinab`. The values come
with each run in `inputs.hostInputs`. A missing one is the run error `eval.missingInput`.

```ts
createMinab({
    schema,
    inputs: {
        currentUser: { id: 'TEXT', email: 'CITEXT', roles: 'TEXT[]' },
        url: { tab: 'TEXT?', page: 'INTEGER?' }, // see below
    },
});
```

- `currentUser` is a record input: `.id`, `.email`, `.roles` and any more fields you
  declare. Expressions read `currentUser.id` and `"admin" IN currentUser.roles`.
  The **server** fills it from the session. The run endpoint ignores a client value of
  the same name (`endpoint.hostInputs`). The browser fills it from the signed-in
  user, for `local` programs only.
- **`url` as `JSON` does not work in 0.3.0.** `url.tab` on a `JSON` input fails with
  `type.memberOnNonRecord`. Declare `url` as a typed record **per page**, from the
  page's own parameters: `{ tab: 'TEXT?', page: 'INTEGER?' }`. `?` means it may be
  null. Then `url.tab == "open"` and `url.tab is null` both check and run.
- **`record`** is the form's record. It is `inputs.record` (keys are the field names).
  Tell Minab which table `.` means with `ruleContext.recordTable` (the dataset name).
  A field rule also sets `isFieldRule: true` and `fieldType`, and `inputs.fieldValue`
  gives `$`.
- Values cross JSON as text for dates and decimals: a `DECIMAL` is `"24.90"`, a `DATE`
  is `"2026-10-02"`, a `DATETIME` is `"2026-10-02T08:30:00.000Z"`. A `DECIMAL`
  result is a string too (`"0.2"`): parse it with a decimal library, not `parseFloat`.

**The clock** is a port. `ClockPort` is `{ now(): Date, timeZone: string }`. The
runtime reads it **once per run**, so `NOW()` is the same all through one run (D21).
The time zone is the user's IANA name. It matters for the parts of a date:

```ts
// 21:00 UTC on 2026-10-04 is already 2026-10-05 in Tehran (UTC+3:30)
const rule = await minab.prepare('.due < CAST(NOW() AS DATE)', { ruleContext, expect: 'boolean' });
await rule.run({ record: { due: '2026-10-04' } }, { clock: { now: () => new Date('2026-10-04T21:00:00Z'), timeZone: 'UTC' } });          // false
await rule.run({ record: { due: '2026-10-04' } }, { clock: { now: () => new Date('2026-10-04T21:00:00Z'), timeZone: 'Asia/Tehran' } }); // true
```

- Browser: pass your own `clock` in `ports` (`timeZone` from the user's profile).
- Server: `systemClock('Asia/Tehran')` from `@shamsine/minab/node`, or the same object
  literal. The server's clock is the one for `data` programs. A request cannot set it.
- Jalali dates are display only. Minab stores and compares Gregorian ISO values.

## 7. Where things run

Minab decides the **tier** from the program, never the author (R5). `prepared.analysis.tier`:

- **`local`**: the program reads only the record, host inputs, the clock and
  built-ins. No table, no relation column, no query, no write, no host function that is
  not declared `local`. It runs in the **browser worker**, with no port and no network.
- **`data`**: anything else. It runs on the server with the **NestJS module**:
  `MinabService.runStored(...)` or the run endpoint.

The analysis is conservative: when it cannot be sure it says `data`. A wrong `data` costs a
request. A wrong `local` would be a wrong answer. A field read with no record table is
`data`. A program with a syntax error is `data`, `writes`, whole record.

**Browser**, with the router:

```ts
import { createWorkerMinab, createRemoteMinab, routeByTier } from '@shamsine/minab/browser';

const local = createWorkerMinab({
    worker: () => new Worker(new URL('@shamsine/minab/browser/worker', import.meta.url), { type: 'module' }),
    schema, inputs,
});
const remote = createRemoteMinab({ endpoint: '/api/minab/run', headers: () => ({ Authorization: `Bearer ${token()}` }), types: { schema, inputs } });
const router = routeByTier({ local, remote });

const program = await router.prepare({ id: 'view_8f2:el_ab12cd:props.visible', version: '17', source }, { ruleContext, expect: 'boolean' });
const result = await program.run({ record, hostInputs: { currentUser, url } }, { clock });
```

`program.route` says `local` or `remote`. A program that fails its check stays local and gives its
error. The browser sends only the program **id and version** and the inputs, never SQL or the schema (D28).

**Re-run only what changed (M.9).** Keep a map from field name to programs:

```ts
const affected = programs.filter(p => p.analysis.readsWholeRecord || p.dependsOn(changedField));
```

`dependsOn(field)` is true for every field when the program reads the whole record
(`.` or `^` alone). It does not look at other tables: a `data` program can change when
other rows change, so re-run those when the surface loads and on save, not per key press.

**Batching (M.10) and the wire format.** The remote client collects the runs made in the
same tick into one `POST`, at most `maxBatch` (default 100) per request. The body is wire
format v1:

```json
{ "v": 1, "runs": [
  { "id": "r1",
    "program": { "ref": { "id": "view_8f2:el_ab12cd:props.visible", "version": "17" } },
    "record": { "id": 1, "total": "24.90" },
    "inputs": { "url": { "tab": "open" } } } ] }
```

The answer is `{ "v": 1, "results": [ { "id": "r1", "ok": true, "value": true, … } ] }`. A
valid request is HTTP 200 even when some runs fail: read `ok` and `error` in each result.
A bad request is 400. An unknown program is `wire.programNotFound`. Details:
[wire-format.md](../reference/wire-format.md).

**Server**:

```ts
@Module({
    imports: [
        MinabModule.forRootAsync({
            imports: [ViewModule, DynodbModule],
            inject: [ViewMinabStore, MinabSchemaService],
            useFactory: (store, schemas) => ({
                schemaLoader: ctx => schemas.forApplication(ctx.applicationId as string), // { version, tables }
                inputs, limits: { wallTimeMs: 1000, rowsPerStatement: 10_000 },
                programStore: store, // get(id, version, { signal }) -> StoredProgram | undefined
                endpoint: {
                    path: 'minab/run',
                    guards: [JwtGuard, WorkspaceGuard],
                    ports: ctx => ({ data: dataPortFor(ctx), clock: systemClock(userZone(ctx)) }),
                    hostInputs: ctx => ({ currentUser: userOf(ctx.request) }),
                },
            }),
        }),
    ],
})
export class ExpressionModule {}
```

- **Always put guards on the endpoint** (the usual JWT and workspace guards). Without
  one, anyone who can reach the route can run stored programs.
- The endpoint runs **stored programs** by id and version. It refuses `program.source`
  unless `endpoint.allowSource` is true. That flag is for development only. Never set it from `NODE_ENV`.
- `schemaLoader(ctx)` runs on each request and its result is cached by `version`.
  Put the application id in `MinabContext` (the context holds any fields you add).
- A 500 answer never has SQL, a driver message or a stack: only the code.
- The designer's live preview of an **unsaved** expression can run `local` programs in
  the worker. `data` programs run only after save, because the server runs stored
  programs only.

## 8. The data port, per application

Dynodb has **one Postgres database per application** (`app_<nanoid>`, with
`DYNODB_DB_PREFIX`). The data port must point at the database of the application in the
request, and the schema must be built from that application's datasets.

Minab's data port takes SQL text with `$1`, `$2` placeholders, and returns rows. Wrap any
`(text, params) => rows` function:

```ts
import { queryFunctionDataPort } from '@shamsine/minab/node';

// one TypeORM connection (or one pooled connection) of the application database
const data = queryFunctionDataPort((text, params) => connection.query(text, params));
```

Today `DynodbService` only has a **private** `#useDatabase(name)`. It opens a new TypeORM
connection for **every call** and closes it after. For M.7 add a public method to
`DynodbService`, for example `withReadConnection(applicationId, run)`, that:

1. takes a connection of that application's database (a pool kept for each application,
   not a new connection for each run, because `initialize()` and `SET search_path` are slow);
2. starts a **read-only** transaction: `BEGIN READ ONLY`, then
   `SET LOCAL statement_timeout = '1000ms'` (a little under `wallTimeMs`);
3. gives `run` the data port above;
4. always ends the transaction and releases the connection.

Why the statement timeout: Minab stops *waiting* at `wallTimeMs`, but a statement already
running in the database stops only if the database stops it. Minab passes an
`AbortSignal` to the port (`execute(query, { signal })`). `queryFunctionDataPort` does not
pass it on, so the timeout is your guard.

**Inside the request's transaction.** Dynodb has no request transaction today, because
each call opens its own connection. If a later phase adds one, make the data port
**for each request** from that transaction's connection, so a rule sees the rows the
request wrote and no others:

```ts
await dataSource.transaction(async manager => {
    const data = queryFunctionDataPort((text, params) => manager.query(text, params));
    const result = await minab.runStored(id, version, { record }, { data }, { context });
});
```

With `pg`, use `pgDataPort(client)` on the client you called `BEGIN` on. Do not give it a
pool: each pool call may use another connection.

Errors: a database error is `data.error`, with `params.sqlstate` when the driver gave a
five-character `code`. SQLSTATE `22012` becomes `eval.divisionByZero` and `22P02` or
`22003` become `eval.castFailed`, the same as in the interpreter.

## 9. Messages in fa, ar and tr

Minab ships English messages only (D35). A host translates by **`code`** and fills the
text with **`params`**. Never parse `message`. The same `{name}` style as Shamsine's
`translations.json` is used, so a template can be filled with the same helper.

```ts
const text = translations.minab[error.code]?.[lang] ?? error.message; // fall back to English
fill(text, error.params);
```

The words "field" and "dataset" below follow `translations.json` (`فیلد`, `مجموعه‌داده`;
`حقل`, `مجموعة بيانات`; `Alan`, `Veri kümesi`). Check them with the team's
glossary. Parser messages (`syntax.*`) carry an English `{message}` from the parser; show it
as a detail after the translated line.

The codes users meet most:

| Code | Params | When the user meets it |
|---|---|---|
| `syntax.parser`, `syntax.lexer`, `syntax.incompleteExpression` | `message` | Typing: a bracket or a word is wrong |
| `scope.unknownColumn` | `column`, `table` | A field name is misspelled or was deleted |
| `scope.unknownTable` | `name` | A dataset name is wrong |
| `scope.unknownName` | `name` | A variable or input name is wrong |
| `type.unexpectedResultType` | `actual`, `expected` | The result does not match `expect` |
| `type.implicitCoercion` | `operator`, `left`, `right` | `.status == 1`: two different types |
| `type.conditionNotBoolean` | `actual` | An `if` or filter gives no boolean |
| `type.arithmeticNeedsNumeric` | `operator`, `left`, `right` | `"a" - 1` |
| `type.logicalNeedsBoolean` | `operator`, `left`, `right` | `AND` / `OR` with a non-boolean |
| `type.ifBranchesDiffer` | `then`, `else` | `if` branches have two types |
| `call.unknownFunction` | `name` | A function name is wrong |
| `call.wrongArgumentCount` | `name`, `expected`, `actual` | Too few or too many arguments |
| `call.argumentType` | `name`, `position`, `expected`, `actual` | An argument has the wrong type |
| `eval.divisionByZero` | none | A run divides by zero |
| `eval.castFailed` | `value`, `to` | `CAST("12a" AS INTEGER)` |
| `eval.integerOutOfRange` | none | An integer result is too large |
| `eval.missingInput` | `name` | A host input was not given (a host bug) |
| `eval.hostFunctionFailed` | `name` | A host function threw |
| `limit.timeout` | `limit` | The run took too long |
| `limit.sourceTooLong` | `used`, `limit` | The expression is over 64 KB |
| `limit.tooDeep` | `used`, `limit` | Too many nested brackets |
| `limit.tooManyRows` | `limit` | A query returned too many rows |
| `limit.tooManyStatements` | `limit` | A run sent too many queries |
| `data.error` | none | The database failed |
| `cancelled` | none | The run was cancelled |
| `wire.remoteFailed` | `reason` | The network or the server failed |
| `wire.programNotFound` | `id`, `version` | A stored program is missing |

All codes are in [diagnostics.md](../reference/diagnostics.md). A new code is added in
Minab with its English message; a code you have not translated falls back to English.

Paste-ready translation entries (the shape of `translations.json`: every leaf has
`en`, `fa`, `ar` and `tr`):

```json
{
   "minabErrors": {
      "syntax.parser": {
         "en": "{message}",
         "fa": "خطای نحوی در عبارت: {message}",
         "ar": "خطأ في صياغة التعبير: {message}",
         "tr": "İfadede söz dizimi hatası: {message}"
      },
      "syntax.lexer": {
         "en": "{message}",
         "fa": "نویسهٔ نامعتبر در عبارت: {message}",
         "ar": "حرف غير صالح في التعبير: {message}",
         "tr": "İfadede geçersiz karakter: {message}"
      },
      "syntax.incompleteExpression": {
         "en": "incomplete expression (the program has a syntax error here)",
         "fa": "عبارت ناقص است",
         "ar": "التعبير غير مكتمل",
         "tr": "İfade eksik"
      },
      "scope.unknownColumn": {
         "en": "unknown column \"{column}\" on table \"{table}\"",
         "fa": "فیلد «{column}» در مجموعه‌داده «{table}» وجود ندارد",
         "ar": "الحقل \"{column}\" غير موجود في مجموعة البيانات \"{table}\"",
         "tr": "\"{table}\" veri kümesinde \"{column}\" adlı bir alan yok"
      },
      "scope.unknownTable": {
         "en": "unknown table \"{name}\"",
         "fa": "مجموعه‌داده «{name}» وجود ندارد",
         "ar": "مجموعة البيانات \"{name}\" غير موجودة",
         "tr": "\"{name}\" adlı bir veri kümesi yok"
      },
      "scope.unknownName": {
         "en": "unknown name \"{name}\"",
         "fa": "نام «{name}» شناخته نشد",
         "ar": "الاسم \"{name}\" غير معروف",
         "tr": "\"{name}\" adı tanınmıyor"
      },
      "type.unexpectedResultType": {
         "en": "the program gives {actual}, but the host expects {expected}",
         "fa": "این عبارت مقداری از نوع {actual} می‌دهد، اما نوع {expected} لازم است",
         "ar": "يُرجع هذا التعبير قيمة من النوع {actual}، لكن المطلوب هو النوع {expected}",
         "tr": "İfade {actual} türünde değer veriyor, ancak {expected} türü gerekiyor"
      },
      "type.implicitCoercion": {
         "en": "\"{operator}\" between {left} and {right} requires an explicit CAST (no implicit coercion)",
         "fa": "عملگر «{operator}» بین {left} و {right} مجاز نیست؛ یکی را با CAST تبدیل کنید",
         "ar": "المعامل \"{operator}\" بين {left} و{right} غير مسموح؛ حوّل أحدهما باستخدام CAST",
         "tr": "\"{operator}\" işleci {left} ile {right} arasında kullanılamaz; birini CAST ile dönüştürün"
      },
      "type.conditionNotBoolean": {
         "en": "expected a BOOLEAN condition, got {actual}",
         "fa": "شرط باید از نوع BOOLEAN باشد، اما {actual} است",
         "ar": "يجب أن يكون الشرط من النوع BOOLEAN، لكنه {actual}",
         "tr": "Koşul BOOLEAN olmalı, ancak {actual}"
      },
      "type.arithmeticNeedsNumeric": {
         "en": "\"{operator}\" requires numeric operands, got {left} and {right}; use CAST to convert one side",
         "fa": "عملگر «{operator}» به عدد نیاز دارد، اما {left} و {right} داده شده؛ از CAST استفاده کنید",
         "ar": "المعامل \"{operator}\" يتطلب أعدادًا، لكن المُعطى {left} و{right}؛ استخدم CAST",
         "tr": "\"{operator}\" işleci sayı gerektirir, ancak {left} ve {right} verildi; CAST kullanın"
      },
      "type.logicalNeedsBoolean": {
         "en": "\"{operator}\" requires BOOLEAN operands, got {left} and {right}",
         "fa": "عملگر «{operator}» به مقدار BOOLEAN نیاز دارد، اما {left} و {right} داده شده",
         "ar": "المعامل \"{operator}\" يتطلب قيمًا من النوع BOOLEAN، لكن المُعطى {left} و{right}",
         "tr": "\"{operator}\" işleci BOOLEAN değer gerektirir, ancak {left} ve {right} verildi"
      },
      "type.ifBranchesDiffer": {
         "en": "if/else branches must agree on type (no implicit coercion) — got {then} and {else}",
         "fa": "شاخه‌های if و else باید هم‌نوع باشند: {then} و {else}",
         "ar": "يجب أن يتفق فرعا if وelse في النوع: {then} و{else}",
         "tr": "if ve else dalları aynı türde olmalı: {then} ve {else}"
      },
      "call.unknownFunction": {
         "en": "unknown function \"{name}\"",
         "fa": "تابع «{name}» وجود ندارد",
         "ar": "الدالة \"{name}\" غير موجودة",
         "tr": "\"{name}\" adlı bir işlev yok"
      },
      "call.wrongArgumentCount": {
         "en": "{name} expects {expected} argument(s), got {actual}",
         "fa": "{name} باید {expected} آرگومان بگیرد، اما {actual} داده شده",
         "ar": "{name} يتوقع {expected} من الوسائط، لكن المُعطى {actual}",
         "tr": "{name} {expected} bağımsız değişken bekliyor, {actual} verildi"
      },
      "call.argumentType": {
         "en": "\"{name}\" argument {position}: expected {expected}, got {actual} (no implicit coercion)",
         "fa": "آرگومان {position} در «{name}»: نوع {expected} لازم است، اما {actual} داده شده",
         "ar": "الوسيط {position} في \"{name}\": المطلوب {expected}، لكن المُعطى {actual}",
         "tr": "\"{name}\" işlevinin {position}. bağımsız değişkeni: {expected} bekleniyor, {actual} verildi"
      },
      "eval.divisionByZero": {
         "en": "division by zero",
         "fa": "تقسیم بر صفر",
         "ar": "القسمة على صفر",
         "tr": "Sıfıra bölme"
      },
      "eval.castFailed": {
         "en": "cannot cast {value} to {to}",
         "fa": "مقدار {value} به {to} تبدیل نمی‌شود",
         "ar": "تعذّر تحويل القيمة {value} إلى {to}",
         "tr": "{value} değeri {to} türüne dönüştürülemedi"
      },
      "eval.integerOutOfRange": {
         "en": "an INTEGER result is outside the safe range of -9007199254740991 to 9007199254740991",
         "fa": "نتیجهٔ عدد صحیح خارج از بازهٔ مجاز است",
         "ar": "النتيجة الصحيحة خارج النطاق المسموح",
         "tr": "Tam sayı sonucu izin verilen aralığın dışında"
      },
      "eval.missingInput": {
         "en": "the host input \"{name}\" has no value for this run",
         "fa": "برای این اجرا مقداری برای ورودی «{name}» داده نشده است",
         "ar": "لم تُعطَ قيمة للمُدخل \"{name}\" في هذا التشغيل",
         "tr": "Bu çalıştırmada \"{name}\" girdisi için değer verilmedi"
      },
      "eval.hostFunctionFailed": {
         "en": "the host function \"{name}\" failed",
         "fa": "تابع «{name}» با خطا روبه‌رو شد",
         "ar": "فشلت الدالة \"{name}\"",
         "tr": "\"{name}\" işlevi başarısız oldu"
      },
      "limit.timeout": {
         "en": "the run took longer than the limit of {limit} ms",
         "fa": "اجرا بیش از حد مجاز {limit} میلی‌ثانیه طول کشید",
         "ar": "استغرق التشغيل أكثر من الحد المسموح {limit} مللي ثانية",
         "tr": "Çalıştırma {limit} ms sınırını aştı"
      },
      "limit.sourceTooLong": {
         "en": "the source is {used} bytes, and the limit is {limit}",
         "fa": "عبارت {used} بایت است و حد مجاز {limit} بایت است",
         "ar": "حجم التعبير {used} بايت والحد المسموح {limit} بايت",
         "tr": "İfade {used} bayt; sınır {limit} bayt"
      },
      "limit.tooDeep": {
         "en": "expressions are nested {used} levels deep, and the limit is {limit}",
         "fa": "عبارت {used} سطح تودرتو دارد و حد مجاز {limit} سطح است",
         "ar": "عمق تداخل التعبير {used} مستوى والحد المسموح {limit}",
         "tr": "İfade {used} düzey iç içe; sınır {limit}"
      },
      "limit.tooManyRows": {
         "en": "a statement returned more than the limit of {limit} rows",
         "fa": "یک پرس‌وجو بیش از حد مجاز {limit} سطر برگرداند",
         "ar": "أرجع استعلام أكثر من الحد المسموح {limit} صف",
         "tr": "Bir sorgu {limit} satır sınırından fazla satır döndürdü"
      },
      "limit.tooManyStatements": {
         "en": "the run went over the limit of {limit} statements sent to the data source",
         "fa": "اجرا از حد مجاز {limit} پرس‌وجو به منبع داده بیشتر شد",
         "ar": "تجاوز التشغيل الحد المسموح {limit} استعلامًا إلى مصدر البيانات",
         "tr": "Çalıştırma, veri kaynağına {limit} sorgu sınırını aştı"
      },
      "data.error": {
         "en": "the data source failed",
         "fa": "خطا در دسترسی به داده",
         "ar": "فشل الوصول إلى البيانات",
         "tr": "Veri kaynağında hata oluştu"
      },
      "cancelled": {
         "en": "the run was cancelled",
         "fa": "اجرا لغو شد",
         "ar": "أُلغي التشغيل",
         "tr": "Çalıştırma iptal edildi"
      },
      "wire.remoteFailed": {
         "en": "the remote run failed: {reason}",
         "fa": "اجرا روی سرور ناموفق بود",
         "ar": "فشل التشغيل على الخادم",
         "tr": "Sunucuda çalıştırma başarısız oldu"
      },
      "wire.programNotFound": {
         "en": "no stored program with id \"{id}\" and version \"{version}\"",
         "fa": "عبارت ذخیره‌شده پیدا نشد",
         "ar": "لم يُعثر على التعبير المخزَّن",
         "tr": "Kayıtlı ifade bulunamadı"
      }
   }
}
```

(The `en` text is Minab's own English template, so a missing language falls back to it.)
Have the `locales-translator` agent of the monorepo review the fa, ar and tr text before it ships.

## 10. Stored expressions

A bound expression is part of a view, so Shamsine stores it. For each expression store:

| Stored | Example | Why |
|---|---|---|
| `id` | `view_8f2:el_ab12cd:props.visible` (`viewId:nodeId:propertyPath`) | The run endpoint finds the program by id (D34). |
| `version` | the view revision (Shamsine keeps the last 20) | A program's id and version must **never** change its source. The server caches by them. |
| `source` | `.status == "open"` | The expression text. |
| `languageVersion` | a string | The language version the program was written for. Store it next to each expression. |
| `expect` | `boolean` | The type the author chose. |
| `ruleContext` | `{ isFieldRule: false, recordTable: 'Order' }` | Which table `.` means. |

- **Validate on save (M.6).** Call `prepare(source, { ruleContext, expect })` for every
  `bound` expression. If `!prepared.ok`, answer 400 with, for each error diagnostic, the
  element id, the property path, and the diagnostic's `code`, `params` and `range`. Warnings do
  not block the save.
- **`languageVersion`.** The policy is phase Q5 of the Minab plan, and it is not built yet.
  `StoredProgram.languageVersion` is a required string today and Minab does not read it. Until Q5, store the
  Minab package version you validated with (for example `"0.3.0"`), and check this guide
  again when Q5 lands.
- **Messages for failed rules are Shamsine's (D45).** A rule returns only `true` or
  `false` (or a value). Minab gives no message. Shamsine stores a translated message (all
  four languages) next to each rule and shows it when the rule says "invalid". Minab's
  `code` and `range` are for **errors**, not for a rule that ran and said no.
- **Unsaved edits.** The preview of an unsaved expression runs `local` programs through
  `createWorkerMinab` only.
- When an expression stops checking later (a field was deleted), a run gives the same
  diagnostics as `eval.programInvalid`. Re-validate stored expressions when a dataset
  changes (the schema `version` changes).

## 11. Jest, CommonJS and Bun

`core/service` is NestJS 11 with Jest and Bun. Minab ships **ES modules** (`import`) and
**CommonJS** bundles (`require`) for `.`, `./node` and `./nestjs`, so Jest needs no ESM mode.

```jsonc
// packages/core/service/package.json
{ "dependencies": { "@shamsine/minab": "0.3.0" } }   // pin the exact version
```

```ts
import { createMinab } from '@shamsine/minab';
import { queryFunctionDataPort, systemClock } from '@shamsine/minab/node';
import { MinabModule, MinabService } from '@shamsine/minab/nestjs';
```

- Install with `bun add @shamsine/minab@0.3.0`. Node 22.12 or newer (`engines`).
- NestJS entry needs `@nestjs/common`, `@nestjs/core`, `rxjs` and `reflect-metadata`.
  `core/service` already has them. `pg`, TypeORM and Prisma are **not** dependencies
  of Minab: `core/service` brings its own.
- Old TypeScript resolution (`moduleResolution: node`) works: the package has `typesVersions`.
  Set `skipLibCheck: true`, as `nest new` does, because the `.d.ts` files import `langium`.
- The browser entries (`./browser`, `./browser/worker`, `./browser/pglite`, `./monaco`) have
  **no** `require` target. They are for Vite. Do not import them in Jest tests of the
  service; the web package tests them with Vitest.
- The packed package is tested in the Minab repo with an ESM project, a CommonJS project, a
  `nest new`-style project, Jest and Bun (`test/consumers/`).

## 12. Monorepo follow-ups

For the owner to apply in `shams-app/monorepo`. **Nothing here was changed in the monorepo.**
Line numbers are from commit `357e7bd`.

**Cards M.1–M.3 (they run in the Minab repo, and the Minab plan already delivers them)**

| Where | Today | Suggested |
|---|---|---|
| `docs/forms/phases/README.md:767` | "M.1–M.3 run in the **Minab repo** and follow its own rules." | "M.1–M.3 are delivered by the Minab production plan (R2, R3, R4, R5, B1, H1). Mark them done when `@shamsine/minab` 0.3.0 is published. See `docs/guides/shamsine.md` in the Minab repo." |
| `docs/forms/phases/README.md:774-776` | Rows M.1–M.3, Kind "Code (Minab repo)" | Kind "Delivered by the Minab plan". |
| `docs/forms/phases/M.1.md:11` and `:15` | `parse(source)`, `check(source, schema, expect)`; "`import { check } from '@shamsine/minab'`" | "`createMinab(...).prepare(source, { ruleContext, expect })` gives `diagnostics`; done when `import { createMinab } from '@shamsine/minab'` works in Vite and in NestJS (CommonJS and Jest)." |
| `docs/forms/phases/M.2.md:11` and `:15` | `analyze(ast)` → fields, variables, functions, tier | "`prepared.analysis` and `prepared.dependsOn(field)`." |
| `docs/forms/phases/M.3.md:11` and `:15` | `evaluate(ast, context, dataSource)`, `DataSource`, an in-memory data source, `now`, locale | "`prepared.run(inputs, ports, { signal, limits })`. Ports: `DataPort` (SQL), `clock`, `hostFunctions`, `events`. There is no in-memory data source: a `local` program needs no port. Locale is not a Minab input." |

**M.0 and the draft notices**

- `docs/forms/phases/M.0.md`: close it. Its "Build" file `docs/minab/integration-notes.md` (lines 11-12)
  is replaced by `docs/guides/shamsine.md` and `docs/adr/0002-runtime-ports.md` of the Minab
  repo. Each of M.0–M.16 repeats the line "**Draft:** M.0 reads the private Minab repo and may rewrite
  M.1–M.16" (line 5). Delete that line when M.0 is closed. `docs/forms/phases/README.md:759`
  ("the Minab repo is private and was not read") too.
- Every card that reads `docs/minab/integration-notes.md` (from M.0): M.1:9, M.2:9, M.3:9, M.5:10,
  M.6:9, M.7:10, M.8:9, M.9:9, M.11:11, M.12:11, M.13:11 and M.16:10. Point them to the Minab
  repo's `docs/guides/shamsine.md` instead. (`M.0.md:11-12` itself names the file as its output.)

**Other cards**

| Where | Today | Suggested |
|---|---|---|
| `M.5.md:11` | context variables `currentUser`, `now`, `record`, `url` | `currentUser` and `url` are **host inputs** (declared in `createMinab({ inputs })`; `url` as a typed record per page, not `JSON`). `record` is `inputs.record` with `ruleContext.recordTable`. There is no `now` variable: `NOW()` is a built-in and the clock is a port. |
| `M.5.md:11` | "types that have no Minab match are listed and unsupported" | Name them: `numberRange` and `timeline` (both Postgres range types). Add the table of section 2 of this guide. Say "tables need `sqlName` = dataset id; system columns need `sqlName`". |
| `M.5.md:13` | "49 … 47 values today" | Keep: 47. |
| `M.6.md:11` | "checked against the dataset schema … and its `expect` type" | Add: `prepare(source, { ruleContext, expect })`, block when `!prepared.ok`. |
| `M.7.md:1` (title) and `:11` | "a read-only Minab `DataSource` (record by id, filtered query, aggregates)" | "a Minab `DataPort` (`execute(sql, { signal })` returning rows) over the application's Dynodb connection, in a read-only transaction with a statement timeout. Needs a public method on `DynodbService`." |
| `M.8.md:11` | `{ expressions[], datasetId, recordId?, context }` → `{ values[], errors[] }` | The wire format v1 body (section 7). The id of a program is `viewId:nodeId:propertyPath`. A `ProgramStore` over MongoDB reads it. The answer has one result per run, HTTP 200. |
| `M.9.md` | "dependency map re-evaluates only expressions whose fields changed" | Use `prepared.dependsOn(field)` and `analysis.readsWholeRecord`. |
| `M.10.md` | "batched per surface, debounced (~150 ms), cached by dependency values" | The client batches runs of one tick; debounce and cache stay in Shamsine. |
| `M.12.md:11-12` | `check()` API; "live `check()` diagnostics" | `registerMinab(monaco, { client })` does markers, completion, hover. `check()` is `prepare().diagnostics`. |
| `M.12.md:12` | "Monaco (already a dependency)" | Right: `core/web` has `@monaco-editor/react`. `registerMinab(monaco, …)` takes the Monaco namespace as a parameter, so give it the one the editor uses (`onMount(editor, monaco)` or `loader.init()`). Minab never imports `monaco-editor` at run time. |
| `condition.schema.ts:53` + `surface.schema.ts` | `MINAB_EXPECT_TYPES` | OK as it is. The surface schema's `bound.expect` should use the same six values (the owner confirmed this on 2026-10-02). |

**`TODO.md`**

- `TODO.md:932`: "`@shamsine/minab` is published but exposes only a `bin`, no library entry point, and its
  interpreter needs a live data source". It is **not published** (not on 2026-10-01). Suggested
  text: "`@shamsine/minab` is not published yet. It will have a library API in 0.3.0
  (`createMinab`, a `DataPort`, a NestJS module, a browser worker); see the Minab repo's
  `docs/guides/shamsine.md`. Evaluation of `local` programs runs in the browser; `data` programs run on `core/service`."
- `TODO.md:919`: no change.
- `TODO.md` near line 3174 and 3178 ("server-side command handlers … when commands hold Minab code"): no change.

**New work the monorepo needs (new cards or notes)**

1. A public `DynodbService` method that gives a read-only, time-limited query function for one application (section 8).
2. A `ProgramStore` and a `schemaLoader` in `core/service/src/expression/` (M.5, M.8).
3. `toMinabSchema(dataset)` (M.5): sections 2 and 3, with `sqlName` for tables and system columns.
4. A check on a real application database for: the `id` column type, the system column names (`created_at`…),
   and soft-deleted rows.
5. A per-page `url` input type built from the page's declared parameters.
6. Translations: add the `minabErrors` block of section 9 to `translations.json`.
7. A rule for the DECIMAL strings: `core/web` must parse them with a decimal library.

## 13. Limits you will meet in 0.3.0

Facts a Shamsine session would otherwise find by surprise. The Minab side is listed in
the status file of phase G2 (`docs/production/status/G2.md`) for the owner.

- **No key access on `JSON`.** Fields stored as JSON (`location`, `address`,
  `attachment`, `lookup`, `formula`, …) can be tested for null or shape, not read by key.
- **`numberRange` and `timeline` are not usable.** Their columns are Postgres range
  types. Keep them out of the schema until Minab has a range type.
- **No `scalarType` helper in the public entry.** Write the small `scalar()` helper in
  the monorepo (section 3).
- **`languageVersion` is not enforced** until phase Q5.
- **No many-to-many link** and no write statements yet (writes come in phase X5; a run
  with no write port fails with `eval.writesNotSupported`).
- **The first `prepare` for a schema is slow** (about 90 ms in a browser, from the ADR
  spike) and later ones are fast. Keep one worker and one runtime per schema version.
- **Limits are always on (D36).** Defaults: 64 KB source, 200 nesting levels, 1,000 ms,
  100 statements, 10,000 rows per statement, 100,000 loop steps, 64 call depth, 100 log
  lines, 100 runs per batch. A host may change them with `createMinab({ limits })`; a
  run can only be tighter.
