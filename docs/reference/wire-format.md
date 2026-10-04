# Wire format v1

One JSON format for "run these programs with these inputs" and its answer. The server
(H2) and the browser client (H5) both use it. It is code in `src/runtime/wire.ts`, and
JSON Schema files for other languages are in `schemas/`.

Before 1.0 the format may change in any release. After 1.0, v1 is frozen. A change that
only adds optional fields stays v1. Anything else is v2, and a server may offer both (D38).

## Rules

- The transport is up to the host. Usually it is an HTTP `POST` with a JSON body. Transport,
  login and the endpoint are not part of this format (H2, H5).
- A client **ignores fields it does not know**. A server ignores unknown request fields too,
  but **rejects** a known field with a bad shape.
- An error holds a code, an English message and `params`. It never holds the value that was
  wrong, only where it is (`params.path`). Nothing private goes into logs.
- The HTTP status for a valid request is 200, even when some runs fail. A request that fails
  as a whole gets the error body (see below).

## Request

```json
{
  "v": 1,
  "runs": [
    {
      "id": "r1",
      "program": { "ref": { "id": "view_8f2:el_ab12cd:props.visible", "version": "17" } },
      "record": { "id": "o-1", "total": "24.90", "due": "2026-10-02" },
      "fieldValue": null,
      "inputs": { "url": { "tab": "open" } },
      "options": { "limits": { "wallTimeMs": 500 }, "logs": false }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `v` | The wire version. Must be `1`. Another value gives `wire.unsupportedVersion`, and the error lists the versions the server knows. A missing `v` is `wire.invalidRequest`. |
| `runs` | One to `batchRuns` runs (100 by default, D36). More is `wire.tooManyRuns`. |
| `runs[].id` | A text chosen by the client. It is echoed back. It must be unique in the request. |
| `runs[].program` | `{ "ref": { "id", "version" } }`: a stored program, found by the host's program store (D34). Or `{ "source": "..." }`: program text. A server accepts `source` **only in development mode**. Otherwise the request is `wire.invalidRequest` at `program.source`. Give `ref` or `source`, not both. |
| `runs[].inputs` | Optional. The values of the declared host inputs, by name. The server may override the ones that matter for security (such as the current user) from its own session. |
| `runs[].record` | Optional. The record under validation. |
| `runs[].fieldValue` | Optional. The value of `$`. |
| `runs[].options.limits` | Optional. Limits for this run. They can only make the host's limits **tighter** (R4). A limit is a number above zero. |
| `runs[].options.logs` | Optional. Ask for the log entries. The host decides if it sends them (D37). |

The time zone and the clock belong to the server. A request cannot set them.

## Response

```json
{
  "v": 1,
  "results": [
    { "id": "r1", "ok": true, "value": true, "logs": [], "stats": { "statements": 1, "rows": 1, "durationMs": 3 } },
    {
      "id": "r2",
      "ok": false,
      "error": { "code": "limit.tooManyStatements", "message": "the run went over the limit of 100 statements sent to the data source", "range": null, "params": { "limit": 100 } },
      "stats": { "statements": 100, "rows": 4000, "durationMs": 61 }
    }
  ]
}
```

- There is one result for each run, with the same `id`.
- `ok: true` has `value` (encoded by its type, see below) and `stats`. `logs` is optional.
- `ok: false` has `error`: `{ code, message, range?, params }`. The `code` is in the
  [diagnostic registry](diagnostics.md). A client maps by `code` and never parses `message`.
  `stats` is optional.
- A request that fails as a whole (`wire.unsupportedVersion`, `wire.invalidRequest`,
  `wire.tooManyRuns`) gets `{ "v": 1, "error": { "code", "message", "params" } }`.
  `parseResponse` accepts both shapes.

## Value encoding

The same rules in both directions: for `inputs`, `record`, `fieldValue`, and `value`.

| Minab type | JSON | Note |
|---|---|---|
| `TEXT`, `CITEXT`, `UUID` | string | |
| `INTEGER` | number | A whole number in ±9,007,199,254,740,991 (D17). |
| `DECIMAL` | **string** | `"24.9"`. Exact (D17). Never a JSON number: a number is refused on input. The output is the shortest exact form (no trailing zeros, no exponent). |
| `BOOLEAN` | `true` / `false` | |
| `DATE` | string `"2026-10-02"` | ISO 8601 (D21). |
| `TIME` | string `"08:30:00"` | Fraction of a second allowed: `"08:30:00.5"`. |
| `DATETIME` | string `"2026-10-02T08:30:00.000Z"` | An instant. Always UTC, always with `Z` (D21). An offset such as `+03:30` is refused. |
| `JSON` | as is | Numbers inside stay JSON numbers (D17). |
| array `T[]` | JSON array | Each element by its own encoding. |
| `null` | `null` | Allowed for every type. |
| a record (a row) | object | Each field by its own type. A field the type does not name is refused. |
| a list of records | array of objects | |

Decoding does not guess: `"24.90"` for an `INTEGER` is an error (`wire.invalidValue`, with `params.path`).

### In code

```ts
import { decodeValue, encodeValue, wireScalar } from '@shamsine/minab';

const decimal = wireScalar('DECIMAL');
encodeValue(new Big('24.9'), decimal); // "24.9"
decodeValue('24.9', decimal); // Big("24.9")
```

`encodeValue(value, type)` and `decodeValue(json, type)` round-trip exactly. In the interpreter a
`DECIMAL` is a `Big`, a `DATETIME` is a `Date`, and `DATE` and `TIME` are text. The `type` is a
scalar type of the checker (`base`, `array`), or `{ kind: 'record', fields }`, or `{ kind: 'list', item }`.
Both functions throw a `WireError` (its `error` is the coded form).

## Checking a request or a response

```ts
import { parseRequest, parseResponse } from '@shamsine/minab';

const parsed = parseRequest(JSON.parse(body), { maxRuns: 100, allowSource: false });
if (!parsed.ok) return { v: 1, error: parsed.error }; // wire.* code
```

| Code | When |
|---|---|
| `wire.unsupportedVersion` | `v` is present and is not a known version. `params`: `version`, `supported`. |
| `wire.invalidRequest` | The request has a bad shape. `params`: `path`, `reason`. |
| `wire.invalidResponse` | The response has a bad shape. `params`: `path`, `reason`. |
| `wire.tooManyRuns` | More runs than `maxRuns` (D36: 100). `params`: `limit`, `used`. |
| `wire.invalidValue` | A value does not fit its type. `params`: `path`, `expected`. |

## JSON Schema

For clients that are not TypeScript:

- [`schemas/wire-v1.request.json`](../../schemas/wire-v1.request.json)
- [`schemas/wire-v1.response.json`](../../schemas/wire-v1.response.json)

A test checks that they name the same fields as the TypeScript types and accept and refuse the
same messages as `parseRequest` and `parseResponse`. The schemas cannot check the rules that need
more than the shape: unique ids, the number of runs the host allows, and whether `source` is allowed.
