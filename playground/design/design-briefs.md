# Claude Design briefs

**You (the owner) do not paste these.** The W1 Claude Code session reads them and builds the designs in Claude Design for you. You only review the result. See [`../../docs/production/phases/W1.md`](../../docs/production/phases/W1.md).

Do not mix this file up with [`docs/production/phases/prompts.md`](../../docs/production/phases/prompts.md):

| File | What it holds | Who uses it |
|---|---|---|
| `docs/production/phases/prompts.md` | One prompt per phase, to **start a Claude Code session** | You paste one into Claude Code |
| `playground/design/design-briefs.md` (this file) | What each screen must show, with real content | The W1 session (briefs 0–14); W2 and W3 (brief 15) |

The briefs use real content and real data from the playground, so the designs look like the product.

**Conventions used below:**
- `‹…›` marks a choice. The W1 session fills it in from decision D40.
- Every brief ends with **Deliver:**, the exact frames or components to produce.
- Component and token names match `contract.md`, so the build maps one-to-one. The design must not rename them.

---

## 0 · Context primer (the start of every design)

> I'm designing the website for **Minab**, a small programming language I created, as a **showcase for my portfolio** and the language's public playground. Please read this context carefully; every later request builds on it.
>
> **What Minab is:** one small language for two jobs. You query relational data (`FROM Order WHERE .status == "shipped" SELECT .id`), and you validate records before they're saved (`.end_date > .start_date`). One expression syntax serves both. Sigils make scope visible: `.` is the current record, `$` is the value under validation, `^` is one scope up, `#Table` opens a table inline, `KEY` is the group after GROUPBY, and a lowercase name such as `discounted()` calls a user function. It has strict types with no implicit coercion. It compiles to PostgreSQL. Rules run with a *hybrid* strategy: what can be answered from the record is evaluated in memory, and only the smallest table-touching pieces are pushed down to the database as SQL.
>
> **What the site is:** a working playground. Everything runs in the visitor's browser: the Minab toolchain in a Web Worker, a real PostgreSQL compiled to WebAssembly, and a Monaco editor. Pages:
> - Landing (`/`)
> - Playground workbench (`/play`): editor, output tabs (Result, SQL, Execution, Problems, AST), and a host panel (Schema, Data, Record, Field)
> - Guided tour of 12 lessons (`/learn`)
> - Example gallery (`/examples`)
> - Cheat sheet (`/reference`)
> - Embeddable mini-workbench for iframes (`/embed`)
>
> **Audience, in order:** hiring managers skimming my portfolio (30–90 seconds, may not code); engineers evaluating my work; programming-language enthusiasts; developers who might use it.
>
> **Tone:** precise, calm, confident. Let running code make the argument. Honest about what's unfinished: loops and writes "check today, run later".
>
> **The app is already built and working.** Your job is its visual and interaction design. It's implemented in React. Every color, size and duration comes from CSS custom properties (design tokens), and the code editor's syntax colors come from those tokens too. Please use these exact token and component names so the handoff to Claude Code maps one-to-one:
> - Surface and text tokens: `--bg-canvas`, `--bg-surface`, `--surface-overlay`, `--surface-sunken`, `--surface-hover`, `--surface-selected`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-subtle`, `--border-default`
> - Brand and state tokens: `--accent`, `--accent-soft`, `--focus-ring`, `--success`, `--danger`, `--warning`, `--info`, `--verdict-pass`, `--verdict-fail`, `--pushdown` (spans that reached the database), `--check-only` (constructs that don't execute yet)
> - Editor and syntax tokens: `--editor-bg`, and the syntax palette `--syntax-keyword-pipeline`, `--syntax-keyword-dml`, `--syntax-keyword-operator`, `--syntax-keyword-control`, `--syntax-type`, `--syntax-constant`, `--syntax-builtin`, `--syntax-sigil-record`, `--syntax-sigil-field`, `--syntax-sigil-parent`, `--syntax-sigil-alias`, `--syntax-sigil-call`, `--syntax-sigil-key`, `--syntax-member`, `--syntax-string`, `--syntax-number`, `--syntax-comment`, `--syntax-operator`
> - Components: Button, IconButton, Badge, Tabs, Kbd, Callout, EmptyState, Toggle, CodeBlock, Toast, AppShell, Wordmark, Toolbar, EngineStatusPill, RunButton, EditorStatusBar, OutputPanel, ResultView, RowsTable, VerdictCard, SqlView, ExecutionView (with TraceItem), ProblemsList, AstView, HostPanel, SchemaView, DataView, SqlConsole, RecordView, FieldView, PresetChips, Hero, HeroDemo, LayerCards, SigilGrid, HowItRuns, Comparison, FeatureGrid, CtaBand, Footer, GalleryFilters, ExampleCard, LessonList, LessonPanel, CheatSheet, CommandPalette, Drawer, EmbedFrame.
>
> **Hard requirements:**
> - Light and dark themes, designed with equal care.
> - Works at 375 px wide.
> - WCAG AA contrast, including every syntax color against `--editor-bg`.
> - A visible focus state everywhere.
> - Pass/fail is never shown by color alone.
> - Respect reduced motion.
>
> Don't design anything yet. Reply with a short summary of what you understood, and any questions.

---

## 1 · Brand and design system

> Let's build the design system first. Direction: **‹A "Instrument" — calm, editorial, precise: warm paper and ink, one saturated accent, typography-led, the sigils are the brand / B "Terminal Noir" — dark-first dev-tool, glowing syntax / C "Blueprint" — technical drawing, cyan grid, annotation lines›**.
>
> 1. **Wordmark:** `.minab` in lowercase. The leading dot is Minab's current-record sigil, so it gets `--syntax-sigil-record` color. Show 3 variations of the wordmark and a square app icon built from the dot.
> 2. **Color:** define every token listed in the primer for **light and dark**. Show them as swatches with names and hex values.
> 3. **Syntax palette:** this is the brand's signature. Give each sigil (`.` `$` `^` `#` `KEY`) a distinct, memorable hue. Pipeline keywords (`FROM`/`WHERE`/`SELECT`) should read as structure (bold, calm); control keywords (`let`, `if`, `switch`) as a different family. Include a contrast table: every syntax token against `--editor-bg`, in both themes, all ≥ 4.5:1.
> 4. **Type:** a UI sans, an optional display face, and a monospace that renders `. $ ^ # & != <= =>` beautifully. Set a scale for `--text-xs` … `--text-4xl`, plus weights and leading.
> 5. **Space, radius, elevation, motion:** 4 px grid (`--space-1…16`), radius sm/md/lg/xl/full, shadows sm/md/lg/overlay, and durations fast/normal/slow with standard and emphasized easing.
> 6. **Core components**, each in all states:
>    - **Button** (primary/secondary/ghost/danger × sm/md/lg; hover, focus, disabled, busy)
>    - **IconButton** (with pressed)
>    - **Badge** (neutral, accent, success, danger, warning, pushdown, check-only)
>    - **Tabs** (with count badges)
>    - **Kbd**
>    - **Toggle**
>    - **Callout** (info, warning, danger, success, check-only, pushdown)
>    - **EmptyState**
>    - **Toast** (info, success, error)
>    - **CodeBlock** (caption, copy button, wrap)
>
> Use this code for every CodeBlock sample, so the syntax colors can be judged on real Minab:
> ```
> // A booking must end after it starts, and must not overlap another booking of the same room.
> .end_date > .start_date AND NOT EXISTS(
>     #Booking[. != ^ AND .room_id == ^.room_id
>              AND .start_date < ^.end_date AND .end_date > ^.start_date]
> )
> ```
> ```
> FROM Order
> GROUPBY .customer
> HAVING SUM(.total) > 1000
> SELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count
> ORDERBY total_spent DESC
> ```
>
> **Deliver:** a design-system page (light and dark side by side) covering tokens, the syntax palette with its contrast table, the type scale, the wordmark and icon, and the component states above.

