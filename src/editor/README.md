# src/editor

Editor services (production plans E1 and E3): completion, hover, go to definition,
signature help, document symbols, find references, rename, semantic tokens and quick fixes. They are computed once, here. The language server (E2), the
Monaco integration (E5) and the playground all call this code.

No Node, no DOM, no LSP types and no Monaco types. Lines and columns are
0-based, like the language server. An adapter converts the results.

## Files

- `index.ts`: the public exports.
- `types.ts`: the result shapes (`HoverResult`, `CompletionItem`, `DefinitionResult`, `SignatureHelpResult`, ranges).
- `document.ts`: `EditorDocument` (the services of one host and one parsed document) and `parseDocument`. A parsed document is not added to the workspace, so nothing needs cleaning up.
- `hover.ts`: `hover(doc, offset)`. Also `typeOf` and `tableOfType`, which the other files use.
- `definition.ts`: `definition(doc, offset)`. `#alias`, names, parameters, `let`, loop variables and called `fn`s.
- `complete.ts`: `complete(doc, offset)`. Async, because the keywords come from Langium's follow-set completion.
- `signature-help.ts`: `signatureHelp(doc, offset)`. It reads the text, so it works on a call that is not closed yet.
- `symbols.ts`: `documentSymbols(doc)`. Each `fn` (its parameters are children), each top-level `let`, and the aliases of the queries outside the functions.
- `references.ts`: `findReferences`, `prepareRename` and `rename`, for `let`, parameters, loop variables, `fn` and aliases. One document only. Schema names belong to the host, so a column, a table or a host input is not renamable. The scope resolver finds each use, so a column after `.` is never a use.
- `semantic-tokens.ts`: `semanticTokens(doc)`. The legend is `SEMANTIC_TOKEN_TYPES` and `SEMANTIC_TOKEN_MODIFIERS` (in `types.ts`).
- `quick-fixes.ts`: `quickFixes(doc, diagnostic)`. It reads the stable code and parameters of a diagnostic: "Did you mean …?" for `call.unknownFunction` and `scope.unknownName`, and "Add CAST(… AS T)" for `type.implicitCoercion`.
- `builtin-docs.ts`: the signature and one sentence of every built-in, and `parseSignature`.
- `tokens.ts`: the one tokenizer (`tokenizeLine`, `tokenize`) and the keyword lists. Pure. The Monaco integration, the playground editor and the static snippets use it. `playground/test/tokens.test.ts` fails when the grammar gains a keyword it does not know.
- `describe.ts`: shared text: types, columns, tables, host function signatures, and `nameText` (backticks for names that are not plain words).

## Rules

- Every function takes an `EditorDocument` and an offset. None changes the document.
- Types come from the type checker (`inferType`), so the editor and the checker cannot disagree.
- Host inputs and host functions come from `services.schema` (`hostInputs()`, `hostFunctions()`).
- A name that is not a plain word is inserted in backticks (spec §2.4).
- A new built-in needs an entry in `builtin-docs.ts`.
- A rename refuses, with a message, a name that breaks D10 or D11, a duplicate in one scope, and a name that would change what another name means. It checks the last one by parsing the result. A name that needs backticks is written with them (spec §2.4).
- `{ total }` in a JSON object means `{ total: total }`. A rename of `total` writes `{ total: newName }`, so the key stays.
- A new diagnostic with a quick fix needs a `case` in `quickFixes` and a test that applies the fix and checks the diagnostic is gone.
- Tests are in `test/editor/`.
