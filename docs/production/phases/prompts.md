# Prompts

One ready-to-paste prompt per phase, in the order of [`README.md`](README.md). Start **one Claude Code session per prompt**. A phase can start as soon as every phase in its Depends has `Status: done` in `docs/production/status/`; you can run many such sessions at the same time. Every prompt makes the session check its Depends first and stop if one is not done, so starting a phase too early does no harm.

How the plan works, and the rules every session follows: [`../README.md`](../README.md). Decisions: [`../decisions.md`](../decisions.md). Progress: [`../progress.md`](../progress.md).

**In a cloud session:** attach the `shams-app/minab` repository. Phases R1 and G2 also read `shams-app/monorepo` (read only).

**Where to paste a prompt:** in **Claude Code**, never in a normal Claude chat and never in Claude Design. Use claude.ai/code in the browser, or the **Code** tab in the Claude desktop app. Start a new session with the `shams-app/minab` repository and paste the prompt as your first message.

**Not to be confused with** `playground/design/design-briefs.md`: those are the screen briefs the W1 session uses inside Claude Design. You never paste them yourself.

## Helper prompts

**Which phases can I start now?**

```text
In the minab repository, run `node docs/production/tools/progress.mjs --ready` and `node docs/production/tools/progress.mjs`. Tell me: the phases I can start now (with their titles and kinds), the phases waiting for my approval, the blocked or partial phases and why (from their status files), and the decisions still open in docs/production/decisions.md. If I have fewer free sessions than ready phases, recommend which to start first, using the priority in docs/production/phases/README.md ("Lanes") and decision D02. Change nothing.
```

**Review a phase waiting for approval** (A2, R1, W1, W4, W5, V4; replace `<ID>`):

```text
Read CLAUDE.md, docs/production/README.md, docs/production/phases/<ID>.md and docs/production/status/<ID>.md. Phase <ID> is waiting for my approval. Show me, in short, what it produced and what it asks me. My review: <write "approved" or your change requests here>. Apply every change I ask for in the files the card allows, run the card's checks again, and update docs/production/status/<ID>.md. Only when I say "approved", set its status to "Status: done". Then commit, push and open (or update) the pull request titled "[<ID>] <phase title>". Do not start any other phase and do not edit any other status file.
```

**Unblock a blocked or partial phase** (replace `<ID>`):

```text
Read CLAUDE.md, docs/production/README.md, docs/production/phases/<ID>.md and docs/production/status/<ID>.md. Phase <ID> stopped. Show me its open questions with your recommendation for each. My answers: <write them here, or "ask me one by one">. Record my answers in the status file (and in docs/production/decisions.md if a question is one of its decisions), then continue the phase exactly as its card says, following "Rules for every phase". At the end, update docs/production/status/<ID>.md, then commit, push and update the pull request titled "[<ID>] <phase title>".
```

**Bring a phase branch up to date with `main`** (when a pull request has conflicts):

```text
Read docs/production/README.md, section "Merge conflicts: how to resolve". On this branch, merge origin/main (do not rebase), resolve every conflict exactly as that section says (lockfiles: take main's and run npm install; generated files: regenerate; lists: keep both sides, sorted), then run every end-of-session check from "Rules for every phase" and fix anything that broke. Commit the merge and push. Tell me what conflicted and how you resolved it.
```

**Owner digest: open questions and deferred work:**

```text
In the minab repository, run `node docs/production/tools/progress.mjs` and read the "Questions for the owner" and "Later" lists it prints. Group the questions by phase and give a recommendation for each. Group the Later items by lane, mark the ones that look like blockers for the next release in docs/production/phases/README.md ("Release trains"), and suggest which could become a new card. Change nothing.
```

**Turn a Later item into a new card** (owner only; replace the placeholders):

