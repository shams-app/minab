# test/compat

The compatibility guard (production plan Q5, decision D38). See `docs/compatibility.md`.

## Files

- `compat.test.ts`: runs every corpus folder against today's code, and tests `languageVersion` and `migrate`.
- `corpus.ts`: the code shared by the test and `scripts/compat-snapshot.mjs`: how a program is
  checked and run, how a folder is compared, and how a new folder is written.
- `corpus/<version>/`: the golden corpus of one release (`*.minab`, `schema.json`, `example-*.config.json`, `expected.json`).

## Rules

- A corpus folder is made by `npm run compat:snapshot <version>`, never by hand. The script does not overwrite a folder.
- Before 1.0 a phase may change an expectation on purpose. It marks its changelog fragment `breaking: true`.
- From 1.0 an expectation in a 1.x folder never changes.
