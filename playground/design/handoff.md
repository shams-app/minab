# Design handoff — Minab Playground

**Canvas:** https://claude.ai/artifact/QyDgDbgJNFgeAJ3YraPNod ("Minab Playground", Claude Design)

The canvas is private. The owner shares it from its Share menu if a later session cannot open it.

This file is written by phase W1, one section per approved round. Phases W2 and W3 build from it and from the canvas. They follow brief 15 in [`design-briefs.md`](design-briefs.md) and the seam in [`contract.md`](contract.md).

| Round | Briefs | Status |
|---|---|---|
| 1 · Design system | 0, 1 | Approved 2026-10-03 |
| 2 · The app | 2–5 | Approved 2026-10-03 |
| 3 · The other pages | 6–13 | — |
| 4 · Check and hand off | 14 | — |

---

## Round 1 · Design system (approved 2026-10-03)

Canvas page "Round 1 · Design system", boards 00–05 and 01b.

### Direction

**Terminal Noir** (D40): dark first, developer-tool native. Deep charcoal surfaces. The syntax palette glows; the chrome is quiet (thin borders, glass overlays). Two signatures make it distinct:

1. **The sigil colors.** They are the only saturated colors in code.
2. **The execution map.** A lime underline (`--pushdown`) marks every span that became SQL.

**Dark is the default theme.** Light follows `prefers-color-scheme: light` or the manual toggle. This flips today's `tokens.css`: put the **dark** values on `:root`, and the light values in two identical blocks: `@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) {…} }` and `:root[data-theme='light'] {…}`. The theme toggle still cycles system → light → dark.

### The mark and the wordmark

- **The mark (board 01b, version B "Three petals"; approved).** An M, a shield and a check mark, drawn as a tulip:
  - the top of the M is the open cup of the tulip, with a middle petal rising in the V;
  - the outer strokes curve down to a soft point (the shield);
  - the right petal bends inward and becomes a check mark.
  - It is a stroke drawing, `stroke="currentColor"`, round caps and joins, `viewBox="0 0 120 140"`. Paths:
    ```
    M24 20 C16 44 16 72 24 92 C34 112 46 122 60 130     (left side)
    M24 20 C36 34 50 46 60 58 C70 46 84 34 96 20        (top of the M)
    M47 45 C52 38 56 32 60 26 C64 32 68 38 73 45        (middle petal)
    M96 20 C104 42 102 62 90 76 L62 104 L46 88          (right petal → check)
    M102 86 C99 106 84 120 60 130                       (right side)
    ```
  - Stroke width grows as the size shrinks: 7–8 at 120 px and up, 9 in the lockup (64 px tall), 11 at 64 px, 14 at 32 px, 18 at 16 px. At 32 px and 16 px, drop the middle petal.
  - Color: `--accent` (dark `#49C2FF` with `--glow-record`; light `#0A6CC2`, no glow). It is never red.
  - Version C (with a stem and a leaf: `M60 130 L60 150`, `M60 144 C49 143 41 137 38 127`) may be used large, on the landing hero and the OG image. Version A is not used.
  - Meaning, for the case study: the tulip is the Persian flower of remembrance (see "The name" in [`brief.md`](brief.md)).
- **Lockup:** mark B + the wordmark `.minab` (JetBrains Mono 700, −0.03em tracking, the dot in `--syntax-sigil-record`). This goes in the top bar, the embed header and the footer.
- **Wordmark alone** (board 01, version A): `.minab` in mono; the dot glows in dark (`--glow-record`) and has no glow in light. Use it for text-only places (the page title, the OG text).
- **App icon, favicon, apple-touch-icon:** mark B on a `#0D1015` rounded square (radius 22% of the size), in both themes. This replaces the dot-and-caret icon on board 01.
- **Browser chrome:** `theme-color` `#0B0D10` (dark) and `#F4F5F8` (light).

### Color tokens (board 02)

Dark value / light value. Every existing name stays. All UI text pairs pass AA (see the board).

