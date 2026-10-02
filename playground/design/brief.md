# Product brief — the Minab Playground

## What it is

A website where anyone can write Minab, see it checked, see the SQL it compiles to, and run it against a real PostgreSQL. Postgres runs in the visitor's browser, compiled to WebAssembly. There's no server, no sign-up, and no install.

It is two things at once:

1. **A portfolio piece.** It shows that Hamed designed and built a programming language end to end: grammar, scoping, type system, compiler, hybrid interpreter, language server, CLI. It also shows he can present that work with care.
2. **The language's front door.** For Minab it plays the part the TypeScript playground plays for TypeScript, or the Rust playground for Rust: it's where people try the language first, and a link they send to each other.

## Audiences, in priority order

| Who | Arrives from | Has | Wants to leave knowing |
|---|---|---|---|
| **Hiring managers / recruiters** | Portfolio, LinkedIn, CV | 30–90 seconds, may not code | "This person built a real language, and it's polished." |
| **Engineers evaluating the work** | Portfolio, GitHub, HN | 3–10 minutes, will poke at it | "The design is thoughtful, the implementation is real, and the tooling works." |
| **Language nerds / PL folks** | HN, Reddit, Mastodon | As long as it stays interesting | The ideas: sigils for scope, one expression language for queries and rules, hybrid execution. |
| **Potential users** (data/backend devs) | Search, word of mouth | A concrete problem | "Could I write my validation rules in this?" |

## Goals

- **10 seconds:** understand what Minab is from the hero. That means one sentence, one live snippet, and a visible result.
- **30 seconds:** run something and change it, and see the result change.
- **3 minutes:** get the "aha", i.e. the execution map. A rule answers what it can in memory and sends only one indexed lookup to the database.
- **1 click:** share exactly what you're looking at, or embed it on another site.

## Positioning

**One-liner:** *Minab is a small language for querying relational data and validating the records you're about to save.*

Key messages, in order:

1. **One expression language, two layers.** The same `.`-based expressions work in a `FROM … WHERE … SELECT` pipeline and in a bare validation rule.
2. **Scope you can see.** The sigils `.`, `$`, `^`, `#` and `KEY` say which record an expression means, so there are no alias puzzles.
3. **Checked before it runs.** There's no implicit coercion, and errors point at the exact span.
4. **Hybrid execution.** A rule runs next to the record, and only the table-touching parts become SQL. You can watch this happen.
5. **Real tooling.** There's a language server, a VS Code extension, a CLI, and this playground.

What Minab is **not**, and the site shouldn't imply it is:
- It isn't an ORM or a database.
- It isn't production-hardened. It's at 0.1.0.
- Loops and writes aren't executed yet. The site labels them as check-only, honestly, everywhere.

## Tone

- **Precise and confident**, but not a sales pitch. Let the running code make the argument.
- Say plainly what's unfinished. "Checks today, runs later" is a strength when it's said clearly.
- Use short sentences and no buzzwords.
- Put a little wit in empty states and the 404. For example: `EXISTS(#Page[.path == $])` answered `false`.

## Brand direction: (B) "Terminal Noir" (chosen, D40)

The owner chose **B** at the A2 sitting (the brief had recommended A). Dark is the default theme, and a light theme is kept and designed with equal care. The three directions are kept below for reference; Claude Design gets only B.

**A. "Instrument" (not chosen; the first recommendation)**
- Calm, precise, editorial: warm off-white "paper" and near-black "ink", with one saturated accent.
- Typography does the work: a sharp grotesk for UI and an excellent monospace.
- The sigils are the brand. Each gets its own color, and those colors appear only in code, so the code becomes the illustration.
- Light and dark are designed with equal care.

**B. "Terminal Noir" (CHOSEN)**
- Dark-first and developer-tool native, with deep charcoal surfaces.
- The syntax palette glows; the chrome is subtle and glassy.
- Very "IDE". It's striking in screenshots, but less distinctive, because many tools look like this. To stand out, the sigil colors are the brand: they glow on charcoal, and they appear only in code.
- The light theme is the same system turned over: cool paper-white surfaces, the same sigil hues adjusted to pass contrast. It is not a different brand.

**C. "Blueprint" (not chosen)**
- Technical drawing: a cyan grid, thin lines, and annotation arrows linking source spans to the SQL they became.
- The execution map becomes the hero visual.
- The most memorable of the three, and the hardest to execute well.

### Wordmark idea

**`.minab`** has a leading dot, and that dot is Minab's current-record sigil. It's colored with `--syntax-sigil-record`. The wireframe already renders it this way (`Wordmark` in `src/ui/shell/AppShell.tsx`).

## Success signals

- People share links. Share links carry the program in the URL fragment, and nothing is tracked.
- Visitors reach the Execution tab.
- The tour gets finished. Progress is kept per browser.
- The GitHub repo gains stars and issues.
- An embed shows up on the portfolio and in one blog post.

## Constraints the design must respect

- **Heavy runtime.** Monaco (~870 KB gzipped) and PGlite (~3.5 MB gzipped WASM, plus its data file) load lazily, and never on the landing page's first paint. Design loading states for them. The first Postgres boot takes about 1–3 s.
- **Two themes.** Dark is the default (brand B). Light is kept. The OS preference may switch it, with a manual override.
- **Mobile.** Everything must work at 375 px. Below 760 px of workbench width, the workbench becomes tabs: Code · Result · Host.
- **Tokens only.** Every color and size is a design token (`src/styles/tokens.css`). The Monaco editor reads the tokens at runtime, so the editor theme comes free with the design.
- **Accessibility.** WCAG AA contrast (including every syntax color against the editor background), visible focus, reduced motion respected, and a verdict never shown by color alone.

## The name

Minab is the name of a city in Iran. A school there, with 168 children and a few teachers, was bombed by the enemy, and all of them were killed. The language is made to remember them.

How the site uses this:
- One short, quiet, factual line on the landing page (for example in the footer or a small "Why Minab" note). No decoration, no hero use, no mourning visuals, no motion.
- It must not read as marketing. The product tone stays precise and calm; this line is the only place that speaks about the loss.
- Claude Design should place it and set its tone; the owner approves the wording in the design round.

## Open items for Hamed (answered in W1, 2026-10-02)

- [x] **Name.** The story above.
- [x] **Domain.** `minab-lang.org` (D40).
- [x] **Portfolio URL.** `https://hamcker.github.com`, set in `src/content/landing.ts` → `footer.authorUrl`. (To check: GitHub Pages sites usually end in `.github.io`.)
- [x] **Social handles.** None. The launch posts name no handles.
- [x] **Brand direction.** B "Terminal Noir".
- [x] **Site languages.** English for 1.0, plus one Persian example program (D40). A full Persian site is post-1.0.
- [x] **Light theme.** Kept next to dark; dark is the default.
