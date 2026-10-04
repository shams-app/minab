# test/nestjs

Tests of the NestJS integration (`src/nestjs/`, phase H2). They use `@nestjs/testing`. No HTTP server is started: a test
gets the controller from the module and calls it, and the filter test gives the filter a fake HTTP adapter.

## Files

- `support.ts`: the schema, a memory `ProgramStore`, a fake data port and `boot()`.
- `service.test.ts`: the module (`forRoot`, `forRootAsync`), `prepare`, `run`, `runStored` and its cache, one schema for each tenant.
- `filter.test.ts`: each error code to its HTTP status, the 500 body without SQL, and the logger (production default, one line, cap).
- `controller.test.ts`: the run endpoint: stored programs, source refused or allowed, 100 and 101 runs, server ports and inputs, logs.

## Rules

- A test file here needs the legacy decorators. `vitest.config.ts` turns them on, and `tsconfig.nestjs.json` compiles this folder.
- The packed package is tested in `test/consumers/nest-cjs/`.
