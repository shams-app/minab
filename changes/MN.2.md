---
type: added
scope: runtime
breaking: false
---
Programs with users and groups run. A host gives a directory port and the ids of the special users, and `@currentUser IN @@Sales - @@Interns` asks the port about one user instead of listing the groups. A set is listed only for `COUNT`, a loop, a result or `single`, up to the new limit `maxUsers` (10,000). `directoryHostFunctions` gives the host functions `findUser`, `findGroup`, `single`, `singleOrNull`, `specialUser` and `groupsOf`, and `routeHostFunction` makes a route (at most 3 nested). New run errors: `eval.userNotFound`, `eval.groupNotFound`, `eval.notExactlyOne`, `eval.tooManyUsers`, `eval.routeCycle`, and `compile.directoryInSql` for a query that reads users. The analysis has `usesDirectory`, and the option `localDirectory` keeps such a program in tier `local`.
