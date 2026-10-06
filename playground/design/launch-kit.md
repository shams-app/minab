# Launch kit

Everything here is a **draft for you to edit and publish yourself**. Nothing is posted automatically.

Facts used in this kit (checked on 2026-10-06, Minab 0.3.0):

- Site: **https://minab-lang.org** (the Cloudflare steps of W4 must be done first). npm: `@shamsine/minab` (public, 0.3.0).
- The GitHub repository is **private** (D04). Do **not** link it in any post. Link the site and npm.
- The site runs in the browser: the Minab toolchain in a Web Worker, and a real PostgreSQL (PGlite, WebAssembly). The same runtime runs in a NestJS server.
- Claims you may make today: the playground, the tour (12 lessons), 32 verified examples, names in any language, exact `DECIMAL`, the `LOG` Console, the embeddable runtime (browser and NestJS), the VS Code extension, the security and performance notes (`docs/security.md`, `docs/performance.md`).
- Claims to **hold back until V4 and 1.0**: "production ready", "1.0", "stable API". Minab is 0.3.0: before 1.0 a release may break something.
- The one fact sheet to copy from: [`fact-sheet.md`](fact-sheet.md). The TV demo is in [`tv-demo.md`](tv-demo.md).

---

## 30-second demo video: storyboard

Record at 1440×900 (or 1920×1080) with the designed site, in the dark theme, with smooth cursor movement and no voice-over. Add captions as on-screen text. For the TV, use [`tv-demo.md`](tv-demo.md) instead.

| Time | Screen | Action | Caption |
|---|---|---|---|
| 0–3 s | Landing hero | The page loads; the demo shows top customers | **Minab**: a small language for querying and validating data |
| 3–7 s | Hero demo | Click **Rule**; "Passes" appears with the one SQL statement | One expression language for queries *and* validation rules |
| 7–11 s | `/play?example=booking-overlap` | Open **Execution**; hover the statement; the editor span lights up | Only the part that needs the database becomes SQL |
| 11–15 s | Same | Click the preset **Overlaps bkg-12**; the verdict flips to **Fails** | Real PostgreSQL, running in your browser |
| 15–19 s | Editor | Select all, type `0.1 + 0.2`; the result shows **DECIMAL · exact 0.3** | Exact decimals, for money |
| 19–23 s | `/play?example=persian-names` | The Persian table and fields run; the rows show in Persian | Names in any language: Persian, Turkish and more |
| 23–27 s | `/play?example=debug-with-log` | Open **Console**; the three `LOG` lines show | `LOG` shows the steps inside a program |
| 27–30 s | Wordmark and URL | Cut to the wordmark | Runs in your browser and in NestJS · **minab-lang.org** |

Open the example pages by clicking through **Examples** (not by typing the URL), so the bottom panel shows the right data (see the status file of W5, Later).

Export an MP4 (for LinkedIn and X) and a GIF of 8 MB or less (for the npm page and your site).

---

## Screenshot shot list

Take each at 2× (retina), in the dark and the light theme where noted. Take them from the live site. Keep the files **outside the repository** (they are large): a cloud folder is fine.

1. The landing hero with the demo on **Rule** (dark and light). This is the hero image for the portfolio.
2. The workbench with **Execution** open and a statement hovered: the "X-ray" shot (dark and light).
3. A verdict **Passes / Fails** pair, side by side.
4. The editor with a type-error squiggle and hover card (`Strict types, on purpose`).
5. Completion after `.customer.`.
6. The **Console** tab with the `LOG` lines (`Debug with LOG`).
7. **Persian names**: the editor and the result, with Persian text (dark and light).
8. **Exact decimals**: `0.1 + 0.2` with `DECIMAL · exact 0.3`.
9. The tour: a lesson with its goal met.
10. The gallery grid (32 programs).
11. The embed inside a blog post mockup.
12. Mobile: the workbench on the **Result** tab, and the landing hero.

---

## Portfolio case study

**Title:** *Minab: designing, building and shipping a query and validation language*

