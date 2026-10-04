You've covered both layers: pipelines that compile to one SQL statement, and rules that run next to the record and push down only what needs the database.

**Loops** (`loop x in …`, ranges, `break`, `continue`), tuples and `.$index` run. A loop reads its table rows once, then goes through them in memory. **Writes** (`INSERT`, `UPDATE`, `DELETE`) parse, resolve and **type-check** — so the editor catches mistakes in them — but the evaluator declines to run them yet, and says so instead of guessing.

### Your turn

Run this loop and read the answer. Then hover `order` inside the loop to see its type.

Where next: the [example gallery](/examples), the [cheat sheet](/reference), and the full [language spec](https://github.com/shams-app/minab/blob/main/docs/query-language-spec.md).
