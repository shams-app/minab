# vscode-extension/test

The smoke test of the extension (production plan E4). It uses `@vscode/test-electron`.
It needs a display; on Linux run `xvfb-run -a npm test` in `vscode-extension/`.
It downloads VS Code the first time (into `.vscode-test/`, which git ignores).

## Files

- `runTest.ts`: starts VS Code with the extension and the `fixtures/type-error` folder open.
- `suite/index.ts`: runs inside VS Code. It checks activation, a diagnostic on a file with a type
  error, the status bar text, a file with no problem, and the restart command. It uses no test framework.
- `fixtures/type-error/`: a config with one `Order` table, a valid file and a file with a type error.

## Rules

- `tsconfig.test.json` builds this folder into `out-test/`. The `.vsix` must not contain `test/` or `out-test/`
  (`scripts/check-vsix.mjs` checks it).
- Every check waits with a timeout. Do not use fixed sleeps.
