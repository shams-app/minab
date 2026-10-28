---
type: added
scope: language
breaking: false
---
You can read a key of a `JSON` value: `.location.lat`, `.attachment["name"]`, `.timeTracking.sessions[0]`, and `url.tab` for a `JSON` host input. A key has the type `JSON`, so you `CAST` it to compare it. A missing key, a key of a value that is not an object, and a JSON `null` are all `null`. The interpreter and PostgreSQL give the same answer.
