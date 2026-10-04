# The design contract

This document is the seam between the working app and its visual design. Anything on the **design side** can be replaced by the Claude Design handoff. Anything on the **logic side** must not change. As long as both sides keep this contract, a redesign can't break the language demo.

```
engine (worker) → client → state/store → hooks → routes (composition) → ui components + tokens.css
└──────────────────── logic side: do not change ────────────────────┘   └──── design side: replace ────┘
```

| Layer | Path | During the design handoff |
|---|---|---|
| Engine: Langium, PGlite, the Minab toolchain | `src/engine/**` | **Don't touch** |
| Worker client | `src/client/**` | **Don't touch** |
| State, persistence, share links | `src/state/**` | **Don't touch** |
| View-model hooks | `src/hooks/**` | **Don't touch.** Add a hook if a new design needs new data. |
| Content: examples, tour, cheat sheet, landing copy | `src/content/**` | Copy edits are fine. Every example and lesson is tested, so keep `npm test` green. |
| Monaco integration | `src/monaco/**` | Don't restyle it directly; its colors come from tokens. `CodeEditor` props can grow. |
| Syntax tokenizer and highlighter | `src/syntax/**` | Don't touch. Colors come from `--syntax-*` tokens. |
| **Design tokens** | `src/styles/tokens.css` | **Replace the values.** Keep every name; add new ones freely. |
| **Wireframe skin** | `src/styles/wireframe.css` | **Replace wholesale** with the design's CSS (or modules, or Tailwind — see below). |
| **UI components** | `src/ui/**` | **Restyle or rewrite.** Keep the exported names and prop types; adding optional props is fine. |
| Route composition | `src/routes/**` | Layout glue. Adjust only when a new design moves things between regions. |

---

## 1. Design tokens

All defined in `src/styles/tokens.css`. Dark values sit on `:root` (dark is the default). Light values are repeated in two blocks that must stay identical: `@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) {…} }` and `:root[data-theme='light'] {…}`. `test/design-tokens.test.ts` checks this.

### Surfaces and text
| Token | Used for |
|---|---|
| `--bg-canvas` | Page background |
| `--bg-surface` | Panels, cards, top bar |
| `--surface-raised` | Raised cards |
| `--surface-overlay` | Palette, drawer, Monaco widgets (hover, suggest) |
| `--surface-sunken` | Inset areas: code captions, inputs' neighbors, table headers |
| `--surface-hover` | Hover background for rows, tabs, buttons |
| `--surface-selected` | Active tab, selected nav item, palette selection |
| `--text-primary` · `--text-secondary` · `--text-muted` · `--text-inverse` · `--text-link` | Text hierarchy |
| `--border-subtle` · `--border-default` · `--border-strong` | Hairlines → inputs → emphasis |

### Brand and states
| Token | Used for |
|---|---|
| `--accent` · `--accent-hover` · `--accent-contrast` · `--accent-soft` | Primary buttons, links, active chips |
| `--focus-ring` | Every `:focus-visible` outline, and Monaco's focus border |
| `--success` · `--danger` · `--warning` · `--info` (+ `-soft`) | Callouts, badges, problem icons, toasts |
| `--verdict-pass` · `--verdict-pass-soft` · `--verdict-fail` · `--verdict-fail-soft` | **VerdictCard**, preset chip marks |
| `--pushdown` · `--pushdown-soft` | **The execution map**: pushed-down spans in the editor, trace items, the Execution badge |
| `--check-only` · `--check-only-soft` | Constructs that type-check but don't run yet |
| `--highlight-soft` | Transient editor highlight while hovering AST nodes |

### Editor (read by Monaco at runtime)
`--editor-bg` `--editor-fg` `--editor-gutter-fg` `--editor-gutter-fg-active` `--editor-line-highlight` `--editor-selection` `--editor-selection-inactive` `--editor-cursor` `--editor-indent-guide` `--editor-bracket-match` `--editor-bracket-match-border` `--editor-scrollbar` `--editor-scrollbar-hover` `--editor-font-size` `--editor-line-height`

### Syntax palette: the heart of the brand
Each lexical category has its own token. Monaco and every static snippet (landing, gallery, lessons, cheat sheet, SQL views) use the same ones.