| Token | Dark | Light |
|---|---|---|
| `--bg-canvas` | `#0B0D10` | `#F4F5F8` |
| `--bg-surface` | `#111418` | `#FFFFFF` |
| `--surface-raised` | `#161A20` | `#FFFFFF` |
| `--surface-overlay` | `#181C23` (86% + blur) | `#FFFFFF` (90% + blur) |
| `--surface-sunken` | `#08090C` | `#ECEEF2` |
| `--surface-hover` | `#1A1F27` | `#EEF0F4` |
| `--surface-selected` | `#1C2633` | `#E2ECF8` |
| `--text-primary` | `#E6E9EF` | `#12151B` |
| `--text-secondary` | `#A9B1BE` | `#444C5A` |
| `--text-muted` | `#7D8695` | `#636C7B` |
| `--text-inverse` | `#0B0D10` | `#FFFFFF` |
| `--text-link` | `#6CCBFF` | `#0063AD` |
| `--border-subtle` | `#1E232B` | `#E3E6EB` |
| `--border-default` | `#2A313B` | `#CDD2DA` |
| `--border-strong` | `#46505E` | `#8F98A6` |
| `--accent` | `#49C2FF` | `#0A6CC2` |
| `--accent-hover` | `#7AD3FF` | `#0857A0` |
| `--accent-contrast` | `#04131D` | `#FFFFFF` |
| `--accent-soft` | `#0F2A3B` | `#E1EEFA` |
| `--focus-ring` | `#49C2FF` | `#0A6CC2` |
| `--success` / `-soft` | `#5BD38A` / `#10291B` | `#16794A` / `#E2F3EA` |
| `--danger` / `-soft` | `#FF7A85` / `#3A1519` | `#B42318` / `#FCEBEA` |
| `--warning` / `-soft` | `#F5B84B` / `#33280F` | `#8A5A00` / `#FFF3D6` |
| `--info` / `-soft` | `#49C2FF` / `#0F2A3B` | `#0A6CC2` / `#E1EEFA` |
| `--verdict-pass` / `-soft` | `#5BD38A` / `#10291B` | `#16794A` / `#E2F3EA` |
| `--verdict-fail` / `-soft` | `#FF7A85` / `#3A1519` | `#B42318` / `#FCEBEA` |
| `--pushdown` / `-soft` | `#C6F36B` / `#1F2A12` | `#4C7A00` / `#EEF6DB` |
| `--check-only` / `-soft` | `#F5B84B` / `#33280F` | `#8A5A00` / `#FFF3D6` |
| `--highlight-soft` | `#3A3415` | `#FFF2B3` |
| `--editor-bg` | `#0D1015` | `#FBFCFD` |
| `--editor-fg` | `#E6E9EF` | `#12151B` |
| `--editor-gutter-fg` | `#5B6472` | `#9AA2AF` |
| `--editor-gutter-fg-active` | `#A9B1BE` | `#444C5A` |
| `--editor-line-highlight` | `#131821` | `#F2F4F7` |
| `--editor-selection` | `#1F3A52` | `#CFE3F7` |
| `--editor-selection-inactive` | `#1A2633` | `#E3EAF2` |
| `--editor-cursor` | `#49C2FF` | `#0A6CC2` |
| `--editor-indent-guide` | `#1A1F27` | `#ECEEF2` |
| `--editor-bracket-match` | `#1C2B38` | `#E1EEFA` |
| `--editor-bracket-match-border` | `#3E6A8A` | `#8DB8E0` |
| `--editor-scrollbar` | `#46505E80` | `#CDD2DA80` |
| `--editor-scrollbar-hover` | `#7D869580` | `#8F98A680` |

**New tokens** (added; nothing is renamed):

| Token | Dark | Light | Use |
|---|---|---|---|
| `--glow-record` | `0 0 24px rgb(73 194 255 / .45)` | `none` | The wordmark dot, the mark, big sigils |
| `--glow-pushdown` | `0 0 10px rgb(198 243 107 / .35)` | `none` | Under pushed-down spans |
| `--overlay-blur` | `16px` | `16px` | `backdrop-filter` of palette, drawer, toasts |
| `--theme-color` | `#0B0D10` | `#F4F5F8` | `<meta name="theme-color">` |

### Syntax palette (board 03)

Contrast is against `--editor-bg`. Every value passes AA (4.5:1) in both themes.

