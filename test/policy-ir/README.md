# test/policy-ir

The golden corpus of the policy profile (security plan MN.3). Minab's interpreter and the Shamsine engine must give the same
answer for every case; the compiled IR is stored so the engine reads exactly what Minab makes.

## Files

- `_context.json`: the host of every case: the columns of the record, of `new`, the tag keys of the workspace, the defaults
  (`request`, `record`, `new`, `tags`, `now`, the special users) and a small directory (users, groups with tags, routes).
- `operators.json`, `nulls.json`, `text.json`, `dates.json`, `request.json`, `users.json`, `directory-functions.json`,
  `routes.json`, `principals.json`: the cases, one topic for each file. `unknown.json` is for the engine only.

## A case

`{ name, source, kind, expected, ir, … }`:

- `kind`: `boolean` (a condition, `expected` is `true` or `false`), `principal` (`expected` is the sorted ids of the users)
  or `route` (a route body run for the user `u`; `expected` is the sorted ids, or one id or `null` when `returns` is `USER?`).
- `expected` is written by a person from the spec. It is never copied from the compiler.
- `ir`: what `compilePolicy()` gives. `UPDATE_POLICY_IR=1 npm run corpus:check` writes it; then read the diff.
- Optional: `request`, `record`, `new`, `tags`, `now`, `currentUser`, `appUser`, `u`, `returns` change the defaults; `directory`
  is a whole other directory.
- `unknown`: context values the request leaves out (`record.note`, `request.mfa`). They are Unknown for the engine (engine
  spec §6.2), so `expected` may also be `"unknown"`; the interpreter does not run these cases.

## Rules

- `npm run corpus:check` runs the interpreter and the compiler on every case, and checks each IR against
  `schemas/policy-ir.v1.json`.
- A case is never changed to make a check pass. If the interpreter and `expected` disagree, find out which one is wrong.
- Add cases in the file of their topic. At least 80 cases must stay.
