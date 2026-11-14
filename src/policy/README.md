# src/policy

The policy profile and the policy compiler (security plan MN.3, proposal P12). The Shamsine engine never runs Minab
source: a policy condition, a principal, a dynamic or computed group and a named route are written in Minab, checked here
and turned into the policy IR v1 when the rule is saved. The guide is
[`docs/guides/shamsine.md`](../../docs/guides/shamsine.md#14-policies-and-groups).

## Files

- `profile.ts`: what a host needs: `policyInputs()` (the host inputs `request`, `resource`, `new`), the names and limits of
  the profile, the options of `prepare` (`PolicyOptions`), the rule context it builds, and `closestKeys`.
- `compile-ir.ts`: the IR types (a copy of Shamsine's `packages/authz/contract/src/ir.ts`) and one walk of the tree that does
  two jobs: `checkPolicyProfile` (used by `prepare`; reports every part the profile does not allow) and `compilePolicyProgram`
  (used by `compilePolicy()`; asks the directory port for ids and builds the IR, `reads` and `pinnedSource`).

## Rules

- The profile is a list of what is allowed. A node the walk does not know is refused with `policy.constructNotAllowed`, never
  guessed. To allow a new form: it needs an approved proposal row (spec governance), a case in `test/policy-ir`, and a
  refusal test that no longer refuses it.
- The IR types here follow the contract package. The contract changes only with the owner's OK; change both together.
- No Node, no DOM, no Shamsine names in the code. The directory is the `DirectoryPort` the host gives.
- Never put a typed e-mail, phone or key in a message or a diagnostic: say what is wrong, not the value.
