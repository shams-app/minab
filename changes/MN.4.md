---
type: added
scope: editor
breaking: false
---
The editors know users and groups. After `@` the editor offers the special users of the place, after `@@` the groups of the workspace (a name that needs it goes in backticks), after a user's `.` the directory columns and attributes, and the host's routes appear in the function list with their title and description. Hover shows `USERGROUP`, `@currentUser`'s type and a route's title. `registerMinab` takes two new callbacks: `directoryNames()` (group names, titles, kinds) and `userLabels(ids)`, which makes a pinned `findUser('usr_…')` read as "Sara Ahmadi · sara@example.com" in an inlay hint and on hover. Names after `@` and `@@` have semantic tokens, and an unknown group or special user has a "Use @@Sales" quick fix. A host function declaration may have a `title` and a `description`.