```text
Read docs/production/README.md (card format, size budget) and docs/production/phases/README.md. Create a new phase card docs/production/phases/<new ID>.md for this work: <describe it, or paste the Later item>. Put it in lane <lane>, give it the right Depends, keep it within about half of the size budget (split it into two cards now if it is bigger), add its row to the phase list in docs/production/phases/README.md, add its prompt to docs/production/phases/prompts.md in the same style as the others, and update the Depends of any phase that must wait for it. Run `node docs/production/tools/progress.mjs --check`. Then commit, push and open a pull request titled "Plan: add card <new ID>".
```

**Rebuild the progress page by hand** (when CI could not push it):

```text
In the minab repository, run `node docs/production/tools/progress.mjs --write`, commit only docs/production/progress.md with the message "docs(plan): update progress", push and open a pull request titled "Plan: update progress".
```

## A — Start

### A1 Plan bootstrap: AI entry file, rules, fragments and guards

```text
Read the three files in .cursor/rules/, docs/production/README.md and docs/production/phases/A1.md, then do phase A1 exactly as its card says. It has no Depends and needs no decision. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/A1.md (and changes/A1.md if users can see the change), then commit, push your branch and open a pull request titled "[A1] Plan bootstrap: AI entry file, rules, fragments and guards". Do not edit another phase's status file or a protected file your card does not allow.
```

### A2 Decision sitting

```text
Read CLAUDE.md if it exists (otherwise the three files in .cursor/rules/), docs/production/README.md, docs/production/decisions.md and docs/production/phases/A2.md, then do phase A2, the decision sitting, exactly as its card says. It has no Depends. First ask me whether we go one by one, or I accept all recommendations and talk only about the decisions I name. Go group by group. Write each answer on the decision's "Answer:" line with today's date. If an answer differs from the recommendation, update the cards that decision blocks, as the card says. Keep the status "waiting for approval" until every decision has an answer or "ask at phase <ID>". Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/A2.md (and changes/A2.md if users can see the change), then commit, push your branch and open a pull request titled "[A2] Decision sitting". Do not edit another phase's status file or a protected file your card does not allow.
```

## B — Code-wide sweep (runs alone)

### B1 Diagnostic codes, format and lint, one expected-result file per example

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/B1.md, then do phase B1 exactly as its card says. Its Depends: A1, A2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D08, D35, D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase B1"), ask me before you start, show the options and the recommendation, and write my answer there. This phase must run alone: before you change any code, ask me to confirm that no other code phase is running right now. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/B1.md (and changes/B1.md if users can see the change), then commit, push your branch and open a pull request titled "[B1] Diagnostic codes, format and lint, one expected-result file per example". Do not edit another phase's status file or a protected file your card does not allow.
```

## Q — CI, release and quality

### Q1 CI that catches real bugs

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/Q1.md, then do phase Q1 exactly as its card says. Its Depends: A1, A2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D06, D07. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase Q1"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/Q1.md (and changes/Q1.md if users can see the change), then commit, push your branch and open a pull request titled "[Q1] CI that catches real bugs". Do not edit another phase's status file or a protected file your card does not allow.
```

### Q2 Release automation and the `next` channel

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/Q2.md, then do phase Q2 exactly as its card says. Its Depends: Q1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D03, D04, D05. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase Q2"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/Q2.md (and changes/Q2.md if users can see the change), then commit, push your branch and open a pull request titled "[Q2] Release automation and the `next` channel". Do not edit another phase's status file or a protected file your card does not allow.
```

### Q3 Security hardening

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/Q3.md, then do phase Q3 exactly as its card says. Its Depends: R4, H2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D01, D34, D36, D37, D43. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase Q3"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/Q3.md (and changes/Q3.md if users can see the change), then commit, push your branch and open a pull request titled "[Q3] Security hardening". Do not edit another phase's status file or a protected file your card does not allow.
```

