# schemas

JSON Schema files for the wire format v1 (production plan R6). They are for clients that
are not written in TypeScript. The format is described in
[`docs/reference/wire-format.md`](../docs/reference/wire-format.md).

## Files

- `wire-v1.request.json`: the request: `{ v, runs }`.
- `wire-v1.response.json`: the response: `{ v, results }`, or `{ v, error }` for a request that failed as a whole.
- `policy-ir.v1.json`: the policy IR that `compilePolicy()` makes (security plan MN.3). It is a **copy** of Shamsine's `packages/authz/contract/schemas/policy-ir.v1.json`, which owns it: do not change it here. `test/policy.test.ts` checks every compiled IR against it.

## Rules

- The TypeScript types in `src/runtime/wire.ts` are the source. Change them and the schemas together.
- `test/wire.test.ts` checks that both wire schemas say the same. It uses a small schema checker, not a library.
- A schema cannot check unique ids, the allowed number of runs, or whether `source` is allowed.
  `parseRequest` checks those.
- The files are published with the package (`files` in `package.json`).
