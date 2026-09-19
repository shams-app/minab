# Launch kit

Everything here is a **draft for you to edit and publish yourself**. Nothing is posted automatically.

---

## 30-second demo video: storyboard

Record at 1440×900 with the designed site, in dark theme, with smooth cursor movement and no voice-over. Add captions as on-screen text.

| Time | Screen | Action | Caption |
|---|---|---|---|
| 0–3 s | Landing hero | The page loads; the demo shows top customers | **Minab** — a small language for querying and validating data |
| 3–7 s | Hero demo | Click **Rule**; "Passes" appears with the one SQL statement | One expression language for queries *and* validation rules |
| 7–11 s | `/play?example=booking-overlap` | Open **Execution**; hover the statement; the editor span lights up | Only the part that needs the database becomes SQL |
| 11–15 s | Same | Click the preset **Overlaps bkg-12**; the verdict flips to **Fails** | Real PostgreSQL, running in your browser |
| 15–20 s | Editor | Type `.status == 5`; a squiggle appears; hover it | Strict types — no implicit coercion |
| 20–25 s | Editor | Type `.customer.` and the completion list appears; pick `country` | A real language server: types, hovers, completion |
| 25–30 s | Tour | A lesson's goal turns green; cut to the wordmark and URL | Try it: **YOUR-DOMAIN** |

Export an MP4 (for LinkedIn and X) and a ≤ 8 MB GIF (for the GitHub README).

---

## Screenshot shot list

Take each at 2× (retina), in both themes where noted.

1. The landing hero with the demo on **Rule** (dark and light). This is the hero image for the portfolio.
2. The workbench with **Execution** open and a statement hovered: the "X-ray" shot.
3. A verdict **Passes / Fails** pair, side by side.
4. The editor with a type error squiggle and hover card.
5. Completion after `.customer.`.
6. The tour: a lesson with its goal met.
7. The gallery grid.
8. The embed inside a blog post mockup.
9. Mobile: the workbench on the **Result** tab, and the landing hero.

---

## Portfolio case study outline

**Title:** *Minab — designing and building a query & validation language*

1. **The problem.** Validation logic and queries live in different languages, and rule engines hide the SQL they run.
2. **The idea.** One expression language for both. Sigils make scope visible. Strict types.
3. **Language design.** Show the sigil table, the collection boundary (`COUNT` to reduce), and no implicit coercion. Explain the spec-first process: proposal → example review → approval → implementation. Mention the 12 open design questions still tracked in the spec.
4. **Implementation.** Langium grammar (LL(k)-checked) → scope resolution → validator and type checker → SQL compiler → **hybrid interpreter** (link ADR 0001). Close with 250+ tests.
5. **The hybrid execution strategy.** The highlight: the booking-overlap rule becomes *one* indexed `EXISTS`, not a table scan. Include the Execution-tab screenshot.
6. **Tooling.** Language server (hovers, go-to-definition), VS Code extension, CLI (`check` / `compile` / `run`), and the playground itself: the engine in a Web Worker plus PGlite.
7. **Designing the showcase.** The brief → Claude Design → handoff to Claude Code. The design contract that let the UI be redesigned without touching the engine.
8. **Numbers.** Phases shipped, test count, bundle sizes, time to first result.
9. **What's next.** Executing loops and writes, packaging, more editor features.
10. **Links.** The playground, GitHub, the spec.

---

## Launch posts: drafts

### Show HN

> **Show HN: Minab – a query and validation language that runs Postgres in your browser**
>
> I've been designing a small language, Minab, for two jobs that usually live in different places: querying relational data and validating records before they're saved. The same expressions work in a pipeline (`FROM Order WHERE .customer.country == "US" SELECT …`) and as a bare rule (`.end_date > .start_date AND NOT EXISTS(#Booking[…])`).
>
> Scope is written with sigils: `.` for the current row, `^` for one level up, `$` for the value being validated, `#Table` for a table opened inline. Types are strict, with no implicit coercion.
>
> The part I find most interesting is execution. Rules are evaluated next to the record the application already holds, and only the smallest table-touching subexpression is compiled to SQL. The booking-overlap rule above becomes a single parameterized `SELECT EXISTS`. The playground has an "Execution" tab that shows exactly which span of the source became which statement.
>
> Everything on the site runs client-side: the Langium-based toolchain in a Web Worker, and PGlite (Postgres in WASM) for the data. There's a 12-step tour and ~30 verified examples.
>
> It's 0.1 — loops and writes type-check but don't execute yet (the site says so). Feedback on the language design is very welcome.
>
> Playground: YOUR-DOMAIN · Code: https://github.com/shams-app/minab

### LinkedIn

> I designed and built a programming language. 🧪
>
> **Minab** is a small language for querying relational data *and* validating records, with one expression syntax for both. It type-checks before it runs anything, and compiles to PostgreSQL.
>
> The part I'm proudest of is **hybrid execution**. A validation rule runs next to the record, and only the piece that truly needs the database becomes SQL. The playground shows it live: hover a statement and the exact source span lights up.
>
> Everything runs in your browser, including a real PostgreSQL compiled to WebAssembly. Try the 10-minute tour: YOUR-DOMAIN
>
> Built with Langium, TypeScript, PGlite, Monaco and React. Designed with Claude Design.
>
> #programminglanguages #typescript #postgresql #webassembly

### X / Bluesky / Mastodon (thread)

1. I made a programming language: **Minab** — one small language for querying and validating relational data. Try it in your browser (real Postgres, in WASM): YOUR-DOMAIN 🧵
2. Scope is written with sigils. `.` is the current row, `^` is one level up, `$` is the value being validated, `#Booking` opens a table inline. No alias puzzles. [image: sigil grid]
3. Rules run next to the record. Only what needs the database becomes SQL — this rule is one `SELECT EXISTS`, not a scan. [GIF: execution map hover]
4. Strict types, no implicit coercion — mistakes are caught before anything runs. [image: squiggle + hover]
5. Langium grammar → type checker → SQL compiler → hybrid interpreter, with a language server and VS Code extension. Code: https://github.com/shams-app/minab

---

## Where to post

- Hacker News (Show HN), best on a weekday morning, US Eastern time.
- r/ProgrammingLanguages. Lead with the language design questions, not the product.
- r/PostgreSQL. Lead with "compiles to parameterized Postgres; PGlite playground".
- The Langium community (Discussions / Discord). Include "built with Langium 4".
- The PGlite / ElectricSQL community showcase.
- Lobste.rs (tags: `plt`, `databases`), if you have an invite.

---

## README additions for the repository

At the top of the root `README.md`, once deployed:

```markdown
**[Try Minab in your browser →](https://YOUR-DOMAIN)** — a live playground with a real PostgreSQL (WASM), a 10-minute tour, and ~30 runnable examples.
```

Add the demo GIF below it.