1. **The problem.** Validation logic and queries live in different languages, and rule engines hide the SQL they run.
2. **The idea.** One expression language for both. Sigils make scope visible. Strict types.
3. **Language design.** The sigil table, the collection boundary (`COUNT` to reduce), no implicit coercion. Names in any language (Persian, Turkish) and backtick names. Exact `DECIMAL` for money. Explain the spec-first process: proposal, example review, approval, implementation.
4. **Implementation.** A Langium grammar, scope resolution, a validator and type checker, a SQL compiler, and a **hybrid interpreter** (ADR 0001).
5. **The hybrid execution strategy.** The highlight: the booking-overlap rule becomes *one* indexed `EXISTS`, not a table scan. Include the Execution-tab screenshot.
6. **Correctness.** The interpreter and the compiled SQL are tested against each other on the same programs (the differential tests, C1 to C8). Say it as it is: *tested against each other*. Do not say "proved".
7. **One runtime, in two places.** The same runtime API runs in the browser (the playground, in a Web Worker with PGlite) and in a NestJS server. Mention the CommonJS build for Jest and NestJS, and the example apps.
8. **Security.** A program written by an end user is untrusted input (D01): the schema it was given is all it can read; every value is a SQL parameter; run limits stop a program that runs too long. Link the security notes (`docs/security.md`).
9. **Performance.** Nine budgets checked in CI (`docs/performance.md`). Numbers to quote: a typical rule is prepared in about **0.5 ms** (warm); a rule that needs no data runs in about **0.02 ms**; 100 rules re-run in about **5 ms** after one field changes (one frame is 16 ms); the browser worker is about **189 KB** gzip; 50 cached schemas use about **105 MB**. Quote them with the line "measured on Node 22, Linux".
10. **Tooling.** Language server (hovers, go-to-definition, completion), the VS Code extension, Monaco support for web apps, the CLI (`check`, `compile`, `run`), and the playground.
11. **Designing the showcase.** The brief, Claude Design, the handoff to Claude Code. The design contract that let the UI be redesigned without touching the engine.
12. **Numbers.** 2,600 or more tests (2,602 passing at 0.3.0), 32 verified examples, a 12-lesson tour, the budgets above. Update them before you publish.
13. **The name.** Use your words from D40. Minab is a city in southern Iran; the language is named in memory of the 168 children and their teachers who were killed when their school was bombed. This is the owner's text to approve (see the landing page).
14. **What's next.** Version 1.0, and the Shamsine integration.
15. **Links.** https://minab-lang.org, npm `@shamsine/minab`, the spec and the security notes on the site or in the package.

---

## Launch posts: drafts

