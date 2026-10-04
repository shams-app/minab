# Security notes for hosts

This page is for the developer who runs Minab programs inside an application, for example Shamsine's server.
It says what a Minab program can do, what it cannot do, and what **you** must do so that it stays that way.
To report a problem in Minab itself, read [`SECURITY.md`](../SECURITY.md).

## Threat model

### Who writes programs

Assume **every program is untrusted input** (decision D01). In Shamsine, app builders write Minab in the browser.
They are your users, not Minab developers. A program may be written by a person who wants to learn data they
should not see, to slow the server down, or to break it.

### What a program can do

A program can do exactly these things:

- read the **schema it is given**: the tables and columns in the `schema` of `createMinab` (and nothing else);
- call the **host functions** it is given (`functions` of `createMinab`) and read the **host inputs** it is given;
- with a write port, change rows through `INSERT`, `UPDATE` and `DELETE` (only when your run gives a write port);
- use time and memory **up to the limits** you set.

A program cannot:

| It cannot | Why |
|---|---|
| Read a table or column that is not in the schema | `#Secret` is a scope error at `prepare`. No data port is called. |
| Run SQL of its own | Programs are Minab, not SQL. The compiler quotes every name and sends every value as a `$n` parameter. The SQL text never holds a value. |
| Run forever | `wallTimeMs`, `loopIterations`, `statements`, `callDepth` and `rowsPerStatement` stop a run with a `limit.*` error. |
| Crash the host with a big or deep program | `sourceLength` and `nestingDepth` stop it at `prepare` with a `limit.*` diagnostic. |
| Reach files, the network or `process` | The language has no such feature. Only host functions can, and you write them. |
| Fake a log line | Every logged value is one line. Newlines and control characters are escaped. |

These claims have tests: [`test/security/`](../test/security/) and [`test/fuzz/`](../test/fuzz/).

### What a program may get from you

Everything you give a program is part of its read surface: every table in the schema, the result of every host
function, every host input. A host function that returns another user's data gives that data to the program.

## What the host must do

1. **Scope the schema for each tenant or user.** The schema is the whole read surface. Give a program the tables
   (and columns) its author may read, and no more. With the NestJS module, `schemaLoader(context)` runs for every
   request: build the schema from the request's user and tenant.
2. **Give a schema its own `version`, and change it when the schema changes.** The runtime and the prepared
   programs are cached by `version`. Two different schemas with one `version` share one cache entry, and one
   tenant would see the other's tables. Use a version such as `tenant-42:v7`.
3. **Keep the limits on.** The defaults (decision D36) are safe for most hosts: 64 KB source, nesting 200, 1 s wall
   time, 100 statements, 10,000 rows for each statement, 100,000 loop iterations, call depth 64, 100 log entries,
   100 runs for each request. Lower them for cheap paths. Never set one to a huge number to "make it work". A run can
   only make the limits tighter, never looser.
4. **Never accept SQL or a schema from a browser.** The run endpoint takes ids and data. The schema, the data
   port and the host functions are yours. Do not copy a schema, a table name or a column name from a request.
5. **Run stored programs by id** (decision D34). Store each program as `{ source, languageVersion }` and let the
   client send only the id and the version. Leave `endpoint.allowSource` off. It is for development only. Do not set
   it from `NODE_ENV`.
6. **Guard the endpoint.** Put an authentication guard on the run endpoint (`endpoint.guards`), and check in your
   `ProgramStore` that the caller may run that program.
7. **Keep logs off in production** (decision D37). The NestJS logger is off by default when `NODE_ENV` is
   `production`. A logged value can hold personal data (an email, a name, an amount). If you turn logs on, do it
   on purpose, keep the cap, and keep the log in a place with the same access rules as the data.
8. **Do not send errors raw to the client.** Use the `MinabExceptionFilter`. It never sends SQL text, a driver
   message or a stack trace. A `data.error` carries only a code and the SQLSTATE. If you write your own mapping,
   keep it that way.
9. **Use a read-only database role for programs that do not write.** The data port runs the SQL that Minab
   compiles. A role that can only `SELECT` limits the harm of any bug, in Minab or in your host functions.
   Give a writing role only to the runs that have a write port.
10. **Consider row-level security.** Postgres row-level security (`CREATE POLICY`) makes the database enforce
    "this user sees only these rows", whatever the SQL is. Set the user or tenant for the transaction
    (`SET LOCAL`) in your data port. This is the host's job. Minab does not set it up.
11. **Write host functions as if their arguments were hostile.** A program chooses the arguments. Check them, keep
    each call cheap, honor the `AbortSignal`, and do not return more than the program should see. Minab stops waiting
    for a function when the wall time ends, but it cannot stop the function itself.
12. **Watch what you cache.** A prepared program is safe to share between requests of one schema version. Do not
    share a data port, a transaction or a record between requests.

## Known limits of the protection

- The `LIKE` matcher runs in the host process and cannot be interrupted. Its time is at most the text length times
  the pattern length. The default source limit (64 KB) bounds a pattern in the program, but a pattern or a text
  that comes from your data is as long as your data. Cap the length of text fields that programs match.
- Parsing time grows faster than the size of a deeply nested program. A program that is just under the nesting
  limit can take about a second to prepare. Prepare stored programs once, when they are saved, and cache the result.
- A host function that ignores the `AbortSignal` keeps running after the wall time. The run ends on time, but the
  function does not.
- Decimal and integer arithmetic follows Postgres. A huge exponent or a very long number costs time in the database.
  The statement and row limits do not cover the cost of one statement. Use the database's `statement_timeout`.

## Checklist

- [ ] The schema is built for each request from the user and tenant.
- [ ] The schema `version` changes when the schema changes.
- [ ] Limits are on (the defaults, or tighter).
- [ ] The server never takes SQL or a schema from a client.
- [ ] Programs run by id and version. `allowSource` is off.
- [ ] The run endpoint has a guard.
- [ ] Logs are off in production, or on by a decision.
- [ ] Errors go through `MinabExceptionFilter`.
- [ ] Read-only role for read-only programs. Row-level security considered. `statement_timeout` set.
