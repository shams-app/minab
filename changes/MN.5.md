---
type: changed
scope: browser
breaking: false
---
A program that only compares user ids (`.owner == @currentUser`, `@currentUser IN .assignees`) is now tier `local`, and the browser worker runs it: `specialUsers` crosses the bridge with the other run inputs. A program that reads the directory (a user column such as `.email`, a group, a function) stays tier `data`.

The root entry also exports `directoryHostFunctions`, `routeHostFunction` and `hostFunctionsOf`, so a CommonJS host (NestJS, Jest) can use the directory functions: `@shamsine/minab/host` is an ES module only.
