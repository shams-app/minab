# From wireframe to finished showcase: the guide

The playground already **works end to end**. What's left is its look. This guide takes you from the wireframe to a designed, deployed and promoted site, using **Claude Design** for the design and **Claude Code** for wiring it in.

| File | What it's for |
|---|---|
| [`brief.md`](brief.md) | Audiences, goals, messages, tone, brand directions, open items |
| [`flows.md`](flows.md) | Every user journey, step by step, with the states it passes through |
| [`screens.md`](screens.md) | Every screen, region and state, the checklist a design must cover |
| [`contract.md`](contract.md) | The seam: design tokens, the component inventory and props, and what may and may not change |
| [`design-briefs.md`](design-briefs.md) | What each screen must show (briefs 0–14), used by the W1 session inside Claude Design, plus the wiring rules for W2 and W3 (brief 15). **You do not paste these.** |
| `handoff.md` | Written by W1: the Claude Design canvas link and every approved decision. W2 and W3 build from it. |
| [`launch-kit.md`](launch-kit.md) | Demo storyboard, screenshot list, case-study outline, launch posts |

> **Short version for the owner:** paste the W1 prompt from [`docs/production/phases/prompts.md`](../../docs/production/phases/prompts.md) into **Claude Code** (claude.ai/code, or the Code tab in the Claude desktop app). The session asks you 4 questions, builds the designs in Claude Design, and sends you links to review. That is all. The steps below say what the session does.

> Claude Design is a fast-moving product (beta since June 2026). Today it is a **Design** template you can start from any Claude chat (Output → Design), from the Artifacts tab, or from Claude Code. The separate page claude.ai/design still exists but has its own setting and is **not needed** here. If a label differs, look for the equivalent.

---

## Step A — Look at the app (the session does this)

The W1 session can run the app to check details:

```bash
npm ci                      # at the repository root, once: the playground builds the parser from ../src
cd playground && npm ci
npm run dev                 # http://localhost:5173
```

It may take screenshots with the pre-installed Chromium for its own reference. They stay in its scratchpad, not in the repository. The owner does not take or upload screenshots.

The owner's choices (brand direction, name story, domain, portfolio URL) are in decision D40. The W1 session asks only the ones that are still open.

---

## Step B — Create the canvas (the session does this)

The session creates **one** Claude Design canvas, "Minab Playground", with its Artifact tool (the **Design** type). It puts brief 0, the context primer, in first. It links no repository and runs no `/design-sync`: the briefs already carry every token and component name. (`/design-sync` becomes useful after W2, see Step G.)

**Fallback**, only if the session says it cannot create a canvas: open claude.ai (browser or desktop app), start a new chat, and choose **Output → Design** in the message box (or the Artifacts tab → **Design** template). Paste the one text the session gives you. Then paste the design's link back into the Claude Code chat.

---

## Step C — Design in four rounds (2–5 hours, spread out)

The session adds the briefs from [`design-briefs.md`](design-briefs.md) to the canvas, one round at a time. After each round it sends you the link and waits for your "approved" or your changes.

| Round | Briefs | Produces | Tip for your review |
|---|---|---|---|
| 1 | 0, 1 | Brand and design system | Spend the most time here; everything inherits from it |
| 2 | 2–5 | Landing, workbench, output states, host panel | Pick one of the three hero variations. The Execution tab is the showcase moment |
| 3 | 6–13 | Tour, gallery, reference, embed, mobile, overlays, icons, motion | Check the OG image at thumbnail size, and tap targets on mobile |
| 4 | 14 | Final audit, then `handoff.md` | Anything it reports is fixed before you approve |

**Good review habits:**
- **Be specific:** "tighten the spacing between form fields", not "this doesn't look right".
- **Ask for variations** when unsure: "show three alternatives".
- **Ask for states:** empty, loading, error, stale, narrow.
- **Say why** ("we chose X because…"). The session writes it into `handoff.md`, and W2 and W3 make the same calls.

---

## Step D — Iterate

Three ways to give feedback, in order of scope:
1. **The Claude Code chat** for broad changes: "make the dark theme warmer". This is the main way.
2. **Comments on the canvas** for targeted fixes: "this badge needs more contrast". Tell the session you left comments; it reads them.
3. **Direct edits on the canvas** (drag, resize, align) for nudges. Tell the session, so it records them.

---

## Step E — Hand off to Claude Code (the session does this)

At the end of each approved round, the W1 session writes `handoff.md`: the canvas link at the top, then the approved layout, tokens (names and values, both themes), component states, copy, keyboard behavior and motion. It commits and pushes after each round.

W2 and W3 read `handoff.md` and the canvas, and follow **brief 15** (the wiring rules) in `design-briefs.md`. There is no bundle to export or attach.

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
