---
type: added
scope: runtime
breaking: false
---
A `FROM` query may use users and groups that do not depend on the row. `@currentUser`, `@@Sales`, `teamMates(@currentUser)`, `findUser('usr_…')` and set operators and filters over them are listed through the directory port before the query runs (up to `limits.maxUsers`, else `eval.tooManyUsers`) and sent as one array parameter: `.assignee IN S` is `assignee = ANY($1)`, `EXISTS(.approvers & @@Reviewers)` is an array overlap, and `.owner == @currentUser` or `@currentUser IN .approvers` compare ids with no directory read. A part that depends on each row (`teamLeader(.owner)`, `.owner.name`) is still `compile.directoryInSql`, and the message names that part. A user column holds the id as text and a `users` column a text array.
