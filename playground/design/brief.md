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

The owner chose **(B) "Terminal Noir"** (decision D40). Directions (A) "Instrument" and (C) "Blueprint" were not chosen. Do not design them.

**B. "Terminal Noir"**
- Dark first, at home among developer tools. Surfaces are deep charcoal.
- The syntax palette glows. It is the brand: each sigil has its own hue, and those hues appear mostly in code, so the code becomes the illustration.
- The chrome is quiet and a little glassy: thin borders, soft blur on overlays, no loud gradients.
- The risk: many tools look like this. Make it distinct with the sigil colors, a careful monospace, and the execution map (the pushdown color) as the one signature effect.
- A light theme exists too, with the same structure and the same syntax hues tuned for a light editor. **Dark is the default.**

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
- **Two themes.** Dark is the default. Light follows the OS (`prefers-color-scheme: light`) or the manual toggle. Both meet the same contrast rules.
- **Mobile.** Everything must work at 375 px. Below 760 px of workbench width, the workbench becomes tabs: Code · Result · Host.
- **Tokens only.** Every color and size is a design token (`src/styles/tokens.css`). The Monaco editor reads the tokens at runtime, so the editor theme comes free with the design.
- **Accessibility.** WCAG AA contrast (including every syntax color against the editor background), visible focus, reduced motion respected, and a verdict never shown by color alone.

## The name

**Minab** is a city in southern Iran. A school there, with 168 students and a few teachers, was bombed, and all the children and their teachers were killed. The language carries the city's name to remember them.

Landing line (draft; the owner checks the wording in round 2):
*"Named for Minab, a city in southern Iran — in memory of the 168 children and their teachers who were killed when their school was bombed."*

Tone for this line: quiet and plain. No wit near it, no icon, no color effect. It sits in the footer area, not in the hero.

## Open items for Hamed (answered in D40)

- [x] **Name.** See "The name" above.
- [x] **Domain.** `minab-lang.org` (served at the root, so `PLAYGROUND_BASE` stays `/`).
- [x] **Portfolio URL.** `https://hamcker.github.io`, in `src/content/landing.ts` → `footer.authorUrl`.
- [x] **Social handles.** None.
- [x] **Brand direction.** (B) "Terminal Noir".
- [x] **Light theme.** Yes, next to the dark one. Dark is the default.
- [x] **Languages.** English for 1.0, plus one Persian example program (L3). A full Persian site comes after 1.0.
