# src/nestjs

The entry `@shamsine/minab/nestjs` (phase H2, ADR 0002 section 8.2): Minab inside a NestJS app. It needs
`@nestjs/common`, `@nestjs/core`, `rxjs` and `reflect-metadata` from the host (optional peers). It is compiled with
`tsconfig.nestjs.json` (decorator options) after the root build.

## Files

- `index.ts`: the public exports.
- `module.ts`: `MinabModule.forRoot(options)` and `forRootAsync({ useFactory, inject, imports, endpointPath?, guards? })`. The module is global.
- `options.ts`: `MinabModuleOptions`, `ProgramStore`, `StoredProgram`, `MinabContext`, the endpoint and log options.
- `service.ts`: `MinabService`: `prepare`, `run`, `runStored`, and `loadStored` / `loadSource` (a prepared program with its schema).
- `exception.ts`: `MinabException` and `minabHttpStatus(code)`.
- `filter.ts`: `MinabExceptionFilter`: a Minab error to an HTTP answer.
- `logger.ts`: `MinabLogger`: an `EventSink` that writes to Nest's `Logger`.
- `controller.ts`: the run endpoint (`POST <path>`, wire format v1).

## Use

```ts
@Module({
    imports: [
        MinabModule.forRoot({
            schemaLoader: ctx => schemaFor(ctx.tenant), // { version, tables }, called for each request
            functions, inputs, limits,
            programStore, // { get(id, version, { signal }) => { id, version, source, languageVersion } | undefined }
            endpoint: { path: 'minab/run', guards: [AuthGuard], ports: ctx => ({ data: pgDataPort(txOf(ctx.request)) }), hostInputs: ctx => ({ currentUser: userOf(ctx.request) }) }
        })
    ]
})
export class AppModule {}

const result = await minab.runStored(id, version, { record }, { data }, { context: { tenant } });
```

## Rules

- The schema, the ports and the host functions are the server's. The run endpoint never takes any of them from the client.
- The run endpoint runs **stored programs** (`program.ref`). `program.source` is refused unless `endpoint.allowSource` is true. That is for development (D34). Never set it from `NODE_ENV`.
- Put a guard on the endpoint (`endpoint.guards` with `forRoot`, `guards` next to `endpointPath` with `forRootAsync`, or the app's global guards). Without one, anyone who can reach the route can run stored programs.
- With `forRootAsync`, the route and its guards are fixed before the factory runs. If the factory returns `endpoint.path` or `endpoint.guards`, the app stops at startup with a message that names the fix. A guard is never ignored.
- A valid request is HTTP 200, even when some runs fail: each result has its own `ok` and `error`. A bad request is 400 (the filter).
- A runtime is cached by the schema's `version` and a SHA-256 hash of its content, so two different schemas never share one, even under one `version`. The hash is made once for each schema object (a `WeakMap`): never change a schema object after the loader returned it. Prepared programs are cached by that schema key, program id and program version. A program id and version must never change its source.
- `runStored` throws a `MinabException` for an unknown program (404) and a program with errors (422). `run` never throws for a failed program.
- Logs are off by default when `NODE_ENV=production` (D37). When on, each run writes at most 100 lines (D36), every value on one line, tagged with the program id and request id. Logged values may hold personal data. Statement lines (option `logs.statements`) have the SQL text, never the parameter values.
- A 500 answer never has SQL, a driver message or a stack: only the code (and the SQLSTATE).
- Every injection uses `@Inject(...)`, so the esbuild CommonJS bundle needs no type metadata.
