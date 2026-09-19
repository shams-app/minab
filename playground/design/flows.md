# User flows

Each flow is written as the visitor's step, then what the system does, then the states the design has to cover. Route names and component names match the code (`src/routes/`, `src/ui/`).

---

## 1. First visit: from landing to "aha"

1. **Land on `/`.**
   - The hero renders right away. There's no editor on this page.
   - **HeroDemo** starts on the *Query* tab. It shows `top-customers` as highlighted static code, and to its right a loading state: *"Starting PostgreSQL in your browser…"*.
   - In the background (idle callback), the engine worker starts and Monaco is prefetched.
   - *States:* HeroDemo loading → rows + compiled SQL.
2. **Switch the demo to *Rule*.**
   - The same card shows `booking-overlap`, then a **VerdictCard** ("Passes"), then the one SQL statement that reached Postgres.
   - Caption: *"A validation rule: only the correlated check reaches the database."*
3. **Switch to *Types*.**
   - Shows `strict-types`: a **ProblemsList** with *"'==' between TEXT and INTEGER requires an explicit CAST"*.
   - The point being made: mistakes are caught before anything runs.
4. **Scroll.**
   - Sections in order: LayerCards (Query / Validate), SigilGrid, HowItRuns (4 steps), Comparison (Minab ↔ compiled SQL, compiled live), FeatureGrid, CtaBand, Footer.
5. **Click "Open the playground".**
   - Goes to `/play`. The engine is already warm, so the first result appears in under a second.

**Design must show:** the hero on desktop and mobile; all three demo tabs; the demo's loading state.

---

## 2. Explore examples

1. **Open `/examples`.**
   - A grid of **ExampleCard**s. Each shows the title, a one-liner, a code preview, tags, level, spec §, and "from the repo" where it applies.
2. **Narrow the grid.**
   - Type in search, toggle topic chips (Query, Record rule, Field rule, Aggregates, Joins, Functions, Control flow, Types, JSON, Check-only), or pick a level.
   - The results count updates live.
   - *States:* no matches (EmptyState + "Clear filters").
3. **Click a card.**
   - Goes to `/play?example=<id>`. The workbench loads the program and its host (dataset, rule, record), runs it, and opens the output tab that example is about (`focus`: result, sql, execution or problems).
4. **Switch examples from inside the workbench** with the Toolbar's **ExamplePicker**, or with ⌘K.

---

## 3. Flip a rule's verdict (the core interaction)

On `/play?example=booking-overlap`:

1. **Result tab** shows **VerdictCard: Passes** (green, check icon, the word "Passes").
2. **Host panel → Record tab** shows the Booking being validated as a form, plus **PresetChips**: ✓ Free slot · ✗ Overlaps bkg-12 · ✗ Ends before it starts.
3. **Click "Overlaps bkg-12".**
   - The record changes, the rule re-runs automatically, and the verdict flips to **Fails**.
   - A note under the chips explains why.
4. **Click "Ends before it starts".**
   - Still **Fails**, but the Execution tab now reads *"Nothing reached the database"*. `AND` short-circuited on the local half.
5. **Edit a date in the form by hand.** The rule re-runs on each change, debounced.

**Design must show:** Passes and Fails; preset chips with their pass/fail expectation and the active one marked; the record form; the Execution tab with 1 statement and with 0.

---

## 4. Read the execution map

1. **Open the Execution tab.**
   - A summary: *"1 statement reached Postgres; everything else was answered from the record in memory."*
   - Timings: parse, check, run.
2. **Each TraceItem shows:**
   - a "Statement n" badge, rows and time;
   - "from" plus the Minab span it came from;
   - the SQL, with a params table;
   - the value it returned.
3. **Hover or focus a TraceItem.** The editor highlights that exact source span, e.g. `EXISTS(#Booking[…])`.
4. **Click the "from" span.** The editor selects it and scrolls to it.
5. **In the editor itself,** spans that became SQL stay underlined in `--pushdown` color. Hovering one there shows "Statement 1 reached the database…".

This is the showcase moment, so the design should make it feel like an X-ray.

---

## 5. Fix a type error

1. **Type `.status == 5`.** A squiggle appears within about 200 ms.
2. **StatusBar:** "1 error". The Problems tab gets a count badge.
3. **Result tab:** EmptyState *"1 problem to fix first — Minab checks everything before it runs anything; nothing was sent to the database."*, with a "Show problems" button.
4. **Problems tab:** click an item, and the editor selects the span.
5. **Hover the squiggle** for the message. Fix the code, and the result appears on the next auto-run.