### Q4 Performance budgets

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/Q4.md, then do phase Q4 exactly as its card says. Its Depends: R4, H5. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D02. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase Q4"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/Q4.md (and changes/Q4.md if users can see the change), then commit, push your branch and open a pull request titled "[Q4] Performance budgets". Do not edit another phase's status file or a protected file your card does not allow.
```

### Q5 Compatibility guard: language version and golden corpus

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/Q5.md, then do phase Q5 exactly as its card says. Its Depends: R2, V1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D34, D38. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase Q5"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/Q5.md (and changes/Q5.md if users can see the change), then commit, push your branch and open a pull request titled "[Q5] Compatibility guard: language version and golden corpus". Do not edit another phase's status file or a protected file your card does not allow.
```

## L — Language

### L1 Call functions by name: remove `&`

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/L1.md, then do phase L1 exactly as its card says. Its Depends: B1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D10, D11. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase L1"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/L1.md (and changes/L1.md if users can see the change), then commit, push your branch and open a pull request titled "[L1] Call functions by name: remove `&`". Do not edit another phase's status file or a protected file your card does not allow.
```

### L2 Spec examples under test

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/L2.md, then do phase L2 exactly as its card says. Its Depends: L1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/L2.md (and changes/L2.md if users can see the change), then commit, push your branch and open a pull request titled "[L2] Spec examples under test". Do not edit another phase's status file or a protected file your card does not allow.
```

### L3 Names in any language, quoted names, physical names

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/L3.md, then do phase L3 exactly as its card says. Its Depends: L2, C1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D12. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase L3"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/L3.md (and changes/L3.md if users can see the change), then commit, push your branch and open a pull request titled "[L3] Names in any language, quoted names, physical names". Do not edit another phase's status file or a protected file your card does not allow.
```

### L4 Close the language backlog

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/L4.md, then do phase L4 exactly as its card says. Its Depends: L3, C5, C4. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D14, D22, D24, D25. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase L4"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/L4.md (and changes/L4.md if users can see the change), then commit, push your branch and open a pull request titled "[L4] Close the language backlog". Do not edit another phase's status file or a protected file your card does not allow.
```

### L5 Built-ins with several arguments: text, null and number functions

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/L5.md, then do phase L5 exactly as its card says. Its Depends: L1, C2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D20, D10. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase L5"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/L5.md (and changes/L5.md if users can see the change), then commit, push your branch and open a pull request titled "[L5] Built-ins with several arguments: text, null and number functions". Do not edit another phase's status file or a protected file your card does not allow.
```

### L6 Date and time built-ins

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/L6.md, then do phase L6 exactly as its card says. Its Depends: L5, R3. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D21. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase L6"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/L6.md (and changes/L6.md if users can see the change), then commit, push your branch and open a pull request titled "[L6] Date and time built-ins". Do not edit another phase's status file or a protected file your card does not allow.
```

### L7 `LOG` and the call statement

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/L7.md, then do phase L7 exactly as its card says. Its Depends: L4, L5, R7, R8, X3. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D19, D37, D36. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase L7"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/L7.md (and changes/L7.md if users can see the change), then commit, push your branch and open a pull request titled "[L7] `LOG` and the call statement". Do not edit another phase's status file or a protected file your card does not allow.
```

## C — Correctness: one language, two runtimes, one answer

### C1 Differential test harness

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/C1.md, then do phase C1 exactly as its card says. Its Depends: B1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase C1"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/C1.md (and changes/C1.md if users can see the change), then commit, push your branch and open a pull request titled "[C1] Differential test harness". Do not edit another phase's status file or a protected file your card does not allow.
```

### C2 Exact `DECIMAL` numbers

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/C2.md, then do phase C2 exactly as its card says. Its Depends: C1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D17, D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase C2"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/C2.md (and changes/C2.md if users can see the change), then commit, push your branch and open a pull request titled "[C2] Exact `DECIMAL` numbers". Do not edit another phase's status file or a protected file your card does not allow.
```

### C3 `CAST` runs in the interpreter

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/C3.md, then do phase C3 exactly as its card says. Its Depends: C2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D16. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase C3"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/C3.md (and changes/C3.md if users can see the change), then commit, push your branch and open a pull request titled "[C3] `CAST` runs in the interpreter". Do not edit another phase's status file or a protected file your card does not allow.
```