**Iterate:**
- "Make the sigil colors more distinct from each other for color-blind users. Check with a deuteranopia simulation."
- "The dark editor background feels muddy; try a cooler, deeper tone and re-check syntax contrast."
- "Show me two alternative monospace fonts in the code samples."

---

## 2 · Landing page

> Design the **landing page** (`/`) using the design system. Desktop at 1440 px and mobile at 375 px, light and dark.
>
> Sections, in order:
> 1. **Hero** (two columns on desktop):
>    - Eyebrow: "A query and validation language"
>    - H1: "Say what you mean about your data."
>    - Subhead: "Minab is one small language for two jobs: querying relational data, and validating the records you're about to save. It type-checks everything before it runs anything, and compiles to plain PostgreSQL."
>    - Buttons: "Open the playground" (primary, play icon) and "Take the tour · 10 min"
>    - Note with a database icon: "Everything on this site runs in your browser — the Minab toolchain in a Web Worker, and a real PostgreSQL compiled to WebAssembly."
> 2. **HeroDemo** card (right column), a live mini-workbench with tabs **Query · Rule · Types**:
>    - **Query:** caption "A pipeline that walks a relation — no JOIN written." Shows the GROUPBY program from the design system, then a "Compiled to" SQL block, then this result table:
>
>      | # | customer_name | total_spent | order_count |
>      |---|---|---|---|
>      | 1 | Ada Lovelace | 1863 | 5 |
>      | 2 | Margaret Hamilton | 1536.5 | 2 |
>      | 3 | Grace Hopper | 1467.5 | 3 |
>      | 4 | Alan Turing | 1355 | 2 |
>      | 5 | Donald Knuth | 1195.5 | 6 |
>
>      The compiled SQL: `SELECT (SELECT "_r0"."name" FROM "Customer" AS "_r0" WHERE "_r0"."id" = "Order"."customer_id") AS "customer_name", SUM("Order"."total") AS "total_spent", COUNT(*) AS "order_count" FROM "Order" GROUP BY "Order"."customer_id" HAVING SUM("Order"."total") > $1 ORDER BY "total_spent" DESC`
>    - **Rule:** the booking-overlap rule. A **VerdictCard** "Passes", then "The one statement that reached Postgres": `SELECT EXISTS (SELECT 1 FROM "Booking" AS "_r0" WHERE ((("_r0"."id" IS DISTINCT FROM $1 AND "_r0"."room_id" IS NOT DISTINCT FROM $2) AND "_r0"."start_date" < $3) AND "_r0"."end_date" > $4)) AS "value"`
>    - **Types:** `FROM Order WHERE .status == 5 SELECT .id, .total`, shown with the problem `"==" between TEXT and INTEGER requires an explicit CAST (no implicit coercion)` at line 2, col 7.
>    - A loading state: "Starting PostgreSQL in your browser…"
>    - "Open in the playground →" link.
> 3. **LayerCards:**
>    - Title: "Two layers, one expression language". Body: "The same `.`-for-the-current-row expressions work in a pipeline and in a bare validation rule. Learn it once."
>    - Two cards, **Query** and **Validate**, each with code and "Run it →".
> 4. **SigilGrid:**
>    - Title: "Every character pulls its weight"
>    - 5 cards: `.` current record `.customer.name` · `$` value under validation `$ <= .credit_limit` · `^` one scope up `.room_id == ^.room_id` · `#` a table, inline `#Booking[.id != ^.id]` · `KEY` the group `KEY.name`
>    - Make the sigils big and colorful. This is the brand moment.
> 5. **HowItRuns:** 4 steps.
>    - **Parse:** a Langium grammar.
>    - **Resolve & check:** no implicit coercion.
>    - **Compile:** one parameterized PostgreSQL statement.
>    - **Run — hybrid:** rules evaluated next to the record; only the smallest table-touching pieces pushed down.
>
>    Consider a diagram, not just text.
> 6. **Comparison:** "What you write, what runs". Minab on the left, the compiled SQL on the right, with an arrow. Caption: "compiled live — the same text `minab compile` prints".
> 7. **FeatureGrid:** No implicit coercion · Relations without joins · Rules run next to the record · Real tooling (language server, VS Code, CLI) · Checked before it runs · Runs right here.
> 8. **CtaBand:** "Try it on real data". Buttons: Open the playground / Browse examples.
> 9. **Footer:** "Minab — designed and built by Hamed Zakery Miab", with links to GitHub, the language spec and the VS Code extension. "Built with Langium, PGlite, Monaco and React."
>
> The top bar (**AppShell**) has the wordmark, nav (Playground · Tour · Examples · Reference), "Search ⌘K", a theme toggle and GitHub.
>
> **Deliver:** landing at 1440 and 375, light and dark, plus the HeroDemo in all four states (Query, Rule, Types, loading).

**Iterate:**
- "Give me three variations of the hero: (a) the current one, (b) centered with the demo below full-width, (c) editor-first, where the hero *is* the demo."
- "Add a subtle motion idea for the hero: the pushed-down `EXISTS(…)` span draws a line to its SQL statement."

---

## 3 · Workbench, desktop

> Design the **playground workbench** (`/play`) at 1440×900, light and dark. It's a full-height app.
>
> **Toolbar**, under the top bar:
> - Left: ExamplePicker showing "No double bookings"; a badge "§6.1"; a reset icon.
> - Right:
>   - EngineStatusPill "Postgres ready" (green dot); design the other states too: starting, "Starting Postgres…" pulsing, failed with a Restart link.
>   - Auto-run Toggle (on).
>   - IconButtons for cheat sheet, download for the CLI, and copy embed code.
>   - "Share" button, and a primary **RunButton** "Run ⌘↵".
>
> **Left column (55%):**
> - The **Monaco editor**, with line numbers, showing the booking-overlap rule. The `EXISTS(#Booking[…])` span is underlined in `--pushdown` color: it's the part that became SQL.
> - An **EditorStatusBar**: "Record rule → BOOLEAN" … "✓ No problems".
> - The **HostPanel** (38% height) with tabs Schema · Data · **Record** (active, badge `.`) · Field:
>   - "Rule table: Booking"
>   - PresetChips: ✓ Free slot (active) · ✗ Overlaps bkg-12 · ✗ Ends before it starts, and under them "Room 7 is free from Oct 1 to Oct 5 — the next booking starts on the 6th."
>   - The record form: id `bkg-new`, room_id `room-7`, customer_id `cus-barbara`, purpose `Board meeting`, start_date `2026-10-01`, end_date `2026-10-05`.
>
> **Right column (45%):** the **OutputPanel**, with tabs Result · SQL · Execution (badge 1, pushdown tone) · Problems · AST. **Execution** is active:
> - Summary: "1 statement reached Postgres; everything else was answered from the record in memory." Timings: parse 1.2 ms · check 0.8 ms · run 2.1 ms.
> - One **TraceItem**:
>   - "Statement 1" badge; "1 row · 2.1 ms"
>   - "from" + `EXISTS(#Booking[. != ^ AND .room_id == ^.room_id …])`
>   - The SQL, formatted
>   - A params table: $1 = bkg-new, $2 = room-7, $3 = 2026-10-05, $4 = 2026-10-01
>   - "returned `false`"
> - Show the hover state: the TraceItem is hovered, and the matching span in the editor is highlighted.
> - Legend: "Underlined in the editor: the parts that became SQL."
>
> Panels are resizable (show the separators), and the host panel can collapse to a single bar: "Host — schema, data, record ›".
>
> **Deliver:** the workbench in this state, light and dark. Also a variant with the Result tab active showing the **VerdictCard** "Passes", and one showing "Fails" after the "Overlaps bkg-12" preset.

