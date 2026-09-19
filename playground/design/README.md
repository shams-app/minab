# From wireframe to finished showcase: the guide

The playground already **works end to end**. What's left is its look. This guide takes you from the wireframe to a designed, deployed and promoted site, using **Claude Design** for the design and **Claude Code** for wiring it in.

| File | What it's for |
|---|---|
| [`brief.md`](brief.md) | Audiences, goals, messages, tone, brand directions, open items |
| [`flows.md`](flows.md) | Every user journey, step by step, with the states it passes through |
| [`screens.md`](screens.md) | Every screen, region and state, the checklist a design must cover |
| [`contract.md`](contract.md) | The seam: design tokens, the component inventory and props, and what may and may not change |
| [`prompts.md`](prompts.md) | Ready-to-paste Claude Design prompts (0–14), plus the Claude Code wiring prompt (15) |
| [`launch-kit.md`](launch-kit.md) | Demo storyboard, screenshot list, case-study outline, launch posts |

> Claude Design is a fast-moving product (a research preview in April 2026, beta since June 2026). Button labels and commands below were current when this was written. If a label differs, look for the equivalent.

---

## Step A — See what you're designing (15 min)

```bash
cd playground
npm install
npm run dev          # http://localhost:5173
```

The first run generates the Minab parser in the repository root, which needs `npm install` at the root once.

Walk through `flows.md` in the running app:
1. landing → playground;
2. `booking-overlap` → click the presets → open Execution and hover the statement;
3. break a query to see the Problems tab;
4. do tour lessons 1, 6 and 7;
5. share a link;
6. try `/embed?example=credit-limit`.

Screenshot the key states at 1440 px and 375 px, in light and dark. The top-bar icon toggles the theme. These screenshots are useful context to upload to Claude Design.

**Decide before designing:** the brand direction (`brief.md`, A/B/C) and the open items in the brief (the story behind the name, domain, portfolio URL).

---

## Step B — Set up the Claude Design project (10 min)

1. Open **claude.ai/design**. It needs a Pro, Max, Team or Enterprise plan; on Enterprise, an admin enables it under Organization settings → Artifacts. Create a new project, e.g. "Minab Playground".
2. **Give it the codebase**, so it designs with the real component names. Either:
   - **Link the GitHub repo** (`shams-app/minab`) when creating or setting up the design system. It reads `playground/src/ui/**` and `playground/src/styles/tokens.css`; or
   - from this repo, in Claude Code, run **`/design-sync`**. It pushes the local component library into a Claude Design design-system project and keeps it in sync incrementally.
3. **Upload context files:**
   - `design/brief.md`
   - `design/screens.md`
   - `design/contract.md`
   - the screenshots from Step A
4. If your organization has a design system set up, the project inherits it. For Minab you're creating a new one, which is what prompt 1 does.

---

## Step C — Design, prompt by prompt (2–5 hours, spread out)

Open [`prompts.md`](prompts.md) and paste the prompts **one per message, in order**:

| # | Produces | Tip |
|---|---|---|
| 0 | Shared understanding | Answer its questions before continuing |
| 1 | Brand + design system | Spend the most time here; everything inherits from it |
| 2 | Landing | Ask for the three hero variations, pick one |
| 3 | Workbench | The Execution tab is the showcase moment, so push it |
| 4 | Output states sheet | Check every state is there |
| 5 | Host panel | |
| 6 | Tour | Include the celebration moment |
| 7 | Gallery | |
| 8 | Reference + drawer | |
| 9 | Embed | Judge it inside a mock blog post |
| 10 | Mobile pass | Tap targets ≥ 44 px |
| 11 | Overlays, toasts, 404, errors, hover and completion | |
| 12 | OG image + icons | Check legibility at thumbnail size |
| 13 | Motion spec | |
| 14 | Final audit | Fix anything it reports before handoff |

**Prompting habits that work well with Claude Design:**
- **State the goal, layout, content and audience.** The prompts already do this. Add your own taste on top ("more whitespace", "less rounded").
- **Ask for variations** when unsure: "show three alternatives: A…, B…, C…".
- **Ask for states explicitly:** empty, loading, error, stale, narrow. Designs that skip them are what makes an implementation look unfinished.
- **Keep names stable.** If it invents new component names, ask it to use the names from the primer. They carry through the handoff.
- **Write down reasoning in the chat** ("we chose X because…"). It travels with the handoff and helps Claude Code make the same calls.

---

## Step D — Iterate

Three ways to refine, in order of scope:
1. **Chat** for broad changes: "make the dark theme warmer", "tighten vertical rhythm on the landing".
2. **Inline comments** on a canvas element for targeted fixes: "this badge needs more contrast", "align this with the editor gutter".
3. **Direct edits on the canvas** (drag, resize, align) for nudges.

