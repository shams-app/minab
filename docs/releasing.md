# Releasing Minab

This is the checklist for the release phases (V1, V2, V3, V5). A release is one
tag push. The tag starts `.github/workflows/release.yml`.

## What a release publishes

| Place | What | Who can see it |
|---|---|---|
| npm | `@shamsine/minab` | Everyone |
| VS Code Marketplace | the extension, publisher `shamsine` | Everyone |
| Open VSX | the extension, namespace `shamsine` (Cursor, VSCodium) | Everyone |
| GitHub release | the CHANGELOG section as notes, and the `.vsix` | Repository members only |

The repository stays private (decision D04). So the GitHub release and its
`.vsix` are visible only to repository members. The public places are npm, the
Marketplace and Open VSX. For the same reason, npm packages have no provenance
for now. The workflows add `--provenance` by themselves if the repository
becomes public.

## One-time setup (the owner)

1. **npm trusted publishing.** On npmjs.com, open the package `@shamsine/minab`,
   then Settings, then Trusted Publisher. Add the GitHub repository
   `shams-app/minab` and the workflow file `release.yml`. Add a second one for
   `next.yml`. No token is needed. (For the very first publish, the package must
   exist: publish `0.2.0` once by the method npm allows for a new package, or
   create it as the npm docs say.)
2. **`VSCE_PAT`.** A Marketplace token for the publisher `shamsine`. Store it as
   a repository secret.
3. **`OVSX_PAT`.** An Open VSX token for the namespace `shamsine`. Store it as a
   repository secret.

A missing secret does not fail the release. The step prints
`skipped: secret ... not set`. Check the log, and publish that part by hand or
run the release again after you add the secret.

## The checklist

1. **Choose the version** (`X.Y.Z`). Before 1.0, any release may break things.
   After 1.0, follow semantic versioning.
2. **Make a branch** `release/vX.Y.Z` from an up-to-date `main`.
3. **Check the fragments:** `node scripts/changelog.mjs --check`.
4. **Write the CHANGELOG:** `node scripts/changelog.mjs --version X.Y.Z`
   (add `--date YYYY-MM-DD` to set the date). It writes the new section in
   `CHANGELOG.md` and a shorter one in `vscode-extension/CHANGELOG.md`, and
   deletes the fragments it used. Read the result and fix the wording by hand
   if needed.
5. **Bump the versions:** `node scripts/bump-version.mjs X.Y.Z`. It changes
   `package.json`, `vscode-extension/package.json` and both lockfiles. No commit
   and no tag.
6. **Run the checks:** `npm run build`, `npm test`, and `npm run lint`. The
   release metadata test (`test/release.test.ts`) must pass: both versions are
   equal and the newest CHANGELOG section is this version.
7. **Open a pull request** titled `[V…] Release X.Y.Z`. Merge it when CI is green.
8. **Test the release without publishing.** In the Actions tab, run
   **Release** on `main` with `dry-run` on (the default). It builds, tests with
   Postgres, builds the `.vsix`, and runs `npm publish --dry-run`.
9. **Push the tag** (the owner, or a session the owner told to):
   `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag must be `v` plus the
   `package.json` version, or the workflow stops.
10. **Watch `release.yml`.** It checks the tag, builds, tests, builds the
    `.vsix`, publishes to npm, creates the GitHub release, and publishes the
    extension (if the secrets exist). A prerelease version (`X.Y.Z-rc.1`) is
    published to npm under the tag `next`, and the GitHub release is marked as a
    prerelease.
11. **Check from a clean machine:** `npx @shamsine/minab@X.Y.Z --version`.
12. **Check the pages:** the npm page, the Marketplace page and the Open VSX
    page show version `X.Y.Z`.
13. **Do the manual VS Code check:** install the extension, open a `.minab` file,
    and see highlighting, diagnostics and hover.

If `release.yml` fails after the npm step, do not push the tag again: npm does
not allow the same version twice. Fix the problem, bump to the next patch
version and release that.

## The API reference

`npm run docs:api` builds the API reference (TypeDoc) into `out/api/`. It is not
committed. The website (W4) or the release (V2) publishes that folder.

## The `next` channel

Every merge to `main` that changes the package runs `.github/workflows/next.yml`.
It publishes `X.Y.Z-next.N` to npm under the tag `next` (see
`scripts/next-version.mjs`). The version is set in the CI workspace only. It is
never committed.

- Merges that change only `docs/**`, `playground/**` or Markdown files do not
  publish.
- `npm install @shamsine/minab` gets only real releases.
  `npm install @shamsine/minab@next` gets the newest prerelease.

## The scripts

| Script | What it does |
|---|---|
| `scripts/changelog.mjs` | `--version X.Y.Z`, `--check`, `--notes X.Y.Z` |
| `scripts/bump-version.mjs` | `X.Y.Z` sets both package versions |
| `scripts/next-version.mjs` | `--run N` prints the prerelease version |

Tests: `test/release-scripts.test.ts`.
