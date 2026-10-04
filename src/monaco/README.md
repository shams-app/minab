# src/monaco

Entry point `@shamsine/minab/monaco` (production plan E5): Minab in a Monaco editor.
One call gives a host app the language, highlighting, brackets, comments, error
markers, completion, hover and signature help.

```ts
import * as monaco from 'monaco-editor';
import { createWorkerMinab } from '@shamsine/minab/browser';
import { registerMinab } from '@shamsine/minab/monaco';

const client = createWorkerMinab({ worker: () => new Worker(workerUrl, { type: 'module' }), schema });
const minab = registerMinab(monaco, { client });
// later: minab.dispose();
```

Everything that needs the parser runs in the worker (H4). The main thread only
converts results to Monaco shapes.

## Files

- `index.ts`: the public exports.
- `register.ts`: `registerMinab(monaco, options)`. It registers the language, watches every model of that
  language, and registers the completion, hover and signature help providers.
- `language.ts`: the static part. `tokensProvider` (built on the tokenizer `src/editor/tokens.ts`, so the
  playground and Monaco colour code the same way), `TOKEN_SCOPES` and `languageConfiguration`
  (brackets, auto-closing quotes and backticks, `//` and block comments, a Unicode word pattern).
- `types.ts`: `MinabEditorClient` (a `WorkerMinab` fits), `RegisterMinabOptions`, `MinabRegistration`.

## Options

- `client` (required): the runtime in the worker.
- `languageId` (default `minab`), `markerOwner` (default `minab`).
- `ruleContext`: used for every check and every question. Without it the client's own rule context is used.
- `debounceMs` (default 150): the wait after the last edit before the check.
- `keywordDocs(word)`: Markdown for a hovered keyword. The editor service only says which keyword it is.
- `onError(error)`: the worker failed. The editor keeps working and the markers stay as they were.

## Behaviour

- A marker has the diagnostic's stable `code`, its message, its severity and its range.
- A check answer for old text is dropped: the next check gives the markers.
- `dispose()` removes the providers, clears the markers and stops the timers. Monaco cannot unregister a language id, so the id stays.
- Offsets are UTF-16 offsets into `model.getValue()`, which is what `model.getOffsetAt` gives.

## Right-to-left pages (Persian, Arabic)

Monaco shows code left to right. Persian and Arabic names inside code display
correctly within a left-to-right line. In a right-to-left page (Shamsine), put the
editor in an element with `dir="ltr"`:

```html
<div dir="ltr"><div id="editor"></div></div>
```

## Rules

- Monaco is a parameter. Nothing here imports `monaco-editor` at run time: only types, and `monaco-editor`
  is an optional peer (decision D09). `test/browser/imports.test.ts` and `scripts/browser-bundle.mjs` check the import graph.
- No Node module, no `window`, no `document`.
- The tokenizer and the editor services live in `src/editor/`. Do not copy them here.
- Tests are in `test/monaco/`, with a fake `monaco`.
