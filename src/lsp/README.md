# src/lsp

The Minab language server (production plan E2). Each document gets the schema
of its own `minab.config.json`. The features come from `src/editor/`.

## Files

- `index.ts`: the public exports.
- `server.ts`: `startMinabLanguageServer({ connection? })`. Text sync, checks, completion
  (triggers `.`, `#`, `(`), hover, go to definition, signature help (triggers `(`, `,`),
  document symbols, find references, rename (with prepare), semantic tokens, quick fixes (code actions),
  and the watch on `**/minab.config.json`.
- `bin.ts`: the `minab-lsp` command (the second `bin` entry of the package). It starts the server on stdio.
- `config-registry.ts`: `ConfigRegistry`. Finds the nearest config for a document (like the CLI),
  loads it once, and gives the services for its schema. It uses the runtime's `ServiceCache`, so two
  configs with the same schema share one service set. `invalidate(path)` forgets a changed file. `setOverride(path)` makes every document use one file (the `minab.configPath` setting).
- `adapters.ts`: converts `src/editor/` results to LSP types, and builds the semantic tokens legend. No logic of its own.

## Rules

- Settings (E4): `configPath` comes in the initialization options and in `workspace/didChangeConfiguration`
  (`settings.minab.configPath`). A relative path starts at the first workspace folder. An empty value goes
  back to discovery. A change reads all configs again and checks all open documents again.
- After each check the server sends the notification `minab/configUsed` (`{ uri, configPath }`, `configPath`
  is `null` when there is no config). The VS Code status bar item shows it.

- A document with no config, or with a config that cannot be read, has an empty schema. A broken
  config shows one warning message, once for each message.
- The server asks the client to watch `minab.config.json` (dynamic registration). When one changes,
  the server reads it again and checks all open documents. Files that a config names (a separate
  schema file, a record file) are not watched yet.
- A document is checked on its own: it is added to the workspace and removed again, one check at a time.
  Syntax errors stop the check, like in the CLI.
- Editor features parse the current text on each request. They do not use the last check.
- `src/language/main.ts` starts this server. The package entry `./lsp` is `src/language/server.ts`,
  which re-exports it.
- A refused rename is a `RequestFailed` error with the message. The client shows it.
- The server keeps the diagnostics it last sent for each document. A quick fix reads their parameters from there, so it works with a client that does not send `data` back.
- Tests: `test/lsp-stdio.test.ts` talks to the built server over stdio.
