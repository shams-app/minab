Minab reads top to bottom, like a pipeline. `FROM` picks a table, `WHERE` keeps the rows you want, and `SELECT` says what to show.

Inside the pipeline, **`.` is the current row** — so `.status` is the status of whichever order is being looked at. The host application supplies the tables; this playground stands in for the host, with a small coffee-gear shop called *Brewline*. Open the **Data** tab under the editor to browse it.

The program on the right lists every order. It already runs — try **Run** (or `⌘/Ctrl + Enter`), then look at **SQL**: that is the exact statement Minab sent to a real Postgres running in your browser.

### Your turn

Keep only the orders whose status is `"shipped"`. Strings use double quotes, and equality is `==`.
