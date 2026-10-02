# Changelog fragments

Phases never edit `CHANGELOG.md`. Instead, a phase whose change a user, a host
developer or an editor user can see writes one fragment here. Pure test or CI
changes need none.

The rules come from [`docs/production/README.md`](../docs/production/README.md#changelog-fragment-format).

## Rules

- One fragment per phase: `changes/<ID>.md`, for example `changes/C3.md`.
- If a phase has two different user-visible changes, the second one goes in
  `changes/<ID>-2.md`.
- A phase adds or changes only its own fragments. The guard
  (`scripts/plan-guard.mjs`) checks this on every pull request.
- Only release phases (V1, V2, V3, V5) turn fragments into a `CHANGELOG.md`
  section, with `scripts/changelog.mjs` (from Q2). They delete the fragments
  they used.

## Template

```markdown
---
type: added | changed | deprecated | removed | fixed | security
scope: language | runtime | cli | node | nestjs | browser | editor | vscode | playground | docs | build
breaking: false
---
One or two sentences for users, in plain English and present tense. Name the new thing or the fixed behavior, not the files.
```

Pick one value for `type` and one for `scope`. Set `breaking: true` only when
the change breaks something users already rely on.