### C4 Text `+`, division and `%`

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/C4.md, then do phase C4 exactly as its card says. Its Depends: C2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D13, D14. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase C4"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/C4.md (and changes/C4.md if users can see the change), then commit, push your branch and open a pull request titled "[C4] Text `+`, division and `%`". Do not edit another phase's status file or a protected file your card does not allow.
```

### C5 `CITEXT` and `LIKE`

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/C5.md, then do phase C5 exactly as its card says. Its Depends: C3. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D15. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase C5"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/C5.md (and changes/C5.md if users can see the change), then commit, push your branch and open a pull request titled "[C5] `CITEXT` and `LIKE`". Do not edit another phase's status file or a protected file your card does not allow.
```

### C6 `check` accepts a top-level collection filter

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/C6.md, then do phase C6 exactly as its card says. Its Depends: L1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/C6.md (and changes/C6.md if users can see the change), then commit, push your branch and open a pull request titled "[C6] `check` accepts a top-level collection filter". Do not edit another phase's status file or a protected file your card does not allow.
```

### C7 `GROUPBY` on a related field

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/C7.md, then do phase C7 exactly as its card says. Its Depends: C1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/C7.md (and changes/C7.md if users can see the change), then commit, push your branch and open a pull request titled "[C7] `GROUPBY` on a related field". Do not edit another phase's status file or a protected file your card does not allow.
```

### C8 Checker completeness

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/C8.md, then do phase C8 exactly as its card says. Its Depends: L1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D18. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase C8"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/C8.md (and changes/C8.md if users can see the change), then commit, push your branch and open a pull request titled "[C8] Checker completeness". Do not edit another phase's status file or a protected file your card does not allow.
```

## R — Runtime: one API, ports and adapters

### R1 ADR 0002: runtime ports and where programs run

```text
Read CLAUDE.md if it exists (otherwise the three files in .cursor/rules/), docs/production/README.md and docs/production/phases/R1.md, then do phase R1 exactly as its card says. Its Depends: A2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D01, D27, D28, D29, D30, D31, D32, D33, D34, D35, D36, D37, D38. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase R1"), ask me before you start, show the options and the recommendation, and write my answer there. This phase reads the Shamsine monorepo (shams-app/monorepo) and never changes it. If it is not in this session, ask me to add it. When you finish, set the status to "waiting for approval": I review the ADR with the "Review a phase waiting for approval" helper prompt. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/R1.md (and changes/R1.md if users can see the change), then commit, push your branch and open a pull request titled "[R1] ADR 0002: runtime ports and where programs run". Do not edit another phase's status file or a protected file your card does not allow.
```

### R2 Runtime API core

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/R2.md, then do phase R2 exactly as its card says. Its Depends: R1, L1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D29, D31. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase R2"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/R2.md (and changes/R2.md if users can see the change), then commit, push your branch and open a pull request titled "[R2] Runtime API core". Do not edit another phase's status file or a protected file your card does not allow.
```

### R3 Ports: data, host functions and inputs, clock, events, write

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/R3.md, then do phase R3 exactly as its card says. Its Depends: R2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D27, D28, D33, D10, D11. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase R3"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/R3.md (and changes/R3.md if users can see the change), then commit, push your branch and open a pull request titled "[R3] Ports: data, host functions and inputs, clock, events, write". Do not edit another phase's status file or a protected file your card does not allow.
```

### R4 Limits, cancellation and structured run errors

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/R4.md, then do phase R4 exactly as its card says. Its Depends: R3. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D36, D35. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase R4"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/R4.md (and changes/R4.md if users can see the change), then commit, push your branch and open a pull request titled "[R4] Limits, cancellation and structured run errors". Do not edit another phase's status file or a protected file your card does not allow.
```

