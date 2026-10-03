# src/language/diagnostics

Stable codes for every diagnostic that the checker makes (production plan B1,
decision D35). A host such as Shamsine can translate a message by its code and
fill it with the parameters. Minab ships English only.

## Files

- `codes.ts` — the registry. One entry per code: severity, the English message
  built from parameters, and one sentence of explanation. Also `coded(code, params)`,
  which builds a message with its code and parameters.
- `minab-document-validator.ts` — gives Langium's lexer and parser errors their
  codes (`syntax.lexer`, `syntax.parser`). It is the only place that does this.

## Rules

- A code is `<area>.<camelCaseName>`. Areas: `syntax`, `scope`, `type`, `null`,
  `call`, `compile`, `eval`, `query`, `rule`.
- Keep the entries in `codes.ts` sorted by code. A test checks it.
- Every entry needs a test program in `test/diagnostic-codes.test.ts`.
  An entry with no program fails the test, so there are no dead codes.
- Do not change the English text of a message without a reason. Tests and
  users read it.
- After you change an entry, run `npm run docs:diagnostics`. It writes
  [`docs/reference/diagnostics.md`](../../../docs/reference/diagnostics.md).
  A test fails when that page is out of date.
- From 1.0 on, a code never changes its meaning (D38). Before 1.0, a phase may
  rename or change a code. It marks that with `breaking: true` in its changelog fragment.
- Run-time errors do not have codes yet. Phase R4 adds them. Only `eval.integerOutOfRange` exists (C2); the interpreter returns it in the `code` field of the failed result.
  A compile-time refusal has a code only when its card says so (`compile.blockInQuery`, X1).
- Where the code goes: the validator puts it in the LSP `code` field and puts the
  parameters in `data.params`. The type checker and the scope resolver return
  `code` and `params` next to `reason` (the English message).
