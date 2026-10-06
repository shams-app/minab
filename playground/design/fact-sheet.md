# Minab: fact sheet

One page. Copy from it for a press note, a TV caption or a talk. Numbers are for **Minab 0.3.0**, checked on 2026-10-06. Update them before you use them.

## What it is, in three sentences

Minab is a small programming language for two jobs that usually live apart: **querying relational data** and **validating a record before it is saved**. It checks types before it runs anything, and it compiles to PostgreSQL. The whole toolchain runs in your browser, and the same runtime runs inside a NestJS server.

## Who it is for

- **App builders** who write rules for their own forms and data, for example in Shamsine.
- **Developers** who embed a rule language in a web or Node app and want it safe: a program written by an end user cannot run forever, cannot read outside the schema it was given, and cannot inject SQL.
- **Teams that work in more than one language**: table and field names can be in Persian, Turkish or any other script, and money uses exact decimals.

## Three numbers

| | |
|---|---|
| **2,602** automated tests pass at 0.3.0 (the language, the runtime and the compiler). The playground adds its own tests on top. | `npm test` at the repository root |
| **9 performance budgets**, checked on every change. For example: a typical rule is prepared in about **0.5 ms**, and a rule that needs no data runs in about **0.02 ms**. | `docs/performance.md` |
| **Any language for names**: Persian (Arabic script) and Turkish names, with their special letters, are tested. The site has a Persian example. | the playground, "Names in Persian" |

More that is true today: 32 verified examples, a 12-lesson tour, and a browser bundle of about 189 KB (gzip) for the language worker.

## What to say, and what not to say

| Say | Do not say (yet) |
|---|---|
| "Runs in your browser, with a real PostgreSQL (WebAssembly)." | "Production ready" or "1.0": Minab is 0.3.0. Before 1.0 a release may break something. |
| "The same runtime runs in a NestJS server." | "Proven correct": say the interpreter and the compiled SQL are **tested against each other**. |
| "Strict types. Exact decimals. Names in any language." | A link to the GitHub repository: it is private (D04). Link the site and npm. |

## The name

The owner decides if and how to tell it (D40). The site has the line: Minab is a city in southern Iran, and the language is named in memory of the 168 children and their teachers who were killed when their school was bombed.

## Links

- Playground and tour: https://minab-lang.org
- npm: `@shamsine/minab` (public)
- Spec, security notes and performance notes: in the npm package, and on the site
- Owner's portfolio: https://hamcker.github.io
- TV demo plan: [`tv-demo.md`](tv-demo.md) · Launch kit: [`launch-kit.md`](launch-kit.md)