---

## 6. Take the tour

1. **Open `/learn`.** It redirects to `/learn/hello`.
   - Layout: **LessonList** (progress bar; completed lessons ticked) and **LessonPanel** (prose, then a goal box) on the left; the workbench on the right.
2. **Edit the starter.** Each run checks the goal. When it's met:
   - the goal box turns to "Goal met — nicely done.";
   - the lesson is ticked in the list;
   - the Next button becomes primary.
3. **Stuck?**
   - "Hint" reveals hints one at a time.
   - "Show solution" loads the solution, and the record too for lessons solved by editing it (lesson 6).
   - "Start over" restores the starter.
4. **Progress and each lesson's code** are saved in the browser.
5. **Lesson 12 ends the tour.** Its CTA is "Explore the examples".

**Design must show:** the goal open vs met, hints revealed, a completed lesson in the list, and the mobile layout (lesson above, workbench tabs below).

---

## 7. Edit the host

1. **Schema tab:** table cards show each table's columns, types, relations and row counts, plus the dataset name and description.
2. **"Edit as JSON"** opens a Monaco JSON editor, validated against `minab-config.schema.json`.
   - "Apply schema" re-checks the program against the new schema, and keeps rows for tables that still exist.
   - "Reset" restores the dataset.
3. **Data tab:**
   - Table chips, then a grid of real rows from Postgres, with a total count.
   - The **SQL console** runs raw SQL. Changes last until "Reset data".
4. **Record tab:**
   - "Rule table" select. Choosing a table turns the program into a record rule.
   - The record form, or JSON.
5. **Field tab:**
   - `$` type select. Choosing a type turns the program into a field rule.
   - The value input.
6. **Host errors** show a Callout at the top of the host panel. The editor keeps reporting syntax errors against an empty schema.

---

## 8. Share and embed

1. **Share** (Toolbar button, or ⌘S) copies `…/play#s=<compressed program + host>`. A toast confirms it.
   - Opening the link restores the exact program, dataset, rule and record. The URL is then cleaned, and the workspace is autosaved.
2. **Embed** (Toolbar `</>` button) copies an `<iframe>` snippet pointing at `/embed#s=…`.
3. **`/embed`** is a chrome-free workbench: Wordmark, title, Run, "Open in playground ↗", the editor, and output tabs.
   - Query params: `example`, `theme`, `tabs`, `readonly`, `autorun`.
   - It posts `{type: 'minab:resize', height}` to the parent page.
4. **Download for the CLI** (↓ button) produces a zip containing `program.minab`, `minab.config.json`, `seed.sql` and a README with the exact `minab` / `psql` commands.
5. **A damaged link** opens the default example, with an error toast explaining what went wrong.

---

## 9. Mobile

- **Top bar:** Wordmark, a scrollable nav, search, theme and GitHub.
- **Workbench:** the Toolbar wraps. Below it, tabs: **Code · Result (row count) · Host**. A floating **Run** button sits bottom-right.
- **Tour:** the lesson comes first, with a horizontally scrolling lesson strip. The workbench tabs follow.
- **Landing:** the hero stacks, with the demo card under the copy.

---

## 10. Recovery paths

| Situation | What the visitor sees |
|---|---|
| Postgres is still booting on the first run | EngineStatusPill "Starting Postgres…" (pulsing). Result shows "Running…". The editor, checks and SQL keep working. |
| Postgres failed to boot (old browser, blocked WASM) | Pill "Postgres failed" + **Restart**. Rules that don't touch the database still run. |
| The engine worker crashed | Pill "Engine stopped" + **Restart**. A toast carries the error. Work is kept, and restarting replays the host and re-runs. |
| A render error | RouteError: "Something broke on this page". Reload / Restart the engine. "Your work is saved in this browser." |
| Unknown route | NotFound: `EXISTS(#Page[.path == $])` answered **false**. Button: Go home. |
| Unknown `?example=` | Toast: "There is no example called '…'". The last workspace stays. |
| Check-only program | Result shows a check-only Callout: "Checked ✓ — loops aren't executed yet", with the spec section and the evaluator's words. Constructs are shaded in the editor. |
| The database rejected SQL | Result shows a danger Callout with Postgres's message and the exact statement. |