| Token | Dark | Ratio | Light | Ratio | Style |
|---|---|---|---|---|---|
| `--syntax-keyword-pipeline` | `#9CB4E0` | 9.1 | `#2D4F8E` | 7.8 | bold |
| `--syntax-keyword-dml` | `#F08C7E` | 8.0 | `#B3392A` | 5.8 | bold |
| `--syntax-keyword-operator` | `#A7B3C8` | 9.0 | `#4F5D75` | 6.5 | |
| `--syntax-keyword-control` | `#D6A2E8` | 9.3 | `#8A3FA8` | 6.1 | italic |
| `--syntax-type` | `#63D7C4` | 10.9 | `#0F7A6B` | 5.1 | |
| `--syntax-constant` | `#E9B97A` | 10.6 | `#9A5B00` | 5.3 | |
| `--syntax-builtin` | `#7BD8B0` | 11.2 | `#11795A` | 5.2 | |
| `--syntax-sigil-record` | `#49C2FF` | 9.5 | `#0069B8` | 5.5 | |
| `--syntax-sigil-field` | `#FFC94A` | 12.4 | `#A15C00` | 5.1 | bold |
| `--syntax-sigil-parent` | `#FF6E8E` | 7.1 | `#C2185B` | 5.7 | bold |
| `--syntax-sigil-alias` | `#B18CFF` | 7.3 | `#6B3FD4` | 6.2 | |
| `--syntax-function` | `#C6E07A` | 13.0 | `#4D7A00` | 5.0 | |
| `--syntax-sigil-key` | `#FF8F40` | 8.4 | `#B84A00` | 5.1 | bold |
| `--syntax-sigil-index` | `#FF8F40` | 8.4 | `#B84A00` | 5.1 | |
| `--syntax-member` | `#D7DEEA` | 14.1 | `#2A3342` | 12.4 | |
| `--syntax-identifier` | `#E6E9EF` | 15.7 | `#161A21` | 17.0 | |
| `--syntax-string` | `#9CCB7F` | 10.2 | `#2E7D32` | 5.0 | |
| `--syntax-number` | `#E9B97A` | 10.6 | `#9A5B00` | 5.3 | |
| `--syntax-comment` | `#7A8597` | 5.1 | `#6A7383` | 4.7 | italic |
| `--syntax-operator` | `#A7B3C8` | 9.0 | `#4F5D75` | 6.5 | |
| `--syntax-delimiter` | `#8A94A6` | 6.2 | `#5F6878` | 5.5 | |
| `--syntax-invalid` | `#FF6E6E` | 7.0 | `#C62828` | 5.5 | wavy underline |

Rules:
- In `.customer.name`, `.customer` uses `--syntax-sigil-record` and `.name` uses `--syntax-member`. In `^.room_id`, `^` uses parent and `.room_id` uses member.
- The five sigils differ in hue **and** in lightness and weight, so they stay apart with color-blindness.
- **Pushdown decoration** (Monaco `.minab-pushdown`, and static code): a 2 px underline in `--pushdown`, offset 5 px, plus `--glow-pushdown` in dark.

### Type (board 04)

- `--font-sans` and `--font-display`: **Geist** (400, 500, 600, 700). Display is Geist 600 with −0.03em tracking.
- `--font-mono`: **JetBrains Mono** (400, 500, 700, italic 400), with `font-variant-ligatures: none` everywhere, so `!=`, `<=` and `=>` show as typed.
- Fonts are self-hosted in `public/fonts/` (W2), or loaded from Google Fonts.
- Scale: `--text-xs` 0.75rem · `--text-sm` 0.8125rem · `--text-md` 0.9375rem · `--text-lg` 1.125rem · `--text-xl` 1.375rem · `--text-2xl` 1.75rem · `--text-3xl` 2.25rem · `--text-4xl` **3.25rem** (was 3rem).
- Leading: tight **1.15** (was 1.2) · normal 1.5 · relaxed 1.65. Weights 400/500/600/700. `--tracking-tight` **−0.02em**.
- Editor: 14 px, 22 px line height (unchanged).

### Space, radius, depth, motion (board 04)

- Space: the 4 px grid is unchanged (`--space-1…16`).
- Radius: sm 4 (badges, kbd) · md 6 (buttons, inputs) · lg 10 (panels, callouts) · xl **14** (cards; was 16) · full 999.
- Shadows, dark: sm `0 1px 2px rgb(0 0 0/.40)` · md `0 4px 14px rgb(0 0 0/.45)` · lg `0 14px 36px rgb(0 0 0/.55)` · overlay `0 24px 56px rgb(0 0 0/.60)`, plus an inset 1 px top hairline `rgb(255 255 255/.04)`. Light keeps today's values. In dark, depth comes from borders first and shadows second.
- Motion: the values are unchanged (fast 120 ms, normal 200 ms, slow 360 ms; standard and emphasized easing). `--ease-emphasized` is used only for the verdict. Under reduced motion, every duration is 0 and glows do not pulse. The full motion spec comes in round 3.

### Core components (board 05)

Both themes. Focus everywhere: a 2 px `--focus-ring` outline, offset 2 px.

