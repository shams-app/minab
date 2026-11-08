---
name: Bug report
about: A Minab program gives a wrong answer, fails, or the tools misbehave
title: ''
labels: bug
---

<!--
A security problem (a program that crashes or hangs its host, injects SQL, reads outside its
schema or leaks data)? Do not open an issue. Send an email to security@minab-lang.org (see SECURITY.md).
-->

## The program

```minab
// The smallest Minab program that shows the problem.
```

## The schema and the record

```json
{
  "schema": { "tables": [] },
  "record": {}
}
```

The `minab.config.json` you used, or the schema your app gives to `createMinab`. Remove private data.

## What you expected

## What happened

The output, the error code (for example `eval.castFailed`) and the message.

## Where it ran

- `@shamsine/minab` version (`minab --version`):
- Where: CLI / Node app / NestJS / browser worker / playground / VS Code extension
- Database: none, PostgreSQL (version), or PGlite
- Node.js version, or the browser:
