# Screen specs

Every screen, its regions, and every state each region can be in. Component names are the React components in `src/ui/` (see `contract.md` for their props). Breakpoints:

- **Wide:** ≥ 1280 px
- **Medium:** 900–1279 px
- **Narrow:** < 900 px (page level)
- The **workbench** also switches to tabs whenever its own width drops below **760 px**. This matters on the tour page, where the lesson takes part of the width.

---

## Global

### AppShell (every page except `/embed`)
- **TopBar**, sticky, `--topbar-height`:
  - Left: **Wordmark** `.minab`, with the dot in the record-sigil color.
  - **Nav:** Playground · Tour · Examples · Reference. The active item is marked.
  - Right: the search trigger ("Search ⌘K"), the theme toggle (cycles system → light → dark), and the GitHub link.
- **Skip link:** "Skip to content", visible on focus.
- **Global overlays:**
  - **CommandPalette** (⌘K). Grouped results: Actions, Pages, Examples, Lessons. Keyboard-driven (↑↓↵, esc).
  - **Drawer** for the cheat sheet, from the right, 560 px wide or full width on mobile.
  - **Toast**, bottom center. Tones: info, success, error.

### Page titles
`Minab — a query and validation language` · `Playground · Minab` · `Tour · Minab` · `Examples · Minab` · `Reference · Minab`

---

## `/` Landing

| Region | Component | Content | States |
|---|---|---|---|
| Hero | `Hero` | Eyebrow, H1 "Say what you mean about your data.", subhead, two CTAs, a "runs in your browser" note | — |
| Hero demo | `HeroDemo` | Tabs Query / Rule / Types; caption; the program (static highlight); output; "Open in the playground →" | loading ("Starting PostgreSQL in your browser…"), rows + compiled SQL, verdict + statement, diagnostics |
| Two layers | `LayerCards` | Query card and Validate card, each with code and "Run it →" | — |
| Sigils | `SigilGrid` | 6 cards: `.`, `$`, `^`, `#`, `KEY`, `&`. Big glyph in its syntax color, name, tiny example | — |
| How it runs | `HowItRuns` | 4 numbered steps: Parse → Resolve & check → Compile → Run (hybrid) | — |
| Comparison | `Comparison` | Minab (left) → PostgreSQL (right), compiled live | SQL loading ("Compiling…") |
| Features | `FeatureGrid` | 6 features with icons | — |
| CTA | `CtaBand` | Title, body, 2 buttons | — |
| Footer | `Footer` | Author credit (+ portfolio link), GitHub, spec, VS Code extension, "Built with…" | — |

**Responsive:**
- Wide: hero in 2 columns (copy | demo).
- Medium and narrow: hero stacks.
- Comparison stacks below 860 px, with the arrow rotated.

**Opportunities for the designer:**
- An animated hero. For example, the demo types itself, or the execution map draws a line from the `EXISTS(…)` span to its SQL.
- An illustration for "How it runs".

---

## `/play` Workbench

```
┌ Toolbar ──────────────────────────────────────────────────────────────┐
│ [ExamplePicker ▾] [§6.1] [↺]      (● Postgres ready) [Auto-run ◉]   │
│                                   [📖] [⤓] [</>] [Share] [▶ Run ⌘↵]  │
├───────────────────────────────┬───────────────────────────────────────┤
│ Editor (Monaco)               │ OutputPanel                           │
│                               │ [Result][SQL][Execution ①][Problems][AST]
│                               │                                       │
├ EditorStatusBar ──────────────┤  (tab body)                           │
│ Record rule → BOOLEAN  ✓ No problems                                  │
├───────────────────────────────┤                                       │
│ HostPanel                     │                                       │
│ [Schema][Data][Record .][Field]                                       │
│ (tab body)                    │                                       │
└───────────────────────────────┴───────────────────────────────────────┘
```

- **Panels are resizable.** Left/right defaults to 55 / 45. Editor/host defaults to 62 / 38.
- **The host panel can collapse** to a one-line "Host — schema, data, record ›" bar.

### Toolbar (`Toolbar`)
- **ExamplePicker.** Shows the example title, or "Scratch — pick an example…".
- **Spec badge** (e.g. §6.1) and **Reset to example** (↺). Only shown when the workspace came from an example.
- **EngineStatusPill.** States:
  - `starting`: "Starting…", pulsing
  - `ready`: "Ready", gray; Postgres not booted yet
  - `booting-db`: "Starting Postgres…", pulsing
  - `db-ready`: "Postgres ready", green
  - `failed`: "Engine stopped" or "Postgres failed", red, with **Restart**
- **Auto-run toggle** (default on). **Cheat sheet**, **Download for the CLI**, **Copy embed code**, **Share**.
- **RunButton:** primary, with ⌘↵ hint. `busy` shows a spinner.

### Editor (`CodeEditor`, Monaco; themed by tokens)
Things Monaco draws, all colored by tokens:
- Syntax colors: one per token category (see `contract.md`).
- Error and warning squiggles.
- **Pushdown underline** (`--pushdown`) on spans that became SQL, each with a hover message.
- **Check-only shading** (`--check-only-soft`) on loops, writes and the like, each with a hover message.
- **Transient highlight** (`--highlight-soft`, or `--pushdown-soft` with an outline) while hovering a trace entry or AST node.
- Hover cards: types, columns, `#Table` summaries, built-in signatures, keyword docs from the cheat sheet.
- Completion list: columns after `.`, tables after `#` and `FROM`, functions after `&`, keywords from the grammar, snippets.
- **Loading fallback:** until Monaco arrives, the program is shown as highlighted static code (`mb-editor-fallback`).

### EditorStatusBar
- Program kind: Pipeline query, Record rule, Field rule, Expression or Empty. Plus the result type ("→ BOOLEAN").
- A **check-only** badge when it applies.
- The problems summary as a button: ✓ No problems, or ⚠ N errors.

### OutputPanel tabs
Badges: Result shows the row count; Execution shows the statement count (pushdown tone); Problems shows the count (danger tone).

**Result (`ResultView`)**, one of:
1. **Nothing run yet.** EmptyState + Run button.
2. **Running.** EmptyState "Running…" + spinner. If there's a previous result, it stays, dimmed.
3. **Rows** (`RowsTable`):
   - Sticky header in mono; a row index column.
   - Numbers right-aligned and tabular.
   - `null` in muted italic. JSON cells wrap in mono.
   - Zero rows: EmptyState "No rows", listing the columns.
4. **Verdict** (`VerdictCard`):
   - **Passes**: pass tone, check mark. **Fails**: fail tone, cross.
   - A sentence about what was validated.
   - A link: "N statements reached the database — see how →", or "Answered entirely from the record".
5. **Value** (`ValueView`): the JSON value, with its type badge.
6. **Problems to fix first.** EmptyState in danger tone + "Show problems".
7. **Check-only** (Callout, check-only tone): "Checked ✓ — loops aren't executed yet", with the spec § and the evaluator's words.
8. **Error** (Callout, danger tone). One of: config error, evaluation error, "The database refused a statement" (+ SQL), or internal.
9. **Footer meta:** rows · statements · ms, plus an "edited since this run" badge when stale.

**SQL (`SqlView`)**, one of:
- **Compiles:** "The whole program compiles to one parameterized PostgreSQL statement — this is exactly what runs." Then the formatted SQL (copyable) and the ParamsTable.
- **Doesn't compile on its own** (rules, functions): a Callout, pushdown tone, "No single SQL statement", plus the reason in plain words. Then "What the last run sent:" with each statement and its params, and "See where each statement came from →".
- **Errors:** "The program has errors — fix them to see its SQL."

**Execution (`ExecutionView`)**, one of:
- Summary card (pushdown-soft), then timings (parse · check · run), then the ordered **TraceItem** list. Each item has:
  - a "Statement n" badge, rows · ms;
  - "from" + the Minab span (a button);
  - the SQL and the params;
  - "returned `value`";
  - an error line, if the statement failed.
- **0 statements:** EmptyState "0 statements" with guidance.
- **Nothing ran:** fix problems first.
- Legend: "Underlined in the editor: the parts that became SQL."

**Problems (`ProblemsList`)**:
- A list of clickable rows: severity icon, message, `syntax|minab · line:col`.
- A host-config error, when there is one, shown first.
- Empty: ✓ "No problems — the program parses, resolves and type-checks against this host's schema."

**AST (`AstView`)**:
- A collapsible tree. Each row shows `feature:`, `$type`, `attr=value`s, and an inferred-type badge.
- Hovering a row highlights its span; clicking selects it.