- **Button:** primary / secondary / ghost / danger × sm 28 px / md 36 px / lg 44 px.
  - Radius md, Geist 500.
  - Primary: `--accent` fill, `--accent-contrast` label, and a soft accent glow in dark.
  - Secondary: `--surface-raised` with `--border-default`. Ghost: transparent. Danger: `--danger-soft` fill with a `--danger` border and label.
  - States: hover (`--accent-hover` or `--surface-hover`), focus, disabled (45% opacity, no glow), busy (a 12 px spinner before the label, `aria-busy`).
- **IconButton:** 32 px, radius md, `--text-secondary`. Hover: `--surface-hover`. Pressed: `--accent-soft` fill, `--accent` icon and border, `aria-pressed`. Icons are 16 px line icons, 1.8 stroke.
- **Badge:** JetBrains Mono 11.5 px, radius sm, 1 px border in the tone color on the `-soft` fill.
  - Tones: neutral, accent, success, danger, warning, pushdown, check-only.
  - **check-only uses a dashed border**, so it is not shown by color alone. Success and danger badges carry ✓ or ✕; pushdown carries ⇣.
- **Tabs:**
  - Selected: `--surface-selected`, a 2 px `--accent` bottom border, weight 600. Hover: `--surface-hover`.
  - Count badges: Result is neutral, Execution is pushdown, **Console** is neutral, Problems is danger.
- **Kbd:** mono 12 px, a 2 px bottom border, `--surface-raised`.
- **Toggle:** 34×20 track. On: `--accent` track with an `--accent-contrast` knob. Off: `--border-default` track. Focus ring on the track.
- **Callout:** radius lg, a 1 px tone border, the `-soft` fill, an icon (ⓘ ✓ ! ✕ ◇ ⇣), a bold title, then secondary text. Tones: info, success, warning, danger, **check-only (dashed border)**, pushdown.
- **EmptyState:** a dashed `--border-default` box on `--bg-surface`. A big glyph in its sigil color (`.` for "nothing run yet"), a title, one line, an optional action.
- **Toast:** glass (`--surface-overlay` + `--overlay-blur`), `--border-strong` (`--danger` for errors), `--shadow-overlay`, radius lg, a leading tone icon.
- **CodeBlock:**
  - Caption bar on `--surface-sunken` (title on the left; Wrap and Copy IconButtons, 28 px, on the right).
  - The body on `--editor-bg`, mono 13 px / 21 px, horizontal scroll unless wrap is on.

### Copy decided in round 1

- **The name line** (landing, above the footer credit; the exact wording is checked in round 2): "Named for Minab, a city in southern Iran — in memory of the 168 children and their teachers who were killed when their school was bombed." It is plain `--text-secondary` text: no icon, no wit, no motion near it.
- The footer credit links "Hamed Zakery Miab" to `https://hamcker.github.io`.

---

## Round 2 · The app (approved 2026-10-03)

Canvas page "Round 2 · The app", boards 06–11. Every board shows dark and light.

### Shared shell

- **Top bar** (`AppShell`): 52–56 px on `--bg-surface` with a `--border-subtle` bottom line.
  - Left: the lockup (mark B, then `.minab`).
  - Nav: Playground · Tour · Examples · Reference. The active item uses `--surface-selected` and weight 600, with `aria-current="page"`.
  - Right: a Search button (200–220 px wide, "Search" with a `⌘K` kbd), the theme IconButton, and the GitHub IconButton.
- **Mobile top bar:** the lockup, then Search and Menu IconButtons. Tap targets are 44 px.
- **Background texture:** the hero and the CtaBand carry a faint 32 px (24 px in the CtaBand) grid of `--grid-line` lines. This is a new token: dark `rgb(73 194 255 / .05)`, light `rgb(10 108 194 / .05)`. Nothing else has a texture.

### Landing (`/`, boards 06–08)

1. **Hero:** two columns, 5fr | 6fr, 64 px gap, padding 88/80.
   - Eyebrow in `--accent`, uppercase, 0.1em tracking.
   - H1 at 60 px, weight 600, −0.035em tracking, leading 1.04. Mobile: 38 px.
   - Subhead at 19 px in `--text-secondary`.
   - CTAs: primary "Open the playground" (play icon) and secondary "Take the tour · 10 min". Both lg; on mobile they are full width, 48 px tall.
   - A muted note with a database icon.
