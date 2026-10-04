# test/monaco

Tests of `src/monaco/` (phase E5). No browser is needed: a fake `monaco` stands in for the editor.

## Files

- `fake-monaco.ts`: `fakeMonaco()` and `fakeModel()`. They keep what the integration registers, so a test can call the providers and read the markers.
- `language.test.ts`: the tokens provider on sample lines (keywords, sigils, strings, backtick and Unicode names, comments) and the language configuration.
- `register.test.ts`: `registerMinab` with a fake client: markers, debounce, stale answers, dispose, completion, hover and signature help.
- `worker-editor.test.ts`: the three editor methods of the worker bridge on a `MessageChannel`, and `registerMinab` on top of the real worker.

## Rules

- Dispose every registration and every runtime you create.
- The real Monaco is tested in a browser by phase H6, not here.
