# test/nestjs

Tests of the NestJS integration (`src/nestjs/`, phase H2). They use `@nestjs/testing`. Most tests start no HTTP server: a
test gets the controller from the module and calls it, and the filter test gives the filter a fake HTTP adapter. Only
`host-safety.test.ts` starts a real server (Nest's Express adapter on a free local port), because a guard runs only on a
real request.

## Files

- `support.ts`: the schema, a memory `ProgramStore`, a fake data port and `boot()`.
- `service.test.ts`: the module (`forRoot`, `forRootAsync`), `prepare`, `run`, `runStored` and its cache, one schema for each tenant.
- `filter.test.ts`: each error code to its HTTP status, the 500 body without SQL, and the logger (production default, one line, cap).
- `controller.test.ts`: the run endpoint: stored programs, source refused or allowed, 100 and 101 runs, server ports and inputs, logs.
- `host-safety.test.ts`: phase H8: `forRootAsync` guards (403 over HTTP, startup errors for `endpoint.guards` and `endpoint.path` in the factory), and one runtime for each schema under one `version`.
- `security.test.ts`: the security claims of `docs/security.md` for this module (phase Q3): schema from the server, source refused, batch limit, error bodies, logs.

## Rules

- A test file here needs the legacy decorators. `vitest.config.ts` turns them on, and `tsconfig.nestjs.json` compiles this folder.
- The packed package is tested in `test/consumers/nest-cjs/`.
