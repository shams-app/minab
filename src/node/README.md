# src/node

Entry points of the package (`@shamsine/minab/node` and related).
R7 put the Postgres data port here. Phase H1 adds the other Node adapters and config helpers.

## Files

- `index.ts`: the package entry `@shamsine/minab/node`. It exports `pgDataPort` and `connectPostgres`.
- `pg.ts`: the PostgreSQL data port. `pgDataPort(client)` wraps a connected `pg` client.
  `connectPostgres(url)` loads `pg` from the host's install and connects (the CLI uses it).

## Rules

- `pg` is never a dependency of this package. It is loaded at run time, from the host.
- A database error keeps its SQLSTATE `code`, so the runtime can map it to a stable error code.
- A stub exports `notReady` and names the phase that fills it. R2 made the files so the
  `exports` map in `package.json` is complete. Later phases never edit that map.