### R5 Program analysis: tiers and dependencies

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/R5.md, then do phase R5 exactly as its card says. Its Depends: R2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D30. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase R5"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/R5.md (and changes/R5.md if users can see the change), then commit, push your branch and open a pull request titled "[R5] Program analysis: tiers and dependencies". Do not edit another phase's status file or a protected file your card does not allow.
```

### R6 Wire format v1

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/R6.md, then do phase R6 exactly as its card says. Its Depends: R4, R5. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D34, D17, D21, D36. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase R6"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/R6.md (and changes/R6.md if users can see the change), then commit, push your branch and open a pull request titled "[R6] Wire format v1". Do not edit another phase's status file or a protected file your card does not allow.
```

### R7 The CLI runs on the runtime API

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/R7.md, then do phase R7 exactly as its card says. Its Depends: R4. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/R7.md (and changes/R7.md if users can see the change), then commit, push your branch and open a pull request titled "[R7] The CLI runs on the runtime API". Do not edit another phase's status file or a protected file your card does not allow.
```

### R8 The playground engine runs on the runtime API

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/R8.md, then do phase R8 exactly as its card says. Its Depends: R4, R5. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/R8.md (and changes/R8.md if users can see the change), then commit, push your branch and open a pull request titled "[R8] The playground engine runs on the runtime API". Do not edit another phase's status file or a protected file your card does not allow.
```

## H — Hosts: Node, NestJS and the browser

### H1 Node adapters, transactions and the CommonJS build

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/H1.md, then do phase H1 exactly as its card says. Its Depends: R7. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D32, D06, D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase H1"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/H1.md (and changes/H1.md if users can see the change), then commit, push your branch and open a pull request titled "[H1] Node adapters, transactions and the CommonJS build". Do not edit another phase's status file or a protected file your card does not allow.
```

### H2 NestJS module

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/H2.md, then do phase H2 exactly as its card says. Its Depends: H1, R6. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D34, D37, D36, D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase H2"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/H2.md (and changes/H2.md if users can see the change), then commit, push your branch and open a pull request titled "[H2] NestJS module". Do not edit another phase's status file or a protected file your card does not allow.
```

### H3 NestJS example app with end-to-end tests

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/H3.md, then do phase H3 exactly as its card says. Its Depends: H2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D09, D34. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase H3"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/H3.md (and changes/H3.md if users can see the change), then commit, push your branch and open a pull request titled "[H3] NestJS example app with end-to-end tests". Do not edit another phase's status file or a protected file your card does not allow.
```

### H4 Browser worker and two-way port bridge

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/H4.md, then do phase H4 exactly as its card says. Its Depends: R6, R8. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D30. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase H4"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/H4.md (and changes/H4.md if users can see the change), then commit, push your branch and open a pull request titled "[H4] Browser worker and two-way port bridge". Do not edit another phase's status file or a protected file your card does not allow.
```

### H5 Remote runs, routing and the browser bundle

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/H5.md, then do phase H5 exactly as its card says. Its Depends: H4. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D28, D30, D34. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase H5"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/H5.md (and changes/H5.md if users can see the change), then commit, push your branch and open a pull request titled "[H5] Remote runs, routing and the browser bundle". Do not edit another phase's status file or a protected file your card does not allow.
```

### H6 Browser example app with browser tests

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/H6.md, then do phase H6 exactly as its card says. Its Depends: H5, H3, E5. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase H6"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/H6.md (and changes/H6.md if users can see the change), then commit, push your branch and open a pull request titled "[H6] Browser example app with browser tests". Do not edit another phase's status file or a protected file your card does not allow.
```

### H7 The playground uses the published browser entry

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/H7.md, then do phase H7 exactly as its card says. Its Depends: H5, E1, L7. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/H7.md (and changes/H7.md if users can see the change), then commit, push your branch and open a pull request titled "[H7] The playground uses the published browser entry". Do not edit another phase's status file or a protected file your card does not allow.
```

## E — Editor: language server, VS Code and Monaco

### E1 Editor services core

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/E1.md, then do phase E1 exactly as its card says. Its Depends: R8. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/E1.md (and changes/E1.md if users can see the change), then commit, push your branch and open a pull request titled "[E1] Editor services core". Do not edit another phase's status file or a protected file your card does not allow.
```