**Iterate:**
- "The Execution tab is the showcase moment. Push it further: make it feel like an X-ray of the program. Try connecting the TraceItem to the editor span visually."
- "Try a variant where the host panel lives in a right-side sheet instead of under the editor."

---

## 4 · Output states sheet

> Design every state of the output tabs as a component sheet (one frame per state), in light and dark, at the output column's width (about 620 px).
>
> **ResultView:**
> 1. Nothing run yet (EmptyState + Run).
> 2. Running (spinner). Also a stale variant: the previous result dimmed, with an "edited since this run" badge.
> 3. Rows: a RowsTable of 4 rows.
>
>    | id | total | customer_name |
>    |---|---|---|
>    | ord-190 | 1302.5 | Margaret Hamilton |
>    | ord-104 | 980 | Ada Lovelace |
>    | ord-87 | 412.5 | Grace Hopper |
>    | ord-171 | 190 | Barbara Liskov |
>
>    Numbers right-aligned in mono; a null cell; a JSON cell `{"weight_kg":12.5,"voltage":230}`. Footer meta: "4 rows · 1 statement · 3.4 ms".
> 4. No rows: "No rows — the query ran and matched nothing. Columns: name, country."
> 5. VerdictCard **Passes**: "The Booking under validation passes this rule." plus "1 statement reached the database — see how →".
> 6. VerdictCard **Fails**: "Answered entirely from the record — nothing reached the database."
> 7. Field-rule verdict: "The value `-5` is rejected for Order."
> 8. Value: `1302.5` with a `DECIMAL` badge.
> 9. Problems to fix first: "1 problem to fix first — Minab checks everything before it runs anything; nothing was sent to the database." with a "Show problems" button.
> 10. Check-only Callout: "Checked ✓ — loops aren't executed yet". Body: "This program parses, resolves and type-checks. The evaluator doesn't run **loops** (spec §9.4) yet, and says so rather than guessing." Plus the evaluator's words in muted text: `"LoopStatement" is not executed yet`.
> 11. Database error Callout: "The database refused a statement", with a message and the SQL.
>
> **SqlView:**
> - Compiles: an explanation line, formatted SQL with a copy button, and a params table ($1 = 1000).
> - No single statement: a pushdown Callout "No single SQL statement — It reads the record under validation, so it has no single SQL form. Running it evaluates those parts in memory and pushes each table-touching part down as its own statement." Then "What the last run sent:" with one statement.
>
> **ExecutionView:**
> - 1 statement (as in brief 3).
> - 0 statements: "The rule was settled from the record alone."
> - Nothing ran: fix problems first.
>
> **ProblemsList:**
> - 2 problems:
>   - error `"==" between TEXT and INTEGER requires an explicit CAST (no implicit coercion)` · minab · 2:7
>   - error `Expecting: one of these possible Token sequences…` · syntax · 1:17
> - Plus the empty state: "No problems".
>
> **AstView:** a tree for `FROM Order WHERE .total > 5 SELECT .id`, with inferred-type badges (DECIMAL, BOOLEAN, UUID) and one row hovered.
>
> **Deliver:** a component sheet with every state above, light and dark.