### HostPanel tabs
- **Schema (`SchemaView`)**:
  - Dataset title and description, "edited" badge. "Edit as JSON" / "Show tables"; "Reset" when edited.
  - A note: "Minab source never declares tables — the host supplies them."
  - A grid of table cards. Each lists its columns: name (🔑 marks the primary key), and type in type color; relations in alias color ("→ Customer", "⇉ Order[]"); row count.
  - JSON mode: a Monaco JSON editor (schema-validated) + "Apply schema".
- **Data (`DataView`)**:
  - Table chips. "SQL console" toggle. "Reset data".
  - "N rows in T — real rows in the in-browser Postgres", then a RowsTable.
  - **SqlConsole:** a mono textarea (⌘↵ runs), "Run SQL", results or an error or "N row(s) affected".
- **Record (`RecordView`)**:
  - "Rule table" select.
  - Not a rule: EmptyState explaining how to make one.
  - A rule: **PresetChips** (✓/✗ by expectation; the active one filled; its note below), then the record form (mono labels and inputs) with a Form/JSON toggle, then a footnote about related rows being read through the key.
- **Field (`FieldView`)**:
  - `$` type select, then EmptyState or PresetChips + the value input.
  - A warning when there's no rule table.

### Narrow workbench (< 760 px)
- The Toolbar wraps.
- **Tabs:** Code · Result (row badge) · Host. The Code tab shows the editor and the status bar.
- A floating **Run** button, bottom-right, above the safe area.

---

## `/examples` Gallery

- **SectionHeader:** "Examples", with a subtitle that includes the count.
- **GalleryFilters:**
  - A search input with an icon.
  - Topic chips with counts, `aria-pressed`.
  - A Level select, "n of N", and "Clear filters".
- **ExampleGrid:** a responsive grid of **ExampleCard**s, each with:
  - the title (the whole card is clickable) and summary;
  - a code preview (comments stripped, first 7 lines);
  - tag badges, with a warning tone for check-only;
  - level, spec §, and "from the repo".
- **Empty:** "No examples match" + Clear filters.

---

## `/learn/:lesson` Tour

- **Wide:** left column (300–400 px): **LessonList** (a "Tour · n/12 done" label, a progress bar, 12 items marked current or ticked) and **LessonPanel**, which contains:
  - "Lesson n" and the H1;
  - the Markdown body, with highlighted code;
  - the **Goal box**: open (dashed border, flag) or met (success tone, check, "Goal met — nicely done.");
  - hint Callouts (lightbulb);
  - actions: Hint / Another hint, Show solution, Start over;
  - footer nav: ← previous, next → (primary once the goal is met).
- **Right:** the workbench, with a compact toolbar ("Your program" + Run) and no example picker.
- **Narrow:** the lesson stacks above; the lesson list becomes a horizontal strip.

---

## `/reference` Cheat sheet

- **SectionHeader** + a link to the spec.
- Search ("GROUPBY, $, CAST, switch…"), then a TOC of section chips.
- **Sections:** Sigils, Pipeline queries, Validation rules, Operators, Types, Built-in functions, Variables and functions, Control flow, Writes.
- **Cheat cards:** title, a check-only badge where it applies, a spec § link, the syntax block (copyable), a description, and "Run an example".
- The same component, `compact`, renders inside the workbench Drawer.

---

## `/embed`

- **EmbedFrame:** a header (Wordmark linking to the playground, example title, Run, "Open in playground ↗"), then 2 columns: editor | output tabs. Below 640 px it's 1 column.
- Tabs are configurable (`?tabs=result,sql,execution,problems`). Supports read-only and a forced theme.
- No top bar, palette or toasts.

---

## Error and utility pages

- **404 (`NotFoundPage`):** an EmptyState with the Minab joke, and "Go home".
- **RouteError:** an EmptyState in danger tone, Reload / Restart the engine, and a reassurance that work is saved.

---

## Social and meta assets

- **OG image** `public/og-image.png`, 1200×630. The wordmark, the one-liner, a code snippet with sigils in their colors, and ideally the pass/fail verdict.
- **Favicon** `public/favicon.svg` (a placeholder exists). Plus `apple-touch-icon.png` (180×180).
- **Theme colors** for the browser chrome: `<meta name="theme-color">` for light and dark, set in `index.html`.
