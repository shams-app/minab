# Status files

One file per phase, `<ID>.md`, written **only** by the session that did that phase, at its end (and by the owner, for example to approve a phase). A phase with no file here has not started.

The format is in [`../README.md`](../README.md#status-file-format). Keep the headings exactly as written there: the progress tool ([`../tools/progress.mjs`](../tools/progress.mjs)) reads `Status:`, "Questions for the owner" and "Later" from every file and builds [`../progress.md`](../progress.md).

Never edit another phase's status file: phases run in parallel, and the guard workflow rejects a pull request that changes more than its own status file.