Before moving on, re-run **prompt 14 (final audit)**. Contrast and missing states are the usual gaps.

---

## Step E — Hand off to Claude Code

1. In Claude Design: **Export → Handoff to Claude Code** (or "Send to Claude Code" for the web version). The bundle contains the component structure as a machine-readable spec, the tokens used, the layout hierarchy, and the assets.
2. In Claude Code, in this repository, on a new branch:
   ```bash
   git checkout -b playground-design
   ```
3. Give Claude Code the bundle together with **prompt 15** from `prompts.md` (the wiring prompt). It tells Claude Code exactly what to change (tokens, `src/ui/**`, styles, icons, assets) and what never to touch (engine, state, hooks, content).
4. Let it plan first, review the plan, then let it implement.

---

## Step F — Verify

```bash
cd playground
npm test          # 126+ tests: engine, every example, every lesson, tokenizer, share links
npm run build     # type-checks and bundles
npm run preview   # the production build, locally
```

**Visual checklist.** For each page, check light and dark at 1440 px and 375 px.

**Landing:**
- [ ] Hero demo: Query, Rule and Types tabs, plus the loading state.
- [ ] Comparison SQL appears, compiled live.

**Workbench:**
- [ ] Rows, verdict pass and fail, value, problems, check-only (`overdue-loop`), and a database error (try `FROM Order SELECT .nope`).
- [ ] Execution: 1 statement (`booking-overlap`), 0 statements (preset "Ends before it starts"), and hover highlights the editor span.
- [ ] Editor: syntax colors, squiggles, the hover card on `.total`, completion after `.customer.`, and pushdown underlines.
- [ ] Host: Schema cards and JSON, Data plus the SQL console and reset, Record presets and form, Field presets.

**Tour:**
- [ ] Goal open, then met, then the celebration.
- [ ] Hints, solution, and the mobile layout.

**Other pages:**
- [ ] Gallery: filters, the empty state, and card hover.
- [ ] Reference: search and the drawer.
- [ ] Embed: in an iframe, `?tabs=`, `?theme=dark`, `?readonly=1`.
- [ ] Palette (⌘K), toasts, the 404, and engine restart.

**Accessibility:**
- [ ] Keyboard-only walkthrough; focus is always visible.
- [ ] Contrast checked; reduced motion respected.

**Lighthouse** (Chrome DevTools, on `npm run preview`):
- [ ] Performance ≥ 90 on the landing page.
- [ ] Accessibility ≥ 95 everywhere.

---

## Step G (optional) — Keep design and code in sync

After implementing, run **`/design-sync`** in Claude Code to push the finished component library back into the Claude Design project. Future design rounds then start from the real, implemented components, and you can bring changes back the same way.

---

## Step H — Deploy

The playground is a static site with no server. Build it with `npm run build`. The output goes to `playground/dist/`, and it includes a `404.html` copy for SPA deep links.

| Host | Settings |
|---|---|
| **Vercel** | Root directory `playground`, build command `npm run build`, output `dist`. Add a rewrite of all paths to `/index.html` (`vercel.json`: `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`). The parent repository must also `npm install` (the build generates the parser from `../src`), so set the install command to `cd .. && npm ci && cd playground && npm ci`. |
| **Netlify** | Base directory `playground`, build `npm run build`, publish `dist`. Add `_redirects` with `/* /index.html 200`. Same install caveat as Vercel. |
| **GitHub Pages** | Build with `PLAYGROUND_BASE=/minab/ npm run build` (your repo name), then publish `dist/`. The copied `404.html` handles deep links. |
| **Your portfolio, under a path** | `PLAYGROUND_BASE=/projects/minab/ npm run build`, then serve `dist/` at that path with an SPA fallback. |

**Caching:** PGlite's `.wasm` and `.data` files are large and content-hashed. Serve them with `Cache-Control: public, max-age=31536000, immutable`, and let the host compress them (gzip or brotli).

---

## Step I — Put it on the portfolio

- Link **"Try Minab in your browser"** to the landing page, and **"Take the 10-minute tour"** to `/learn`.
- Embed a live example in the portfolio's project page:
  ```html
  <iframe src="https://YOUR-DOMAIN/embed?example=booking-overlap&tabs=result,execution,sql"
          title="Minab: a validation rule, live"
          style="width:100%;height:440px;border:0;border-radius:12px" loading="lazy"></iframe>
  ```
  Optionally, auto-size it:
  ```html
  <script>
    addEventListener('message', e => {
      if (e.data?.type === 'minab:resize')
        document.querySelector('iframe[src*="/embed"]').style.height = e.data.height + 'px';
    });
  </script>
  ```
- Then follow [`launch-kit.md`](launch-kit.md) for the video, screenshots and posts.
