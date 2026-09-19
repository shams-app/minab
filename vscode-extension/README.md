# Minab for VS Code

Syntax highlighting, live diagnostics, and `#alias` hover / go-to-definition for `.minab` files. It is a thin client: it starts the Minab language server (`src/language/main.ts` in the repo root, bundled into the extension as `server/main.mjs`) and wires up a TextMate grammar generated from the language's own grammar.

## Install

Build the `.vsix` from a checkout (there is no marketplace listing yet):

```bash
npm install && npm run build:release        # repo root — generates the grammar
cd vscode-extension && npm install && npm run package
code --install-extension minab-vscode-*.vsix
```

The `.vsix` is self-contained: it carries the language server and needs neither the repo nor `npm install` at runtime.

## Build and launch (development)

```bash
# 1. Build the root package (repo root) — generates the grammar the bundle needs
npm install && npm run build

# 2. Build the extension and bundle the server into server/main.mjs
cd vscode-extension && npm install && npm run build && npm run bundle
```

Then open the repo in VS Code and press **F5** (or run *Run Extension* from the Debug panel) to open an Extension Development Host. Open any `examples/<name>/<name>.minab` there.

## What to expect

- **Highlighting** for keywords, sigils, strings, numbers and comments.
- **Live diagnostics**: type a mistake (e.g. compare `.status == 5`) and one squiggle appears, with the same message `minab check` prints.
- **Hover / F12** on a `#alias` or `#Table` reference shows and jumps to where the alias is declared.

## The schema

The server reads its tables and columns from a `minab.config.json` — the same file the CLI uses (see the root README's "The config file"). It looks for one starting at the server process's working directory and walking up; with none found it runs against an empty schema, so anything that touches a table reports it can't be resolved. Open the folder that contains your `minab.config.json` (an `examples/<name>` folder works) for schema-aware diagnostics. One schema is shared by every document in the session.