### E2 Language server: a schema per document, completion and hover

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/E2.md, then do phase E2 exactly as its card says. Its Depends: E1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/E2.md (and changes/E2.md if users can see the change), then commit, push your branch and open a pull request titled "[E2] Language server: a schema per document, completion and hover". Do not edit another phase's status file or a protected file your card does not allow.
```

### E3 Language server extras

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/E3.md, then do phase E3 exactly as its card says. Its Depends: E2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/E3.md (and changes/E3.md if users can see the change), then commit, push your branch and open a pull request titled "[E3] Language server extras". Do not edit another phase's status file or a protected file your card does not allow.
```

### E4 VS Code extension ready for the Marketplace

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/E4.md, then do phase E4 exactly as its card says. Its Depends: E2, Q2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D04, D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase E4"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/E4.md (and changes/E4.md if users can see the change), then commit, push your branch and open a pull request titled "[E4] VS Code extension ready for the Marketplace". Do not edit another phase's status file or a protected file your card does not allow.
```

### E5 Monaco integration for host apps

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/E5.md, then do phase E5 exactly as its card says. Its Depends: E1, H4, L7. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase E5"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/E5.md (and changes/E5.md if users can see the change), then commit, push your branch and open a pull request titled "[E5] Monaco integration for host apps". Do not edit another phase's status file or a protected file your card does not allow.
```

## X — Execution: everything the grammar accepts runs

### X1 Queries accept `switch`, `if`, `is` and JSON literals

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/X1.md, then do phase X1 exactly as its card says. Its Depends: C1. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/X1.md (and changes/X1.md if users can see the change), then commit, push your branch and open a pull request titled "[X1] Queries accept `switch`, `if`, `is` and JSON literals". Do not edit another phase's status file or a protected file your card does not allow.
```

### X2 Multi-key `KEY` and user functions inside a query

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/X2.md, then do phase X2 exactly as its card says. Its Depends: X1, L4. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D22, D23. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase X2"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/X2.md (and changes/X2.md if users can see the change), then commit, push your branch and open a pull request titled "[X2] Multi-key `KEY` and user functions inside a query". Do not edit another phase's status file or a protected file your card does not allow.
```

### X3 Statements run: blocks, function bodies, assignment, `if!`

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/X3.md, then do phase X3 exactly as its card says. Its Depends: R4, R8. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D13. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase X3"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/X3.md (and changes/X3.md if users can see the change), then commit, push your branch and open a pull request titled "[X3] Statements run: blocks, function bodies, assignment, `if!`". Do not edit another phase's status file or a protected file your card does not allow.
```

### X4 Loops, `.$index` and tuples

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/X4.md, then do phase X4 exactly as its card says. Its Depends: X3. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D36. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase X4"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/X4.md (and changes/X4.md if users can see the change), then commit, push your branch and open a pull request titled "[X4] Loops, `.$index` and tuples". Do not edit another phase's status file or a protected file your card does not allow.
```

### X5 Writes, part 1: the write port and table writes

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/X5.md, then do phase X5 exactly as its card says. Its Depends: X3, H1, H7. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D26. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase X5"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/X5.md (and changes/X5.md if users can see the change), then commit, push your branch and open a pull request titled "[X5] Writes, part 1: the write port and table writes". Do not edit another phase's status file or a protected file your card does not allow.
```

### X6 Writes, part 2: JSON arrays and path assignment

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/X6.md, then do phase X6 exactly as its card says. Its Depends: X5, X4. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D26. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase X6"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/X6.md (and changes/X6.md if users can see the change), then commit, push your branch and open a pull request titled "[X6] Writes, part 2: JSON arrays and path assignment". Do not edit another phase's status file or a protected file your card does not allow.
```

## G — Guides