Channels are from D40 (English for 1.0; the owner's portfolio is https://hamcker.github.io; no social handles). Replace anything in `[brackets]`.

### Show HN

> **Show HN: Minab – a query and validation language that runs Postgres in your browser**
>
> I've been designing a small language, Minab, for two jobs that usually live in different places: querying relational data and validating records before they're saved. The same expressions work in a pipeline (`FROM Order WHERE .customer.country == "US" SELECT …`) and as a bare rule (`.end_date > .start_date AND NOT EXISTS(#Booking[…])`).
>
> Scope is written with sigils: `.` for the current row, `^` for one level up, `$` for the value being validated, `#Table` for a table opened inline. Types are strict, with no implicit coercion. Money uses exact decimals (`0.1 + 0.2` is exactly `0.3`), and names can be in any language: the playground has an example with Persian table and field names.
>
> The part I find most interesting is execution. Rules are evaluated next to the record the application already holds, and only the smallest table-touching subexpression is compiled to SQL. The booking-overlap rule above becomes a single parameterized `SELECT EXISTS`. The playground has an "Execution" tab that shows which span of the source became which statement, and a "Console" tab for `LOG`.
>
> Everything on the site runs client-side: the toolchain in a Web Worker, and PGlite (Postgres in WASM) for the data. The same runtime also runs in a NestJS server (`npm i @shamsine/minab`). There's a 12-lesson tour and 32 verified examples.
>
> It's 0.3: before 1.0 things may still change, and I'd value feedback on the language design.
>
> Playground: https://minab-lang.org

### LinkedIn

> I designed and built a programming language. 🧪
>
> **Minab** is a small language for querying relational data *and* validating records, with one expression syntax for both. It type-checks before it runs anything, and compiles to PostgreSQL.
>
> The part I'm proudest of is **hybrid execution**. A validation rule runs next to the record, and only the piece that truly needs the database becomes SQL. The playground shows it live: hover a statement and the exact source span lights up.
>
> It handles money with exact decimals, accepts names in any language (try the Persian example), and runs in two places: in your browser, with a real PostgreSQL compiled to WebAssembly, and in a NestJS server.
>
> Try the 10-minute tour: https://minab-lang.org
>
> Built with Langium, TypeScript, PGlite, Monaco and React. Designed with Claude Design.
>
> #programminglanguages #typescript #postgresql #webassembly

### X / Bluesky / Mastodon (thread)

1. I made a programming language: **Minab**, one small language for querying and validating relational data. Try it in your browser (real Postgres, in WASM): https://minab-lang.org 🧵
2. Scope is written with sigils. `.` is the current row, `^` is one level up, `$` is the value being validated, `#Booking` opens a table inline. No alias puzzles. [image: sigil grid]
3. Rules run next to the record. Only what needs the database becomes SQL: this rule is one `SELECT EXISTS`, not a scan. [GIF: execution map hover]
4. Strict types, no implicit coercion. Exact decimals for money: `0.1 + 0.2` is exactly `0.3`. [image: squiggle + hover]
5. Names in any language. This query has a Persian table and Persian fields. [image: Persian example]
6. The same runtime runs in the browser and in NestJS. npm: `@shamsine/minab`

### Persian (optional: for Persian-language channels)

These drafts are for the owner to check and edit. They are plain and short on purpose.

> **میناب** یک زبان کوچک برای پرس‌وجو و اعتبارسنجی داده‌های رابطه‌ای است: یک نحو برای هر دو کار. پیش از اجرا نوع‌ها را بررسی می‌کند و به PostgreSQL کامپایل می‌شود.
>
> نکتهٔ جالب، اجرای ترکیبی است: یک قانون اعتبارسنجی کنار رکورد اجرا می‌شود و فقط بخشی که واقعاً به پایگاه‌داده نیاز دارد به SQL تبدیل می‌شود. در زمین بازی می‌بینید که کدام بخش از کد، کدام دستور SQL شد.
>
> برای پول از اعداد اعشاری دقیق استفاده می‌کند، نام جدول و فیلد می‌تواند فارسی باشد، و همه‌چیز در مرورگر شما اجرا می‌شود، با یک PostgreSQL واقعی. همین زبان در سرور NestJS هم کار می‌کند.
>
> امتحان کنید: https://minab-lang.org

### What to say about the name

The owner decides if and where the name's story is told. The site has a line for it. Never write the story in a post without the owner's words (D40).

---

## Where to post

- Hacker News (Show HN), best on a weekday morning, US Eastern time.
- r/ProgrammingLanguages. Lead with the language design questions, not the product.
- r/PostgreSQL. Lead with "compiles to parameterized Postgres; PGlite playground".
- The Langium community (Discussions / Discord). Include "built with Langium 4".
- The PGlite / ElectricSQL community showcase.
- Lobste.rs (tags: `plt`, `databases`), if you have an invite.
- The owner's portfolio: https://hamcker.github.io (the case study above).

Timing: the TV appearance is **20 October 2026 on Channel 4**. Post after the show (the same day), when people can search for the name and find the site. Run the uptime check during launch week (see below).

---

## Uptime check

`.github/workflows/site-uptime.yml` runs every 10 minutes. It fetches the landing page and the PostgreSQL `.wasm` file from https://minab-lang.org and fails if either is down, so GitHub sends the owner a notification. The scheduled runs only check from `LAUNCH_START` (18 October) to `LAUNCH_END` (27 October); outside that window they finish at once. To extend it, change those dates in the workflow. To test it, run it by hand from the Actions tab.

---

## README additions

The repository README is a protected file (release phases only). When you publish a release, put this line at the top:

```markdown
**[Try Minab in your browser →](https://minab-lang.org)**: a live playground with a real PostgreSQL (WASM), a 10-minute tour, and 32 runnable examples.
```

Add the demo GIF below it.
