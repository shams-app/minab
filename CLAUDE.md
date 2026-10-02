# Minab — notes for AI sessions

Claude Code reads this file first. The project rules live in `.cursor/rules/`
so that Cursor and Claude Code follow the same rules:

@.cursor/rules/00-project-overview.mdc
@.cursor/rules/language-implementation.mdc
@.cursor/rules/spec-governance.mdc

## The production plan

Work on this repo follows the production plan: read `docs/production/README.md`
before any phase. It has the start and end checklists, the size budget, the
split rule, the protected files and when to stop and ask the owner.

- One card per phase: `docs/production/phases/<ID>.md`.
- One status file per phase: `docs/production/status/<ID>.md`. Write only your own.
- Changelog fragments go in `changes/<ID>.md` (see `changes/README.md`).
  Never edit `CHANGELOG.md` outside a release phase.
- Never edit `docs/production/progress.md`. A workflow builds it after each merge.
- `scripts/plan-guard.mjs` checks every pull request for protected files.

## House rules

- npm only. Do not use bun or yarn, and do not commit their lockfiles.
- `playground/` and `vscode-extension/` are separate npm packages, each with its
  own `node_modules`. Run `npm ci` inside each one before you build or test it.
- Never edit `src/language/generated/`. Run `npm run langium:generate` instead.
- The playground compiles `src/` from source. After any change under `src/`,
  run `cd playground && npm test && npm run build` too.
- New folders under `src/`, `test/` or `examples/` get a `README.md` that lists
  their files and rules.

## Writing style

Write for a reader whose first language is not English: short sentences, simple
words. This holds for docs, comments, commit messages, status files and pull
requests.