### G1 Embedding guide, API reference and docs index

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/G1.md, then do phase G1 exactly as its card says. Its Depends: H3, H6, E5. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D09, D38. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase G1"), ask me before you start, show the options and the recommendation, and write my answer there. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/G1.md (and changes/G1.md if users can see the change), then commit, push your branch and open a pull request titled "[G1] Embedding guide, API reference and docs index". Do not edit another phase's status file or a protected file your card does not allow.
```

### G2 Shamsine integration guide

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/G2.md, then do phase G2 exactly as its card says. Its Depends: R5, H3, H5, E5, L3, L6. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D01, D12, D17, D21, D27, D35, D45. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase G2"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. This phase reads the Shamsine monorepo (shams-app/monorepo) and never changes it. If it is not in this session, ask me to add it. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/G2.md (and changes/G2.md if users can see the change), then commit, push your branch and open a pull request titled "[G2] Shamsine integration guide". Do not edit another phase's status file or a protected file your card does not allow.
```

## W — Website (the playground)

### W1 Website design pass (Claude Design)

Paste this in Claude Code (see "Where to paste a prompt" above), not in Claude Design. The session builds the designs and sends you links. See "How this phase works" in [`W1.md`](W1.md).

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/W1.md, then do phase W1 exactly as its card says. Its Depends: A2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D40. Ask me the card's four "Ask first" questions in one message, with your recommendation for each, and wait for my answers; write them under D40 in docs/production/decisions.md. Do not ask me anything else about setup: the card decides how Claude Design is used. You build the designs yourself in one Claude Design canvas (Artifact tool, Design type), in the card's four rounds. After each round, send me the link and a short list of what to check, wait for my "approved" or my changes, then write that round into playground/design/handoff.md, commit and push. If you cannot create a Claude Design canvas, tell me in one line and use the card's fallback. Write no code except the author URL the card names. After round 4, set the status to "waiting for approval". Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/W1.md (and changes/W1.md if users can see the change), then commit, push your branch and open a pull request titled "[W1] Website design pass (Claude Design)". Do not edit another phase's status file or a protected file your card does not allow.
```

**Continue W1** (when a W1 session stopped in the middle; paste in a new Claude Code session):

```text
Read CLAUDE.md, docs/production/README.md, docs/production/phases/W1.md, docs/production/status/W1.md (if it exists) and playground/design/handoff.md. Phase W1 was started and stopped. Check out the W1 branch from its open pull request titled "[W1] Website design pass (Claude Design)" (if there is no pull request, find the branch that changed playground/design/handoff.md). The Claude Design canvas link is at the top of handoff.md: read it with the Artifact tool. Tell me in three lines which rounds are approved and what comes next, then continue from the first round that is not approved, exactly as the card says. Do not ask the "Ask first" questions again if D40 already has the answers.
```

### W2 Build the design: tokens, shell and workbench

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/W2.md, then do phase W2 exactly as its card says. Its Depends: W1, L7. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/W2.md (and changes/W2.md if users can see the change), then commit, push your branch and open a pull request titled "[W2] Build the design: tokens, shell and workbench". Do not edit another phase's status file or a protected file your card does not allow.
```

### W3 Build the design: landing, learn, examples, reference, embed

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/W3.md, then do phase W3 exactly as its card says. Its Depends: W2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/W3.md (and changes/W3.md if users can see the change), then commit, push your branch and open a pull request titled "[W3] Build the design: landing, learn, examples, reference, embed". Do not edit another phase's status file or a protected file your card does not allow.
```

### W4 Deploy and verify the website

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/W4.md, then do phase W4 exactly as its card says. Its Depends: W3. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D41, D42, D40, D09. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase W4"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. When you finish, set the status to "waiting for approval": I review the manual Step F checklist with the "Review a phase waiting for approval" helper prompt. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/W4.md (and changes/W4.md if users can see the change), then commit, push your branch and open a pull request titled "[W4] Deploy and verify the website". Do not edit another phase's status file or a protected file your card does not allow.
```