| Token | Colors | Examples |
|---|---|---|
| `--syntax-keyword-pipeline` | SQL-style clauses (bold) | `FROM` `WHERE` `GROUPBY` `SELECT` `ORDERBY` `LIMIT` `AS` `JOIN` |
| `--syntax-keyword-dml` | Writes (bold) | `INSERT` `UPDATE` `DELETE` `SET` `VALUES` |
| `--syntax-keyword-operator` | Word operators | `AND` `OR` `NOT` `IN` `LIKE` `CAST` `is` `isnot` |
| `--syntax-keyword-control` | Control flow and declarations | `let` `fn` `if` `if!` `else` `switch` `loop` `_` |
| `--syntax-type` | Types | `TEXT` `DECIMAL` `DATE` `JSON`, `object` `array` |
| `--syntax-constant` | Literals | `true` `false` `null` |
| `--syntax-builtin` | Built-in functions | `COUNT` `SUM` `EXISTS` `ALL` |
| `--syntax-sigil-record` | **`.`** current record | `.status`, `.customer` (and the wordmark's dot) |
| `--syntax-sigil-field` | **`$`** field value | `$` |
| `--syntax-sigil-parent` | **`^`** parent record | `^` |
| `--syntax-sigil-alias` | **`#`** named scope / table | `#Booking` |
| `--syntax-function` | A user function call | `discounted` |
| `--syntax-sigil-key` | **`KEY`** group key | `KEY` |
| `--syntax-sigil-index` | `.$index` | `.$index` |
| `--syntax-member` | A member after a dot | `.customer`**`.name`** |
| `--syntax-identifier` | Names | variables, aliases |
| `--syntax-string` · `--syntax-number` · `--syntax-comment` · `--syntax-operator` · `--syntax-delimiter` · `--syntax-invalid` | The usual | |

**Requirement:** every syntax color must meet WCAG AA (4.5:1) against `--editor-bg`, in both themes.

### Type, space, shape, motion, layout
- **Fonts:** `--font-sans` `--font-display` `--font-mono`
- **Sizes:** `--text-xs` … `--text-4xl`
- **Leading:** `--leading-tight|normal|relaxed`
- **Weights:** `--weight-regular|medium|semibold|bold`
- **Tracking:** `--tracking-tight`
- **Space:** `--space-0|1|2|3|4|5|6|8|10|12|16` (a 4 px grid)
- **Radius:** `--radius-sm|md|lg|xl|full`
- **Shadow:** `--shadow-sm|md|lg|overlay`
- **Motion:** `--duration-fast|normal|slow`, `--ease-standard|emphasized`. All durations drop to 0 under `prefers-reduced-motion`.
- **Layout:** `--topbar-height` `--content-max` `--gutter` `--z-sticky` `--z-dropdown` `--z-overlay` `--z-toast`

---

## 2. Component inventory

All of these are presentational: props in, callbacks out, no data fetching, no store access. Each is re-exported from its file. **Keep the names and props.** Styling hooks are the class names in `wireframe.css`, plus `data-*` attributes for state (listed below).

### Primitives (`src/ui/primitives/`)
| Component | Props (summary) | State attributes |
|---|---|---|
| `Button` | `variant: primary\|secondary\|ghost\|danger`, `size: sm\|md\|lg`, `icon?`, `busy?`, + button attrs | `data-variant`, `data-size`, `data-state="busy"` |
| `IconButton` | `icon`, `label` (required, also the tooltip), `pressed?`, `size?` | `aria-pressed` |
| `Badge` | `tone: neutral\|accent\|success\|danger\|warning\|pushdown\|check-only`, `title?` | `data-tone` |
| `Tabs<T>` | `tabs: {id,label,icon?,badge?,badgeTone?}[]`, `active`, `onChange`, `ariaLabel`, `size?`, `idPrefix` | `role=tab`, `aria-selected`, `data-state=active` |
| `Kbd` | `keys: string[]` | — |
| `Spinner` | `size?`, `label?` | — |
| `EmptyState` | `icon?`, `title`, `children?`, `action?`, `tone?: neutral\|danger\|warning\|check-only` | `data-tone` |
| `Callout` | `tone: info\|warning\|danger\|success\|check-only\|pushdown`, `icon?`, `title?`, `children?` | `data-tone` |
| `Toggle` | `checked`, `onChange`, `label`, `hint?` | `role=switch` |
| `Icon` | `name: IconName`, `size?`, `label?` | `data-icon`. **Swap the set freely** (e.g. Lucide), but keep the `IconName` union. |
| `CodeBlock` | `code`, `language: minab\|sql\|plain`, `copyable?`, `wrap?`, `caption?` | `data-language`, `data-wrap` |
| `Inline` / `InlineCode` | `text` with `backticks` / a code string | — |
| `Markdown` | `source` (trusted, repo-authored) | `.mb-prose` |
| `Toast` | `toast?: {id,message,tone}`, `onDismiss` | `data-tone` |

### Shell and overlays
| Component | Props |
|---|---|
| `AppShell` (`ui/shell/AppShell.tsx`) | `nav: {to,label}[]`, `theme: {preference,onCycle}`, `onOpenPalette`, `repoUrl`, `layout: app\|document`, `children` |
| `Wordmark` | — (the `.minab` logotype; replace with the real logo) |
| `CommandPalette` (`ui/overlays/`) | `open`, `commands: Command[]` (`{id,title,group,keywords?,shortcut?,run}`), `onClose` |
| `Drawer` | `open`, `title`, `onClose`, `children` |

### Workbench (`ui/workbench/`)
| Component | Props |
|---|---|
| `WorkbenchLayout` | `toolbar`, `editor`, `statusBar`, `output`, `host?`, `hostOpen`, `aside?`, `runFab`, `mobileBadges?`, `hostCollapsedBar?` (all slots are ReactNodes) |
| `Toolbar` | `example?`, `examples`, `onPickExample`, `onResetExample?`, `engine: EngineView`, `running`, `onRun`, `autoRun`, `onAutoRunChange`, `onShare`, `onEmbed`, `onExport`, `onOpenReference` |
| `EngineStatusPill` | `engine: EngineView` (`indicator: starting\|ready\|booting-db\|db-ready\|failed`, `label`, `detail`, `restart`) → `data-state` |
| `RunButton` | `onRun`, `running` |
| `ExamplePicker` | `examples`, `currentId?`, `onPick` |
| `EditorStatusBar` | `kind?`, `resultType?`, `errors`, `warnings`, `checkOnly`, `onShowProblems` |

### Output (`ui/output/`)
| Component | Props |
|---|---|
| `OutputPanel` | `tab`, `onTabChange`, `counts: {problems, statements?, rows?}`, `tabs?`, `children` |
| `ResultView` | `report?: RunReport`, `running`, `stale`, `subject?`, `onRun`, `onShowProblems`, `onShowExecution` → `data-state: fresh\|running\|stale` |
| `RowsTable` | `columns`, `rows`, `caption?` → cells have `data-type: number\|text\|json\|null` |
| `VerdictCard` | `value: boolean`, `kind`, `subject?`, `statements`, `onShowExecution` → `data-verdict: pass\|fail` |
| `ValueView` | `value`, `type?` |
| `SqlView` | `analysis?`, `trace`, `onShowExecution` |
| `ParamsTable` | `params` |
| `ExecutionView` | `report?`, `onHighlight(range?)`, `onReveal(range)` → items have `data-state: ok\|error` |
| `ProblemsList` | `diagnostics`, `configError?`, `onSelect(range)` → rows have `data-severity` |
| `AstView` | `tree?`, `loading`, `onHighlight`, `onReveal` |

### Host (`ui/host/`)
| Component | Props |
|---|---|
| `HostPanel` | `tab: schema\|data\|record\|field`, `onTabChange`, `ruleKind`, `error?`, `onCollapse?`, `children` |
| `SchemaView` | `tables: TableView[]`, `datasetTitle?`, `datasetDescription?`, `edited`, `onReset`, `jsonEditor` (slot) |
| `DataView` | `tables`, `active?`, `preview?`, `loading`, `error?`, `onSelect`, `onReset`, `onRunSql` |
| `SqlConsole` | `onRun(text)`, `onDone?` |
| `RecordView` | `ruleKind`, `recordTable?`, `tables`, `record?`, `presets`, `activePresetId?`, `onPreset`, `onRecordChange`, `onRecordTableChange` |
| `FieldView` | `ruleKind`, `fieldType?`, `fieldValue?`, `recordTable?`, `presets`, `activePresetId?`, `onPreset`, `onFieldTypeChange`, `onFieldValueChange` |
| `PresetChips` | `presets`, `activeId?`, `onPick` → chips have `data-expect: pass\|fail`, `data-state=active` |

### Pages' sections
| Component | File | Props |
|---|---|---|
| `Hero`, `HeroDemo`, `SectionHeader`, `LayerCards`, `SigilGrid`, `HowItRuns`, `Comparison`, `FeatureGrid`, `CtaBand`, `Footer` | `ui/landing/Landing.tsx` | Copy from `content/landing.ts`; slots for live output |
| `GalleryFilters`, `ExampleCard`, `ExampleGrid` | `ui/gallery/Gallery.tsx` | See `GalleryFiltersProps`, `ExampleCardProps` |
| `LessonList`, `LessonPanel` | `ui/tour/Tour.tsx` | `lessons`, `progress`; `LessonPanelProps` |
| `CheatSheet` | `ui/reference/CheatSheet.tsx` | `sections`, `specUrl`, `onOpenExample`, `compact?` |
| `EmbedFrame` | `ui/embed/EmbedFrame.tsx` | `title?`, `editor`, `output`, `runButton`, `openHref` |

### The data these components render
The types live in `src/engine/protocol.ts` (`RunReport`, `AnalyzeReport`, `TraceEntry`, `EngineDiagnostic`, `AstNodeView`, `TablePreview`, …) and in `src/content/types.ts` (`Example`, `Lesson`, `RecordPreset`). Designs should cover every variant of `RunReport`. `screens.md` lists them.

---

## 3. Editor decoration classes

Monaco adds these classes. Style them in CSS using tokens:

| Class | Meaning |
|---|---|
| `.minab-pushdown` | A span that was compiled to SQL and sent to Postgres (inline) |
| `.minab-check-only` | A construct that type-checks but doesn't execute yet |
| `.minab-highlight` (+ `-pushdown`, `-ast`, `-problem`) | Transient highlight from hovering a trace entry, AST node, or problem |

Token colors in static code use `.tok .tok-<category>`, for example `.tok-sigil-record`. `wireframe.css` maps each to its `--syntax-*` token. Keep that mapping.

---

## 4. Rules for wiring a design in

1. **Tokens first.** Put the design's palette, type, spacing and motion into `tokens.css`, in both themes. That alone restyles the editor and every code block.
2. **Then components.** Rewrite `src/ui/**` markup and styles to match the design. Keep:
   - the exported names and prop types, plus accessibility semantics: roles, `aria-*`, labels, focus order;
   - every state in `screens.md`: empty, loading, running, stale, error, check-only, pass/fail, narrow.
3. **Styling technology:**
   - The default is plain CSS files reading tokens. Replace `wireframe.css`, or split it per component.
   - Tailwind v4 is fine too. Map its theme to the CSS variables (`@theme { --color-accent: var(--accent); … }`) so tokens remain the source of truth.
4. **Fonts.**
   - Self-host in `public/fonts/` with `@font-face` in `tokens.css`, or use Google Fonts in `index.html`.
   - Set `--font-sans|display|mono`.
   - Monaco reads `--font-mono`, `--editor-font-size` and `--editor-line-height` at mount.
5. **Icons.** Replace the `PATHS` map in `Icon.tsx`, or re-implement `Icon` on an icon library. Keep the `IconName` union.
6. **Don't:**
   - import the store or engine from `src/ui/**`;
   - hard-code colors;
   - style Monaco's internal DOM beyond the decoration classes above;
   - remove the stale, running or check-only states.
7. **Verify** with `design/README.md` → *Step F*: `npm test`, `npm run build`, and the visual checklist.
