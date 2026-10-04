# test/consumers

Smoke tests for the **packed** package. Each folder is a tiny project of one kind. The runner
(`run.mjs`) packs the package with `npm pack`, copies each folder to a temporary directory,
installs the tarball there and runs it. Nothing here imports from `src/`.

## Files

- `run.mjs`: the runner. `npm run test:consumers` runs all, `npm run test:consumers -- esm cjs` runs some.
  `MINAB_TARBALL=<file>` skips the pack and uses that tarball.
- `esm/`: an ES-module Node project (`import`), the package and `./node`.
- `cjs/`: a CommonJS Node project (`require`), the same checks.
- `nest-cjs/`: a CommonJS Node project with NestJS 11. It boots a module with `MinabModule.forRoot` from `@shamsine/minab/nestjs` and runs a stored program (H2).
- `jest/`: a Jest test in a CommonJS project with the default Jest config.
- `bun/`: a Bun script that imports the package.
- `ts-node-resolution/`: (`tsconfig.old.json`, so linters do not read it) a TypeScript project with `moduleResolution: node` (old style).
  It type-checks `@shamsine/minab/node`, which proves `typesVersions`.

## Rules

- A consumer uses only public entries of the package, as a user would.
- A consumer must fail when its entry is missing from the tarball. Never skip one to get green.
- CI runs them in `.github/workflows/consumers.yml` (Node 22 and 24, and Bun).
- The Bun consumer needs `bun` on the path. Locally, install Bun or run the others by name.

## Known limit

The `.d.ts` files of the package import `langium`. Old resolution (`moduleResolution: node`) cannot
find Langium's subpath types, so the old-style consumer sets `skipLibCheck: true`, as `nest new` does.
