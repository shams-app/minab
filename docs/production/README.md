# Minab — the road to production

**Start here.** This folder is the plan that takes Minab from "built, but not published" to a **production 1.0**: a language that runs inside Shamsine (in the browser and in a NestJS server), on a public website, and in editors — correct, safe, fast, documented and released by machine.

It replaces [`../release-future/phases-after-v0.2.0.md`](../release-future/phases-after-v0.2.0.md) (the 18-phase plan) and uses [`../release-future/remaining-after-v0.2.0.md`](../release-future/remaining-after-v0.2.0.md) as its inventory. Every item of that inventory has a home here (see the coverage map in [`phases/README.md`](phases/README.md#coverage-map)).

The plan is written for AI sessions (Claude Code). Every phase is a **card** with exact inputs, steps, files, tests and a "done when" check, and a **ready-to-paste prompt**. Many phases can run at the same time, and their pull requests can be merged in any order.

## Files in this folder

| File | What it is | Who edits it |
|---|---|---|
| `README.md` (this file) | How the plan works and the rules every phase follows | Owner only |
| [`decisions.md`](decisions.md) | Every open decision (D01–D45), each with options, a recommendation and an example | Phase A2 (the decision sitting); a phase may add an answer to one decision it had to ask |
| [`phases/README.md`](phases/README.md) | The phase list with Depends (the source for the graph), lanes, release trains, old → new mapping, coverage map | Owner only |
| `phases/<ID>.md` | One card per phase | Owner only (A2 may adjust cards to match answers) |
| [`phases/prompts.md`](phases/prompts.md) | Copy-and-paste prompt for every phase, plus helper prompts | Owner only |
| `status/<ID>.md` | Written by the session that did phase `<ID>`, at its end. One file per phase ([format](#status-file-format)) | Only that phase's session (and the owner) |
| [`progress.md`](progress.md) | The progress page: graph, ready list, waves, open questions, "later" items. **Generated** — never edit by hand | The `plan-progress.yml` workflow, after each merge to `main` |
| [`tools/progress.mjs`](tools/progress.mjs) | Builds `progress.md` from the phase list and the status files | Owner only |

## What "production level" means

Minab 1.0 is production ready when all of these are true. Phase **V4** checks them one by one.

1. **Correct.** The interpreter and the compiled SQL give the same answer (a differential test proves it). No known wrong-answer bug. `check` never rejects a valid program and never accepts one that compiles to SQL the database rejects.
2. **Complete.** Every construct the grammar accepts runs, or it was removed from the language on purpose.
3. **Embeddable.** One runtime API, used by the CLI, the playground, a NestJS app and a browser app. Documented, with a compatibility policy.
4. **Safe.** A program written by an end user cannot run forever, cannot crash the host, cannot inject SQL, cannot read outside the schema it was given, and does not leak data into logs. There is a security policy and a way to report problems.
5. **Fast enough.** Budgets for check time, run time, bundle size and memory, checked in CI.
6. **Ready for Shamsine.** Unicode and quoted names (Persian, Arabic, Turkish field names), exact decimals for money, stable error codes so messages can be translated, analysis that says if a program runs in the browser or needs the server, Monaco support, and a CommonJS build for Jest and NestJS.
7. **Stable.** From 1.0 on (before 1.0 anything may break, D38): semantic versioning, a language version stored with every program, a golden corpus that old programs must keep passing.
8. **Released by machine.** A tag publishes npm (with provenance only if the repository becomes public: D04 keeps it private), the VS Code extension and a GitHub release. Every merge can publish a `next` prerelease.
9. **Documented.** Spec, showcase, embedding guide, API reference, error code reference, Shamsine guide, security notes, performance notes.
10. **Visible.** The playground site is live, checked (Lighthouse, accessibility), with launch material and a demo that is safe to run live on TV.

## How a phase runs (short version)

1. **Pick a ready phase.** Run `node docs/production/tools/progress.mjs` (or use the helper prompt "Which phases can I start now?" in [`phases/prompts.md`](phases/prompts.md)). It prints the phases whose Depends are all done.
2. **Start one Claude Code session per phase** with that phase's prompt. You can run many sessions at the same time.
3. The session checks Depends and decisions, asks you the card's **Ask first** questions, does the work, runs every check, writes `status/<ID>.md` and a changelog fragment, then commits, pushes and opens a pull request titled `[<ID>] <phase title>`.
4. **You review and merge.** Merge order between phases does not matter (see the next section).
5. After the merge, the `plan-progress.yml` workflow rebuilds [`progress.md`](progress.md) on `main` (a minute later).

## Why pull requests will not block each other

The last plan (Shamsine forms) had two problems: many extra "b" and "c" cards, because cards were too big; and pull requests that had to be merged one by one, because every one of them edited the same `TODO.md` and the same progress graph in `README.md`. This plan avoids both:

1. **No shared to-do file.** Each phase writes only its own `status/<ID>.md`. Things that can wait go into the **Later** section of that file. The progress tool collects every Later item into `progress.md`, so you still see one list.
2. **The progress graph is generated, never edited by a phase.** The workflow `.github/workflows/plan-progress.yml` rebuilds `progress.md` after each merge to `main` and commits it (you can also start it by hand from the Actions tab). A phase branch never touches it.
3. **Changelog fragments.** A phase never edits `CHANGELOG.md`. It writes `changes/<ID>.md`. Only release phases (V1, V2, V3, V5) turn fragments into a CHANGELOG section.
4. **Places are prepared ahead.** Things many phases would add to are created once, early, by one phase: the package `exports` map with every entry point (R2), one CI workflow file per job (every new job is a new file), one expected-result file per example (B1), one case file per phase in the test harnesses (C1), one README per source folder (A1 rule).
5. **Phases that must edit the same "hot" file are chained** with Depends (see [Hot files and lanes](#hot-files-and-lanes)). Phases in different lanes do not touch the same lines.
6. **Cards are sized to fit.** Each card was cut to about half of the size budget, and it says ahead what may move to Later if it still grows. Sessions do not create new cards (see [Split rule](#split-rule)).
7. **A guard checks every pull request** (added by A1): it fails a PR that edits a protected file it is not allowed to edit, or more than one status file.

## Rules for every phase

### Start of session (the agent does this first)

1. Read `CLAUDE.md` (from phase A1 on; it imports `.cursor/rules/*.mdc`). Before A1 exists, read `.cursor/rules/*.mdc` directly.
2. Read this file and the card `phases/<ID>.md`.
3. **Check Depends.** Each phase in Depends needs `status/<dep>.md` with `Status: done`. If one is missing or not done, stop and tell the owner. Do not start "a little bit".
4. **Check decisions.** For each decision the card lists, open [`decisions.md`](decisions.md). It must have an **Answer**. If it has none, ask the owner now: show the question, the options and the recommendation in one message. Write the answer and the date under that decision.
5. Read **only** the files the card lists under "Read". Read more only when you are blocked, and say why.
6. Ask the card's **Ask first** questions (if any), all in one message, and wait.
7. Say your plan in 5–10 lines. For Design cards: the approved decision (with its example in `decisions.md`) **is** the proposal and the approval of the spec-governance cycle (`.cursor/rules/spec-governance.mdc` steps 1–3). If your work needs anything beyond it, stop and ask.

### When to stop and ask the owner

Stop and ask, in one clear message with your recommendation, when:

- a **language design question** comes up that no decision or card answers (syntax, meaning, a spec change). Never decide it alone;
- you need a **new dependency** that is not on the approved list ([D09](decisions.md#d09));
- you must edit a **protected file** your card does not allow;
- a test that passed before now fails, and the fix is **outside your card**;
- you would go over **twice the size budget**;
- a Depends phase is done, but its output **does not match** what your card expects, and adapting would change your card's scope (if the difference is a name or a small detail, adapt and note it in your status file);
- after the 1.0 release (V5): you are about to make a **breaking change** to something already published. Before 1.0, breaking changes are allowed (D38): mark them `breaking: true` in your changelog fragment.

### Size budget

The budget is for one happy-path session:

- at most **12 hand-written source or test files** with logic changes, and
- at most **1,000 changed lines** in those files.

Not counted: generated files (`src/language/generated/**`, `vscode-extension/syntaxes/*.json`, generated docs), lockfiles, pure moves and renames, formatting-only changes, prose (spec, showcase, guides, cards, status files), data files (fixtures, `expected.json`), and the same small edit repeated across many content files (counts as one file).

Every card in this plan was sized at about **half** of the budget.

### Split rule

**Sessions do not create new cards.** When a phase grows:

1. **Everything in "Done when" must be done.** Finish it even past the budget. Quality is never cut to fit, and you never stop with something broken (errors, failing checks, half-working features).
2. Work that is **not** in "Done when" and not needed for it (polish, nice-to-have, a cleanup you noticed) goes to the **Later** section of your status file, with a suggested lane. Each card has an "If it grows" section that says what may move.
3. Only if the required work is **more than about twice the budget**, and it divides into a part that works on its own: stop and ask the owner. Propose the split. If the owner agrees, finish the first part cleanly, set `Status: partial`, and list the rest under Later with the tag `next card`. The **owner** decides if it becomes a new card. Phases that depend on a `partial` phase do not start until the owner says so.

### Protected files

A phase may edit these only when the table says so. The guard workflow (from A1) checks most of them.

| File or area | Who may edit it |
|---|---|
| `CHANGELOG.md`, `vscode-extension/CHANGELOG.md` | Release phases V1, V2, V3, V5 |
| `README.md` (repo root) | Release phases and G1. Exception: a phase whose behavior change alters a `console` output block that `test/examples.test.ts` checks updates **that block only** (C2, C3, C4, C6, R7, L7, X4, X5, X6) |
| `docs/status.md`, `docs/roadmap.md` | A1 (closes them); V1 marks roadmap Phase 9 as published. Otherwise frozen history |
| `docs/production/README.md`, `docs/production/phases/**` | Owner; A2 (to match answers) |
| `docs/production/decisions.md` | A2; any phase only to record an answer under a decision it had to ask |
| `docs/production/progress.md` | The `plan-progress.yml` workflow (or the owner, by running the tool) |
| `docs/production/status/<other ID>.md` | Only the phase with that ID |
| `.github/workflows/ci.yml` | Q1 only. Every new CI job is a **new workflow file** |
| `package.json`: `exports`, `typesVersions`, `peerDependencies`, `engines` | R2 (creates the map), H1 (adds CommonJS `require` targets), Q1 (`engines`) |
| `.cursor/rules/*.mdc`, `CLAUDE.md` | A1; L1 (the lines about `&`); other phases only where their card says |
| `docs/query-language-spec.md`, `docs/showcase.md`, `src/language/minab.langium` | Only cards that say so, under the spec-governance rule, and only the sections they name |

Everything else may be edited by any phase whose card lists it.

### Hot files and lanes

Some files are edited by many phases. Depends chains keep those phases from running at the same time.

| Hot file | Phases that edit it | How collisions are avoided |
|---|---|---|
| `src/language/minab.langium` (and its generated TextMate grammar, spec §11, playground tokenizer) | L1, L3, L4, L7 | One chain: L1 → L2 → L3 → L4 → L7 |
| Spec §12 (open questions) | L1 (item 10), L4 (the rest) | Same chain |
| Spec §5.3.1 (built-in table) | L5, L6, L7 | L5 → L6; L7 waits for L5 |
| Spec §5.5 (casting) | C3, C5, L4 | C3 → C5 → L4 |
| `minab-interpreter.ts` value and operator code | C2, C3, C4 | C2 first, then C3 and C4 (different functions) |
| `minab-interpreter.ts` evaluation context and ports | R2, R3, R4 | Chain R2 → R3 → R4 |
| `minab-interpreter.ts` statements | X3, X4, X5, X6 | Chain X3 → X4, X3 → X5 → X6 |
| `src/cli/main.ts` | L1, R7, L7, X5 | L1 → R7 → (L7, H1 → X5); L7 and X5 touch different commands (logs vs. `--apply`): if both run at once, merge `main` into the second before it ends |
| `playground/src/engine/**` | L1, R8, X3, X4, E1, L7, H7, X5, X6 | L1 → R8, then R8 → X3 → X4 and X3 → L7 → H7 → X5 → X6; E1 changes only `intel.ts` |
| Playground tokenizer `playground/src/syntax/tokens.ts` (moved to `src/editor/tokens.ts` by E5) | L1, L3, L4, L7, E5 | Chain L1 → L3 → L4 → L7 → E5 |
| `playground/src/ui/**` | L7 (Console tab), W2, W3 | L7 → W2 → W3 |
| `playground/src/content/examples/index.ts` (gallery) | L1, C6, L3, X4, X6 | Content file: if two branches both add entries, keep both |
| `playground/src/content/reference/cheatsheet.ts` | Language and execution phases | Content file: keep entries grouped by topic; on conflict keep both |

### Merge conflicts: how to resolve

If `main` moved while you worked, merge `main` into your branch (do not rebase a branch someone else may use), then:

- **`package-lock.json`**: take `main`'s version, run `npm install`, commit the result.
- **`bun.lock`** (D07 keeps it): take `main`'s version, run `bun install`, commit the result.
- **Generated files** (`src/language/generated/**`, `vscode-extension/syntaxes/minab.tmLanguage.json`, `docs/reference/diagnostics.md`): never resolve by hand. Run the generator (`npm run langium:generate`, `npm run docs:diagnostics`).
- **Registries and lists** (diagnostic codes, cheat sheet, gallery, package dependencies): keep both sides; keep the list sorted.
- **Anything else**: resolve it, then run all end-of-session checks again.

### End of session (every phase)

1. **Checks.** All green, run from a clean build:
   - root: `npm run build` and `npm test` (from B1 on also `npm run lint` and `npm run format:check`);
   - if anything under `src/` or `playground/` changed: `cd playground && npm test && npm run build` (the playground compiles `src/language` from source, so a language change can break it);
   - if the grammar, the language server or the extension changed: `cd vscode-extension && npm run build`;
   - if the card has a database test: run it with PGlite (always) and, if you can, with `MINAB_TEST_DATABASE_URL` set to a throwaway Postgres.
2. **Every fix has a test that fails without it.** Check it once: undo the fix, see the test fail, put the fix back. (Phase 7 of the old roadmap did this, keep the habit.)
3. **Never** skip, delete or loosen a test to get green. If a test's expectation must change because behavior changed **on purpose**, change it and explain why in your status file.
4. `npm run langium:generate` prints only the known `Postfix` warning (spec §12 item 4) unless your card says otherwise.
5. **New folders** get a `README.md` that lists their files and rules. Update the README of any folder whose files you changed. Do not add new layout lines to `.cursor/rules/*.mdc`.
6. **New diagnostics and errors** get a stable code in the registry (from B1 on). Keep the registry sorted.
7. **Status file**: write `docs/production/status/<ID>.md` (format below). Do not edit any other phase's status file.
8. **Changelog fragment**: if a user, a host developer or an editor user can see the change, write `changes/<ID>.md` (format below). Pure test or CI changes need none.
9. **Commit and push.** Conventional commit messages with a scope, for example `feat(runtime): add prepare/run API (R2)` or `fix(interpreter): run CAST (C3)`. Then open a pull request titled `[<ID>] <phase title>`, with the PR template filled in.
10. Do not start another phase in the same session.

### Status file format

`docs/production/status/<ID>.md`:

```markdown
# <ID> <phase title>

Status: done | waiting for approval | blocked | partial
Date: YYYY-MM-DD
Branch / PR: <branch name or PR link>

## Done
One short paragraph, then bullets: what is finished and where it lives.

## Checks
The commands you ran and their results (test counts, skipped tests, lint, playground, extension, database).

## Answers
Answers the owner gave in this session (Ask first, decisions), with the date. "None" if empty.

## Questions for the owner
Open questions, each with your recommendation. "None" if empty.

## Later
- <item> — <why it can wait> — <suggested lane or card, or "next card">
"None" if empty.
```

- `waiting for approval`: Design phases and any phase whose card says the owner must approve. Only the owner moves it to `done` (helper prompt "Review a phase waiting for approval").
- `blocked`: the session stopped, for example a Depends phase was not done, or a question is open. "Questions for the owner" says why.
- `partial`: the owner agreed to a split (see Split rule). Later lists the rest with `next card`.

The progress tool reads `Status:`, "Questions for the owner" and "Later" from every status file. Keep those headings exactly as written.

### Changelog fragment format

`changes/<ID>.md` (the folder is created by A1):

```markdown
---
type: added | changed | deprecated | removed | fixed | security
scope: language | runtime | cli | node | nestjs | browser | editor | vscode | playground | docs | build
breaking: false
---
One or two sentences for users, in plain English and present tense. Name the new thing or the fixed behavior, not the files.
```

One fragment per phase. If a phase has two different user-visible changes, write `changes/<ID>-2.md` for the second. Release phases assemble the fragments into `CHANGELOG.md` with `scripts/changelog.mjs` (from Q2) and delete them.

### Card format

Every card has the same sections:

| Section | Meaning |
|---|---|
| Header table | Lane, kind, size, Depends, decisions it uses, the release it belongs to |
| Goal | What exists after the phase, in two or three sentences |
| Why now | Why it sits here in the order |
| Read | The only files and sections to read first (the inputs) |
| Ask first | Questions to ask the owner before working, each with a recommended answer. "None" if the decisions cover everything |
| Build | Numbered steps: exactly what to make |
| Files | Files to create or change |
| Do not touch | Files near this work that belong to other phases |
| Output | What other phases can use after this one |
| Test scenarios | Concrete cases that must have a test |
| Done when | The checkable result. All of it is required |
| Not here | Tempting work that belongs to another phase (and which one) |
| Later | Known follow-ups that may wait |
| If it grows | What may move to Later if the phase runs over budget, and what must stay |

**Kinds:** **Design** needs a language or architecture decision before code. **Mechanical** is already decided: implement and test. **Mixed** starts with a small decision. **Owner** needs the owner's hands (approvals, accounts, publishing, recording).

**Sizes:** **S** is a short session. **M** is one full session (about half of the budget). There are no L cards: large work was cut into M cards.

## Who does what

- **The owner (Hamed)** answers decisions (A2), approves Design phases, merges pull requests, owns accounts and secrets (npm, Marketplace, hosting, domain), pushes release tags (or tells a session to), and does manual checks (VS Code, the TV demo).
- **Sessions** do everything else: code, tests, docs, workflows, status files.
- **Outward-facing actions** (publishing to npm or the Marketplace, pushing a tag, deploying the site, creating a GitHub release) happen only when the owner says so in that session, or through a workflow the owner triggers.

## Related repositories

Shamsine (`shams-app/monorepo`) is Minab's main host. Its forms plan has a Minab group (cards M.0–M.16 in `docs/forms/phases/`), and cards M.1–M.3 were planned to run in this repo. **This plan delivers them** (see [`phases/README.md`](phases/README.md#shamsine-cards-m0m16)). Phases here may **read** the monorepo, never change it. Changes the monorepo needs are listed by G2 for the owner.