2. **HeroDemo:** a card with `--shadow-lg` and a tab bar on `--surface-sunken` (Query · Rule · Types), plus a "Postgres ready" dot on the right.
   - Under the tabs: a caption, the code (with gutter) on `--editor-bg`, the "Compiled to" SQL block on `--surface-sunken` (SQL keywords in `--syntax-keyword-pipeline`, params in `--syntax-sigil-field`), and the RowsTable.
   - The footer meta "5 rows · 1 statement · 3.4 ms" and "Open in the playground →".
   - **Rule:** the code with the pushdown underline, a Passes verdict, and "⇣ The one statement that reached Postgres" with the SQL.
   - **Types:** a wavy `--danger` underline under `.status == 5`, an error callout with the code `type.implicitCoercion · line 2, col 7`, and "Nothing was sent to the database."
   - **Loading:** the program shows as static code; a spinner with "Starting PostgreSQL in your browser…", a progress bar, "About 3.5 MB, once. Later runs are instant.", and shimmer lines.
   - Switching tabs cross-fades the body in `--duration-normal`. The card height animates, so the page does not jump.
   - Mobile: the Rule tab is shown first, because the verdict is the clearest result on a small screen.
3. **LayerCards:** two cards, Query and Validate. Each has an h3, a badge (pipeline / record rule), one line, a code block and "Run it →".
4. **SigilGrid:** 5 cards on `--editor-bg`, each with a 76 px glyph (44 px on mobile) in its sigil color. In dark, the glyph carries `text-shadow: 0 0 28px currentColor`; in light, nothing. The section sits on `--bg-surface`. Mobile: a 2-column grid.
5. **HowItRuns:** 4 numbered step cards (`01`–`04` in mono `--accent`) joined by → arrows. Below them, a dashed diagram:
   - the rule's code;
   - two branches: "In memory" (neutral) and "⇣ Pushed down" (`--pushdown-soft` with a `--pushdown` border);
   - the one SQL statement, with "returned false → Passes ✓".
   - Mobile: a numbered list; no diagram.
6. **Comparison:** Minab (left) → PostgreSQL (right, 1.25 times as wide). Both have a caption bar; the SQL caption says "compiled live — the same text `minab compile` prints". On mobile it stacks with ↓.
7. **FeatureGrid:** 3 × 2. A 36 px `--accent-soft` icon tile, a title and one line each. Mobile: a plain list.
8. **CtaBand:** a bordered card with the grid texture; title and body left, the two lg buttons right. Mobile: stacked and full width.
9. **The name:** its own band above the footer: centered, at most 680 px wide, 15 px, `--text-secondary`. The wording is approved as written in round 1. No icon, no motion.
10. **Footer:** the small mark (no middle petal), "Minab — designed and built by Hamed Zakery Miab" (the name links to the portfolio), then the nav (GitHub · Language spec · VS Code extension), then the "Built with…" note in muted text. Mobile: stacked, links 44 px tall.

### Workbench (`/play`, board 09)

1440×900, a full-height app.

- **Toolbar** (48 px, `--bg-surface`):
  - Left: the ExamplePicker (a secondary button, at least 230 px, with a chevron), the `§6.1` badge and the Reset IconButton.
  - Right: the EngineStatusPill, the Auto-run toggle, a divider, IconButtons (Cheat sheet, Download for the CLI, Copy embed code), Share (secondary), and Run (primary, with a play icon and `⌘↵`).
- **EngineStatusPill:** a pill with a 1 px border. "Postgres ready" has a `--success` dot with a soft glow. The other states come in round 3.
- **Layout:** the left column is 784 px (55%) and the output 45%. The separators are 9 px hit areas with a 1 px line and a 5×28 px `--border-strong` grip. Editor/host is 62/38.
- **Editor:** the gutter is 30 px, and the current line uses `--editor-line-highlight`.
  - Pushdown spans are underlined.
  - **While a TraceItem is hovered, its span gets `--pushdown-soft` behind it, plus a 1 px `--pushdown` ring and a soft lime glow in dark (`--glow-pd`).** This is the showcase effect.
- **EditorStatusBar** (28 px, `--surface-sunken`): "Record rule → BOOLEAN" (the type in `--syntax-type`) on the left; the "✓ No problems" button in `--success` on the right.
- **HostPanel:** tabs with a sigil badge on Record (`.`) and on Field (`$`), and a collapse IconButton on the right.
  - Record tab: a "Rule table" select (mono), a Form/JSON segmented control, PresetChips (pills, ✓/✕ marks in the pass/fail colors, active = `--accent-soft` with an `--accent` border and `aria-pressed`), the preset's note in muted text, then a 2-column form with mono labels (110 px) and mono inputs on `--editor-bg`.
