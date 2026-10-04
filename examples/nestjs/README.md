# examples/nestjs

A small NestJS app that uses Minab the way a Shamsine service would. It is its own npm package
(like `playground/`): CommonJS, TypeORM, Postgres, Jest and supertest, as `nest new` sets them up.
It installs Minab from the **packed tarball**, so its tests check what a user gets.

The guide in G1 cites this app. The browser example (H6) calls its run endpoint.

## Run it

You need Node 22 and a Postgres. The default URL is `postgresql://minab:minab@localhost:5432/minab_example`;
set `DATABASE_URL` for another one.

```sh
cd examples/nestjs
npm ci
npm run setup      # npm pack in the repository root, then install the tarball here
npm run migrate    # the tables and the stored programs
npm test           # the end-to-end tests
npm start          # http://localhost:3000
```

Run `npm run setup` after `npm ci`. It installs the tarball without changing `package.json` or the lockfile.

## Files

- `src/schema.ts`: the schema Minab programs may read (`Customer`, `Order`).
- `src/migrations/`: the migration. It makes the tables and the table of stored programs `minab_program (id, version, source, language_version)`, with two programs.
- `src/data-source.ts`, `src/migrate.ts`: the TypeORM data source, and the script `npm run migrate`.
- `src/program-store.ts`: `DatabaseProgramStore`. It reads `minab_program`.
- `src/app.module.ts`: `TypeOrmModule` and `MinabModule.forRootAsync`.
- `src/orders.controller.ts`: `POST /orders/validate`.
- `src/reports.controller.ts`: `GET /reports/top-customers`.
- `test/`: the end-to-end tests and their helpers. `scripts/setup.mjs`: the packed install.

## The walkthrough

**1. Install.** `@shamsine/minab` and its optional peers `@nestjs/common`, `@nestjs/core`, `rxjs` and
`reflect-metadata`. `pg` and TypeORM stay the app's own. Minab never depends on them.

**2. The schema loader.** `schemaLoader` gives Minab the schema for each request. Here it is one constant.
For tenants, choose the schema from the request. Give each schema a `version`: prepared programs are cached by it.

**3. The program store.** Programs live in `minab_program`. A program with an id and a version never changes.
A new rule is a new version. `ProgramStore.get(id, version)` finds one. The module caches the prepared program.

**4. A rule in the request's transaction.** `POST /orders/validate` opens a `QueryRunner` transaction and inserts the
order. Then it runs the stored rule `order-limit` v1 (`COUNT(#Order[.customer == ^.customer AND .status == "open"]) <= 5`:
a customer may have at most five open orders). The data port is made from the same `QueryRunner`
(`queryFunctionDataPort((text, params) => runner.query(text, params))`), so the rule reads the order that was just
written. On `true` the transaction commits and the answer is 201. On `false` it rolls back and the answer is 422 with
`{ ok: false, rule: { id, version } }`. A rule that fails to run also rolls back: a broken stored program is a
422 with the error code (the filter), never a half-saved order.

**5. A stored query.** `GET /reports/top-customers` runs the stored query `top-customers` v1 with a data port on
the pool. A query writes nothing, so it needs no transaction.

**6. The run endpoint.** `MinabModule.forRootAsync({ endpointPath: 'minab/run', ... })` mounts `POST /minab/run`.
It takes a wire v1 request with `program.ref` (id and version) and runs stored programs. The `ports` function gives the
data port. The endpoint refuses `program.source` unless `allowSource` is set. That is for development: never
set it from `NODE_ENV`.

**7. Logs.** They are off when `NODE_ENV=production` (D37). With statement logging on, a run writes the SQL text, never the
parameter values.

## Security note: the schema is the read surface

A program can read the tables and columns in the schema you give it, and nothing else. Keep the schema small.
The schema, the data port and the host functions are the server's. The client sends only a program id, a version and
values. Put a guard on the run endpoint (for example `APP_GUARD`): without one, anyone who can reach the route can run
stored programs. This example has no guard, to keep it short. Do not copy that.

## Rules

- Install Minab only from the tarball (`npm run setup`). Never link `../..` or import from `src/`.
- This folder is not in the npm package (`files` in the root `package.json`).
- `test/examples.test.ts` ignores this folder: it has no `nestjs.minab` program.
