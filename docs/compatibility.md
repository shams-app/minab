# Compatibility

What can change between Minab versions, and how a host keeps stored programs working.
The policy is decision D38.

## The policy

- **Before 1.0, anything may break.** The language, the runtime API, the wire format and the
  diagnostic codes can change in any release. A change that breaks something is marked
  `breaking: true` in its changelog fragment, so the CHANGELOG shows it. No migration is needed.
- **From 1.0, the 1.x promise.** No breaking change to the language, the runtime API, the wire
  format or the diagnostic codes within 1.x. Stored programs keep working.
- **Deprecations.** From 1.0, a form that is going away gets a warning with a `deprecated.*` code
  for at least one minor release. It is removed only in the next major release. Before 1.0 a form
  may be removed at once. There is no `deprecated.*` code today.
- Versions follow semantic versioning.

## Language version

`LANGUAGE_VERSION` (exported by `@shamsine/minab`) is a whole number. It is `1` for the language of 0.2.0.
It goes up only when the meaning of valid programs changes, or when a form is removed.
Most releases do not change it.

A host stores the version next to each program:

```ts
import { LANGUAGE_VERSION } from '@shamsine/minab';

// when it saves a program
const stored = { source, languageVersion: LANGUAGE_VERSION };

// when it prepares a stored program
const program = await minab.prepare(stored.source, { languageVersion: stored.languageVersion });
```

| `languageVersion` | What `prepare` does |
|---|---|
| missing | Uses the current version. |
| newer than the runtime | Gives the error `compat.newerLanguage`. The program is not checked. Update Minab. |
| older than the runtime | Runs the migrations between the two versions, then checks the result. |
| equal | Checks the source as it is. |
| not a whole number of 1 or more | Throws a `TypeError`. It is a bad call. |

After a migration, the diagnostics refer to the migrated source, not to the stored one.
If a step is missing, `prepare` gives `compat.noMigration`.
Today there are no migrations, because only version 1 exists.

## Migrations

`migrate(source, fromVersion, toVersion)` (in `src/runtime/migrate.ts`) applies the list `MIGRATIONS`.
Each migration moves one version up:

```ts
{ from: 1, to: 2, describe: 'what changes in a program', transform: source => /* new source */ }
```

A phase that raises `LANGUAGE_VERSION` also adds the migration, a corpus folder for the new
release, and a note in the CHANGELOG. A host can call `migrate` itself to rewrite stored programs
once and save them with the new version. A `minab migrate` CLI command may come after the first real migration.

## Golden corpus

`test/compat/corpus/<version>/` holds programs from a release and what that release said about them:

- `*.minab`: the programs. They come from the spec, the showcase and `examples/`.
- `schema.json`: the tables the spec and showcase programs use.
- `example-*.config.json`: the config (schema and fixture data) of each example.
- `expected.json`: for each program, the diagnostic codes of `prepare`, and the run result for
  examples (the value or the error code, and the number of statements).

`test/compat/compat.test.ts` runs every folder against today's code. A program whose answer
changed fails the test and is named in the message.

- **Before 1.0**: a phase that changes a result on purpose updates `expected.json` of the folder and
  marks its changelog fragment `breaking: true`.
- **From 1.0**: an expectation in a 1.x folder never changes. If a test fails, the code is wrong.

A release phase makes a new folder with:

```sh
npm run build
npm run compat:snapshot 0.3.0
```

The script writes `test/compat/corpus/0.3.0/` from the current code. It never overwrites a folder.