- **OutputPanel tabs:** Result · SQL · Execution (pushdown badge) · Console · Problems · AST.
- **Execution tab:**
  - a summary callout ("⇣ 1 statement reached Postgres; …");
  - mono timings;
  - **TraceItem**: a "Statement 1" pushdown badge with "1 row · 2.1 ms"; "from" plus the Minab span as a button (pushdown-soft, mono, highlighted) and its line range; the formatted SQL on `--editor-bg`; the params table (`$n` in field color, value, muted type); "returned `false`".
  - When hovered, the TraceItem gets a `--pushdown` border, the `--surface-hover` fill and the glow.
  - The legend has a lime underline swatch.
- **Result tab, verdict:** a large VerdictCard: a 44 px round icon (✓ or ✕) on the verdict color, the word "Passes" or "Fails" at 30 px in the verdict color, the sentence, and the "1 statement reached the database — see how →" link. Footer meta: "verdict · 1 statement · 2.1 ms".
  - The Fails variant follows the "Overlaps bkg-12" preset. Its dates are 2026-10-04 → 2026-10-07. Its note is "bkg-12 holds room 7 from Oct 6 to Oct 8 — this one runs into it."

### Output states (board 10)

All at 620 px wide.

- **Result:**
  - Nothing run (`.` glyph, Run).
  - Running (spinner), with the stale variant: the old rows at 45% opacity and a dashed warning badge "edited since this run".
  - Rows: index column, `DECIMAL` with trailing zeros, `null` in muted italic, JSON wrapping in `--text-secondary`.
  - No rows (∅).
  - Passes, and Fails "answered entirely from the record".
  - Field verdict: the word is **"Rejected"**, with "The value `-5` is rejected for Order."
  - Value: `24.90` at 34 px in number color, with a "DECIMAL · exact" badge.
  - Problems first: a danger-bordered empty state with "Show problems".
  - Check-only callout (dashed), with the evaluator's words in muted mono.
  - Database error: a callout with the SQL.
- **SQL:** the compiles view (the explanation, the SQL with a Copy button in the top right, the params table) and the no-single-statement view (a pushdown callout, then "What the last run sent:" with statement badges, then the link).
- **Execution:** 0 statements (glyph `0` in pushdown color, with a hint to try "Free slot"), and nothing ran.
- **Console (new):**
  - Rows: label (muted, 90 px), value (type-colored mono), `line:col` (muted).
  - The selected row: `--surface-hover` with a 2 px `--accent` inset on the left.
  - Meta: "3 lines, in evaluation order". Empty: `LOG()` glyph, "No log lines", one line of help.
- **Problems:** button rows (✕ icon, the message, then the **error code** on its own line in muted mono, `line:col` on the right). The hovered row uses `--surface-hover`. Empty: a success-bordered "No problems".
- **AST:** mono, 26 px rows, ▾/▸ toggles, muted `feature:` labels, values in syntax colors, inferred-type badges (outlined in `--syntax-type`) on the right. The hovered row uses `--highlight-soft` with a `--warning` outline.

### Host panel (board 11)

All at 780×340.

- **Schema:**
  - Header: the title, an "edited" dashed badge, a one-line description with an ellipsis, then Edit as JSON and Reset.
  - The note line.
  - A 4-column grid of table cards (mono 11.5 px): name and row count in the header on `--surface-sunken`; columns as name | type, where types use `--syntax-type` and relations use `--syntax-sigil-alias` (`→ Customer`, `⇉ Order[]`), and 🔑 marks the key. Small tables collapse to a header-only card.
  - JSON mode: Show tables plus Apply schema (primary), and a JSON editor.
- **Data:**
  - Table chips (overflow "+4"), the SQL console toggle (pressed = accent-soft), and Reset data.
  - Rows on the left, the console on the right: an editor with an `--accent` focus border, "⌘↵ runs", Run SQL, and the result table.
- **Record:**
  - Not a rule: an empty state with the `.` glyph and an example rule.
  - JSON toggle: the presets stay above, the JSON editor below, then the related-rows footnote.
- **Field:** "Type of `$`" with a DECIMAL select, presets 500 ✓ · 950 ✕ · −5 ✕ (active), "Fails locally — the database is never asked.", and a labelled value input.
- **Collapsed host panel:** one 36 px bar, "Host — schema, data, record ›".
