# Minab for VS Code

Language support for [Minab](https://minab-lang.org) (`.minab` files): the typed query and rule
language that compiles to SQL. Highlighting, snippets, and a language server that shows the
same errors as the `minab check` command, while you type.

<!-- Screenshot: add the recorded image at images/screenshot.png, then show it here with
![Minab in VS Code](images/screenshot.png). The owner records it (a type error with its squiggle and the status bar item). -->

## Features

- **Highlighting** for keywords, sigils, strings, numbers and comments.
- **Live diagnostics.** Type a mistake (for example compare `.status == 5`) and one squiggle appears,
  with the same message and error code as `minab check`.
- **Completion, hover and signature help** for tables, columns, `#alias` names and built-in functions.
- **Go to definition, find references and rename** for aliases, variables and functions.
- **Quick fixes** for errors that have a clear fix.
- **Outline and semantic highlighting.**
- **Snippets.** Type a prefix and press Tab:

  | Prefix | Inserts |
  |---|---|
  | `recordrule` | a record rule (a test on the fields of one record) |
  | `fieldrule` | a field rule (a test on one value, `$`) |
  | `query` | `FROM … WHERE … SELECT` |
  | `groupby` | `FROM … GROUPBY … HAVING … SELECT … ORDERBY` |
  | `fn` | a function |
  | `switch` | a `switch` with a default case |
  | `if` / `if!` | an `if` expression / an `if!` statement |
  | `loop` / `loopfrom` | a loop over a collection / over a range |
  | `let` | a variable |

- **Status bar.** The item at the left shows which config file the open document uses, for example
  `Minab: examples/top-customers/minab.config.json`, or `Minab: no config`. Click it to open the file.

## The schema

The language server reads your tables and columns from a `minab.config.json`, the same file the CLI
uses. For each document it takes the nearest `minab.config.json` in the same folder or above it.
With none, the schema is empty, and anything that names a table is an error.
Open the folder that holds your `minab.config.json` for schema-aware checks. When the file changes,
the extension reads it again. You do not need to restart.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `minab.configPath` | `""` | One `minab.config.json` for every `.minab` file. Empty means: find the nearest one. A relative path starts at the first workspace folder. |
| `minab.trace.server` | `off` | `off`, `messages` or `verbose`. Writes the talk with the server to the *Minab* output channel. Use it when you report a problem. |

## Commands

Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and type "Minab":

- **Minab: Restart Language Server**: stops the server and starts it again.
- **Minab: Open Config File**: opens the config file the active document uses.

## Other editors

The same server works in Neovim, Helix and Zed. See `docs/editors.md` in the Minab package (it is also on the website).

## Report a problem

Write to security@minab-lang.org. For a bug in the extension, say your VS Code version, the extension version,
and attach the *Minab* output with `minab.trace.server` set to `messages`.

## Build and launch (development)

```bash
# 1. Build the root package (repo root). This generates the grammar the bundle needs.
npm install && npm run build

# 2. Build the extension and bundle the server into server/main.mjs
cd vscode-extension && npm install && npm run build && npm run bundle
```

Then open the repo in VS Code and press **F5** (or run *Run Extension* from the Debug panel) to open
an Extension Development Host. Open any `examples/<name>/<name>.minab` there.

To build a `.vsix`: `npm run package`, then `npm run check:vsix`. The `.vsix` is self-contained:
it carries the language server and needs neither the repo nor `npm install`.

To run the smoke test (it starts a real VS Code and needs a display):
`xvfb-run -a npm test` on Linux, or `npm test` on a desktop.
