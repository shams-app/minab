You've covered both layers: pipelines that compile to one SQL statement, and rules that run next to the record and push down only what needs the database.

Minab specifies more than executes today. **Loops** (`loop x in …`, ranges, `break`), **writes** (`INSERT`, `UPDATE`, `DELETE`), tuples and `.$index` all parse, resolve and **type-check** — so the editor catches mistakes in them — but the evaluator declines to run them yet, and says so instead of guessing.

### Your turn

Run this loop and read what comes back. Then hover `order` inside the loop to see its type.

Where next: the [example gallery](/examples), the [cheat sheet](/reference), and the full [language spec](https://github.com/shams-app/minab/blob/main/docs/query-language-spec.md).