---

## 5 · Host panel

> Design the four **HostPanel** tabs at about 780×340 (the panel's usual size), light and dark.
>
> 1. **SchemaView:**
>    - Header "Brewline", with the description "An online coffee-gear shop with a meeting-room annex…".
>    - Buttons "Edit as JSON" and "Reset" (edited state, with an "edited" badge).
>    - A note: "Minab source never declares tables — the host supplies them."
>    - A grid of table cards: Customer (id 🔑 UUID, name TEXT, email CITEXT, country TEXT?, tier TEXT, credit_limit DECIMAL, joined_on DATE, orders ⇉ Order[], payments ⇉ Payment[]; 10 rows), Order (id, customer → Customer, status, total, placed_on, tracking_code TEXT?, lines ⇉ OrderLine[]; 26 rows), OrderLine, Product, Shipment, Payment, Room, Booking.
>    - Relations should read differently from scalar types.
>    - Also the JSON mode: a code editor with "Apply schema".
> 2. **DataView:**
>    - Table chips (Customer active); "SQL console" and "Reset data" buttons.
>    - "10 rows in Customer — real rows in the in-browser Postgres."
>    - A rows table with 10 customers: Ada Lovelace, Grace Hopper, Alan Turing, Edsger Dijkstra, Barbara Liskov, Donald Knuth, Margaret Hamilton, Ken Thompson (country null), Radia Perlman, Tim Berners-Lee.
>    - Also the SqlConsole open, with `SELECT name, country FROM "Customer" ORDER BY name;` and its result.
> 3. **RecordView:** as in brief 3, plus the "not a rule" EmptyState and the JSON toggle state.
> 4. **FieldView:**
>    - "Type of `$`: DECIMAL".
>    - PresetChips: ✓ 500 · ✗ 950 · ✗ −5 (active), with the note "Fails locally — the database is never asked."
>    - A value input.
>
> **Deliver:** all four tabs plus the variants, light and dark.

---

## 6 · Tour

> Design the **tour page** (`/learn/cross-table`) at 1440 and 375, light and dark.
>
> **Left column (360 px):**
> - **LessonList:** "Tour · 6/12 done", a progress bar, then 12 lessons (1–6 ticked, 7 current):
>   1. Hello, Minab
>   2. Walk relations with dots
>   3. Sort and limit
>   4. Group and aggregate
>   5. Collections and filters
>   6. Your first rule
>   7. Cross-table rules
>   8. Field rules with `$`
>   9. Strict types
>   10. Variables and functions
>   11. `if` and `switch` are expressions
>   12. What's next
> - **LessonPanel:**
>   - "Lesson 7", H1 "Cross-table rules".
>   - Prose: "Rules can look beyond the record. `#Booking` opens the whole Booking table inside an expression, and square brackets filter it. Inside the filter, `.` is each *other* booking — and `^` reaches one level up, to the booking being validated. Watch the **Execution** tab…"
>   - A **Goal box**: "Also fail when another booking of the same room overlaps this one."
>   - One hint revealed: "`NOT EXISTS(#Booking[ … ])` is true when no booking matches the filter."
>   - Buttons: Another hint, Show solution, Start over.
>   - Footer nav: ← Your first rule · Field rules with `$` →
>
> **Right column:** the workbench (compact toolbar "Your program" + Run), with the editor, output and host panel.
>
> Show two states: the **goal open** (dashed, neutral) and the **goal met** (success; "Goal met — nicely done."; the Next button becomes primary; lesson 7 ticked). Add a small, tasteful celebration for completing a lesson, and a bigger one for finishing lesson 12.
>
> On **mobile**: the lesson comes first (with the lesson list as a horizontal strip), then the workbench as tabs (Code · Result · Host) with a floating Run button.
>
> **Deliver:** desktop in both goal states, mobile in both, light and dark.

---

## 7 · Example gallery

> Design **`/examples`** at 1440 and 375, light and dark.
>
> - **Header:** "Examples" — "29 programs, every one verified against the engine. The first eleven are the repository's own `examples/`."
> - **GalleryFilters:** a search input; topic chips with counts (Query 15 · Record rule 6 · Field rule 2 · Aggregates 8 · Joins 1 · Functions 3 · Control flow 4 · Types 5 · JSON 2 · Check-only 4); a level select; "29 of 29".
> - **ExampleCard grid.** Cards: title, a one-liner (inline code allowed), a code preview (5–7 lines), tags, "beginner · §4 · from the repo". Use these:
>   - "A first pipeline query": Filter, walk a relation, sort and limit — no JOIN written.
>   - "Top customers": `GROUPBY` a relation, filter groups with `HAVING`, read the group through `KEY`.
>   - "No double bookings": A record-level rule with a correlated check against every other booking.
>   - "The customer must exist": A field-level rule: `$` is the value being validated.
>   - "Case-insensitive lookup": A `CITEXT` column and an explicit `CAST` — no implicit coercion.
>   - "Loops": A `for-in` loop over a table, with a guard. Checks today; runs later. (check-only)
> - Hover and focus states for a card, the active chip state, and the "No examples match" empty state.
>
> **Deliver:** the gallery in its default, filtered and empty states, at desktop and mobile, light and dark.

---

## 8 · Reference

> Design **`/reference`**, the cheat sheet, at 1440 and 375, plus its **Drawer** version (560 px, opened from the workbench), light and dark.
>
> Structure:
> - A search input ("Search: GROUPBY, $, CAST, switch…"), then section chips.
> - Sections, each a grid of cheat cards: Sigils · Pipeline queries · Validation rules · Operators · Types · Built-in functions · Variables and functions · Control flow · Writes.
> - Each card has a title, a spec § link badge, a syntax CodeBlock with copy, a description, and "Run an example". Some carry a "check-only" badge (Loops, `if!`, `.$index`, UPDATE/INSERT/DELETE).
>
> Example cards:
> - **Current record** — `.field    .customer.name` — "`.` is the row in scope — the row being filtered, selected or validated. `.field` reads a column; more dots walk `ref` relations." (§2)
> - **Group key** — `KEY    KEY.name` — "After `GROUPBY`, the group itself." (§2.2)
> - **GROUPBY · HAVING** — `GROUPBY .customer` / `HAVING SUM(.total) > 1000` (§4.3)
> - **Loops** (check-only) — `loop i from 1 to 10 by 2 { … }` (§9.4)
>
> **Deliver:** the page, the search-filtered state, the drawer, and mobile.

---

## 9 · Embed

> Design the **EmbedFrame**, the iframe version that goes into blog posts and my portfolio. Show it inside a mock blog article, at 720 px and 375 px, light and dark:
> - A header: small wordmark (links to the playground), the title "Within the credit limit", Run, and "Open in playground ↗".
> - Two columns: editor | output tabs (Result · Execution · SQL). One column on narrow screens.
> - The program: `// An order may not exceed its customer's credit limit.` / `.total <= .customer.credit_limit`. It shows a **Fails** verdict, and in the Execution tab one statement from `.customer.credit_limit`.
> - It should feel native inside someone else's page: quiet chrome, a clear frame.
>
> **Deliver:** an embed in an article at both widths, both themes, with the Result tab and the Execution tab.

---

## 10 · Mobile pass

> Do a dedicated **mobile pass** at 375×812 for the landing page, the workbench (all three tabs: Code, Result, Host, plus the wrapped toolbar and the floating Run button), the tour, and the gallery. Make sure:
> - tap targets are ≥ 44 px;
> - nothing scrolls horizontally except data tables and code;
> - the Run button never hides content.
>
> **Deliver:** these screens in light and dark.

---

## 11 · Overlays, feedback, edge pages

> Design:
> 1. **CommandPalette** (⌘K):
>    - The search field.
>    - Grouped results, each group headed: Actions (Run program ⌘↵, Copy share link ⌘S, Copy embed code, Download for the CLI, Show execution map…), Pages, Examples, Lessons.
>    - An active row, and a "Nothing matches" state.
> 2. **Toasts:** success "Link copied — it opens this program exactly as it is now.", info "Opened a shared program.", error "This share link is incomplete or damaged — it may have been cut off when it was copied."
> 3. **EngineStatusPill** in all 5 states.
> 4. The **404 page**: "Nothing here", with the joke `EXISTS(#Page[.path == $])` answered **false**, and "Go home".
> 5. The **error page**: "Something broke on this page", with Reload / Restart the engine, and "Your work is saved in this browser — reloading won't lose it."
> 6. The **editor hover card** for `.total`: "`.total` — a column of the current record · **type** `DECIMAL`".
> 7. The **completion list** after `.customer.`: id, name, email, country, tier, credit_limit, joined_on, orders, payments, with their types on the right.
>
> **Deliver:** all of the above in light and dark.

---

## 12 · Social image and icons

> Design:
> - An **Open Graph image**, 1200×630: the wordmark, the one-liner "One small language for querying and validating relational data.", a code snippet with sigils in their brand colors, and a small "Passes ✓" verdict or an execution-map motif. It must be legible at thumbnail size.
> - A **favicon** (SVG, and legible at 16 px).
> - An **apple-touch-icon** (180×180).
>
> **Deliver:** export-ready PNG and SVG files.

---

## 13 · Motion and micro-interactions

> Specify motion for:
> - running (the Run button, and the result appearing);
> - a verdict flipping pass ↔ fail;
> - trace hover → editor highlight;
> - preset chip selection;
> - a lesson completing, and the whole tour completing;
> - toasts;
> - the palette opening;
> - panel collapse and expand;
> - the landing hero demo switching tabs.
>
> Use the tokens `--duration-fast|normal|slow` and `--ease-standard|emphasized`. Give each interaction: trigger → property → duration → easing. Everything must degrade to instant under reduced motion.
>
> **Deliver:** a motion spec page, with a prototype of the verdict flip and the trace-hover highlight.

---

## 14 · Final review, then hand off

> Before handoff, audit the whole project:
> 1. Every token from the primer is defined for light and dark, with no unnamed one-off colors.
> 2. Component names match the list in the primer exactly.
> 3. Every state from briefs 3–5 exists.
> 4. Contrast: all text and syntax colors pass AA in both themes. List any that don't, and fix them.
> 5. Mobile screens exist for landing, workbench, tour, gallery and reference.
>
> Summarize the design decisions in a short rationale, to go with the handoff. Then prepare the **handoff to Claude Code**.

Then the W1 session writes `handoff.md` (see `README.md`, *Step E*).

---

## 15 · The wiring rules (for W2 and W3, not for Claude Design)

> You're building the approved Claude Design for the Minab Playground (`playground/`). The design links and decisions are in `playground/design/handoff.md`. Implement the design **without touching the logic side**. Read these first: `playground/design/contract.md` (the seam — what may and may not change), `playground/design/screens.md` (every screen and state), and `playground/README.md`.
>
> Plan, then implement, in this order:
> 1. **Tokens.** Map the design's tokens into `playground/src/styles/tokens.css`. Keep every existing custom-property name, and fill both themes (update both dark blocks identically). Add fonts (self-hosted in `public/fonts/`, or Google Fonts in `index.html`) and set `--font-*`.
> 2. **Global styles.** Replace `src/styles/wireframe.css` with the design's styles. Split per component if cleaner, but tokens stay the only source of color, size and motion. Keep the `.tok-*` syntax classes and the Monaco decoration classes (`.minab-pushdown`, `.minab-check-only`, `.minab-highlight*`).
> 3. **Components.** Update `src/ui/**` markup and styling to match the design. Keep exported component names, prop types and accessibility semantics. Add optional props only where the design needs them. Don't import the store or engine in `src/ui/**`.
> 4. **Icons and wordmark.** Implement the design's icon set behind the `Icon` component (keep the `IconName` union) and the real logo in `Wordmark`. Put the OG image, favicon and apple-touch-icon in `public/`, and update `index.html`.
> 5. **Motion.** Implement the motion spec with the duration and easing tokens. Respect `prefers-reduced-motion`.
> 6. **Layout moves.** If the design moves regions (e.g. the host panel into a side sheet), change only `src/routes/**` composition and `WorkbenchLayout`.
>
> Don't change `src/engine/**`, `src/client/**`, `src/state/**`, `src/hooks/**`, `src/syntax/**` or `src/content/**`, except copy edits in content with the tests still green.
>
> Verify:
> - Run `npm test` (all green) and `npm run build` in `playground/`.
> - Start the dev server, then check every state in `screens.md` in light and dark, at 1440 and 375 px.
> - Confirm the Monaco editor picked up the new syntax colors.
> - Confirm keyboard navigation and focus rings work.
>
> Report anything in the design you couldn't implement faithfully, and why.
