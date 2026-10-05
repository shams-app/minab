# Changelog

## 0.2.0

The first public release of the extension: syntax highlighting, live diagnostics, and hover and go-to-definition for `.minab` files, with the language server bundled into the extension. See the [project changelog](https://github.com/shams-app/minab/blob/main/CHANGELOG.md) for the full history.

- Every diagnostic has a stable code, for example `type.implicitCoercion`.
- The server uses the nearest `minab.config.json` for each file, and reads a changed config again without a restart.
- Completion (type `.`, `#` or `(`), hover, go to definition and signature help work, also for called functions.
- The server shows an outline of functions, lets, parameters and aliases, finds references and renames them, colors names by meaning (semantic tokens), and offers quick fixes ("Did you mean …?" and "Add CAST(… AS T)").
- Names can use any language (Persian, Arabic, Turkish and more), and names with spaces or symbols can be written in backticks.
- User functions are called by name. The `&` prefix is gone.

[0.2.0]: https://github.com/shams-app/minab/releases/tag/v0.2.0