### W5 Launch kit and the TV demo

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/W5.md, then do phase W5 exactly as its card says. Its Depends: W4, V2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D44, D40, D02. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase W5"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. When you finish, set the status to "waiting for approval": I review the launch material and the rehearsal with the "Review a phase waiting for approval" helper prompt. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/W5.md (and changes/W5.md if users can see the change), then commit, push your branch and open a pull request titled "[W5] Launch kit and the TV demo". Do not edit another phase's status file or a protected file your card does not allow.
```

## V — Releases and the 1.0 gate

### V1 Release 0.2.0: the first public release

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/V1.md, then do phase V1 exactly as its card says. Its Depends: L2, C3, C4, C5, C6, C7, C8, Q2. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D03, D04. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase V1"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Never push a tag, publish to npm or a marketplace, or create a GitHub release until I say so in this session; when I do not, give me the exact commands instead. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/V1.md (no changelog fragment: this phase turns the fragments into the CHANGELOG), then commit, push your branch and open a pull request titled "[V1] Release 0.2.0: the first public release". Do not edit another phase's status file or a protected file your card does not allow.
```

### V2 Release 0.3.0: embeddable

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/V2.md, then do phase V2 exactly as its card says. Its Depends: V1, L3, L5, L6, R5, H3, H6, H7, E5, G1, G2, Q3, Q4, Q5. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D02. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase V2"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Never push a tag, publish to npm or a marketplace, or create a GitHub release until I say so in this session; when I do not, give me the exact commands instead. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/V2.md (no changelog fragment: this phase turns the fragments into the CHANGELOG), then commit, push your branch and open a pull request titled "[V2] Release 0.3.0: embeddable". Do not edit another phase's status file or a protected file your card does not allow.
```

### V3 Release 0.4.0: the whole language runs

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/V3.md, then do phase V3 exactly as its card says. Its Depends: V2, X2, X4, X6, L4, L7, E3, E4. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Never push a tag, publish to npm or a marketplace, or create a GitHub release until I say so in this session; when I do not, give me the exact commands instead. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/V3.md (no changelog fragment: this phase turns the fragments into the CHANGELOG), then commit, push your branch and open a pull request titled "[V3] Release 0.4.0: the whole language runs". Do not edit another phase's status file or a protected file your card does not allow.
```

### V4 Production readiness review

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/V4.md, then do phase V4 exactly as its card says. Its Depends: V3, W4. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D02, D38, D39. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase V4"), ask me before you start, show the options and the recommendation, and write my answer there. When you finish, set the status to "waiting for approval": I review `docs/production/readiness.md` with the "Review a phase waiting for approval" helper prompt. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/V4.md (and changes/V4.md if users can see the change), then commit, push your branch and open a pull request titled "[V4] Production readiness review". Do not edit another phase's status file or a protected file your card does not allow.
```

### V5 Release 1.0.0

```text
Read CLAUDE.md, docs/production/README.md and docs/production/phases/V5.md, then do phase V5 exactly as its card says. Its Depends: V4. Before anything else, check that docs/production/status/ has a file with "Status: done" for each of them; if one is missing or not done, stop and tell me. Its decisions: D38. Read them in docs/production/decisions.md; if one has no answer (or says "ask at phase V5"), ask me before you start, show the options and the recommendation, and write my answer there. The card has "Ask first" questions: ask me all of them in one message and wait for my answers before you start the work. Never push a tag, publish to npm or a marketplace, or create a GitHub release until I say so in this session; when I do not, give me the exact commands instead. Follow "Rules for every phase" in docs/production/README.md: the start and end checklists, the size budget, the split rule (never create a new card), the protected files, and when to stop and ask. Do not start any other phase. At the end: run every check the rules list, write docs/production/status/V5.md (no changelog fragment: this phase turns the fragments into the CHANGELOG), then commit, push your branch and open a pull request titled "[V5] Release 1.0.0". Do not edit another phase's status file or a protected file your card does not allow.
```
