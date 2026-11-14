---
type: added
scope: runtime
breaking: false
---
A host can prepare a policy, a group expression or a route body with `profile: 'policy'`: only the policy profile is allowed, and `compilePolicy()` gives the policy IR that the Shamsine engine runs, with the ids of the groups and users it names and the source with `findUser` keys pinned to ids. New diagnostics: `policy.constructNotAllowed`, `policy.tooManySteps` and the warning `policy.unknownTagKey`. `resource.tags.<key>` reads a tag as `TEXT?`.
