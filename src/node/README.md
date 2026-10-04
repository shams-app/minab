# src/node

The entry `@shamsine/minab/node`: the Node adapters. A host gives Minab its database
with one line, and the program runs in the request's own transaction.

## Files

- `index.ts`: the package entry. It exports `pgDataPort`, `connectPostgres`, `queryFunctionDataPort` and `systemClock`.
- `pg.ts`: the PostgreSQL data port. `pgDataPort(clientOrPool)` wraps a `pg` client, pool or transaction client.
  `connectPostgres(url)` loads `pg` from the host's install and connects (the CLI uses it).
- `query-function.ts`: `queryFunctionDataPort((text, params) => rows)`. It fits TypeORM and Prisma. Also the shared error wrapper.
- `clock.ts`: `systemClock(timeZone?)`. The real time, in an IANA time zone (default `UTC`).

## Use

```ts
import { createMinab } from '@shamsine/minab';
import { pgDataPort, queryFunctionDataPort, systemClock } from '@shamsine/minab/node';

pgDataPort(pool);                                                          // pg
queryFunctionDataPort((text, params) => dataSource.query(text, params));   // TypeORM
queryFunctionDataPort((text, params) => prisma.$queryRawUnsafe(text, ...params)); // Prisma

await program.run(inputs, { data: pgDataPort(pool), clock: systemClock('Asia/Tehran') });
```

Minab's statements use Postgres placeholders: `$1`, `$2`, and so on.
A driver that wants `?` must translate them in the function you give.

## The request's transaction

Make the data port **for each request**, from the transaction the request is already in.
The rule then reads the rows that transaction wrote, and no others.

```ts
await dataSource.transaction(async manager => {
    await manager.query('INSERT INTO orders ...');
    const data = queryFunctionDataPort((text, params) => manager.query(text, params));
    const result = await program.run({ record }, { data });
});
```

With `pg`, use the client you called `BEGIN` on: `pgDataPort(client)`.
Do not use a pool for this: each pool call may use another connection.

## Node versions

Node 22.12 or newer (`engines`, D06). CI tests Node 22 and 24, and Bun.
The package has ES module and CommonJS entries (`require` works).

## Rules

- `pg`, TypeORM and Prisma are never dependencies of this package. `pg` is loaded at run time, from the host.
- A database error keeps its SQLSTATE `code`, so the runtime can map it to a stable error code.
- These adapters read only. Writes come in phase X5.
- A stub exports `notReady` and names the phase that fills it: only in `src/nestjs/` now.
