# Changelog

All notable changes to Minab are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/) — while the version is `0.x`, minor releases may still change behavior.

The npm package (`@shamsine/minab`, the CLI and language server) and the VS Code extension (`minab-vscode`) are versioned together.

## [0.2.0] - 2026-09-19

The first packaged release. Everything below was built across roadmap Phases 0–8; see [`docs/roadmap.md`](docs/roadmap.md) for the phase-by-phase account and [`docs/status.md`](docs/status.md) for the session log.

### Added

- **The language.** The complete v2 language as a Langium grammar, with the spec ([`docs/query-language-spec.md`](docs/query-language-spec.md), now **Stable**) and a runnable example for every construct ([`docs/showcase.md`](docs/showcase.md)): the pipeline layer (`FROM`/`JOIN`/`WHERE`/`GROUPBY`/`HAVING`/`SELECT`/`ORDERBY`/`LIMIT`), record- and field-level validation rules, the `.`/`^`/`#alias`/`KEY` sigils, a full type system, user functions, `if`/`if!`/`switch`, three loop forms, and `INSERT`/`UPDATE`/`DELETE`.
- **Scope resolution and validation.** Sigil resolution against the spec's scope stack, with diagnostics for misplaced `$`, `KEY`, and unknown `#alias`. Tables, columns, and built-ins come from a host-supplied schema rather than in-file declarations.
- **Type checking.** No implicit coercion, the collection-versus-scalar boundary, multi-hop `ref` traversal, the null-operand rules, and built-in versus `&`-prefixed function disambiguation.
- **Execution.** A hybrid evaluator ([ADR 0001](docs/adr/0001-execution-strategy.md)): the relational layer compiles to parameterized SQL, and everything else is interpreted against the record the host holds. The generated SQL has been run against PostgreSQL 16.
- **The `minab` CLI.** `minab check`, `minab compile`, and `minab run`, driven by a `minab.config.json` that supplies the schema, rule context, record under validation, and data source. Diagnostics print as `file:line:col` with the source line and a caret. `--json` for machine-readable output; `--database` runs the compiled SQL against PostgreSQL (needs the `pg` driver, which is not bundled).
- **Editor support.** A language server (live diagnostics, hover and go-to-definition on `#alias`) shipped in the npm package, and a VS Code extension (`minab-vscode`) with syntax highlighting, distributed as a self-contained `.vsix` with the server bundled in.
- **Examples.** Eleven one-directory-each programs under `examples/`, eight that run against a fixture and three that are check-only.

### Known limitations

- **Not executed yet.** Loops (§9.4), `INSERT`/`UPDATE`/`DELETE` (§10), and `.$index` (§3.5) parse, resolve, and type-check, so `minab check` accepts them, but `minab run` refuses each with an explicit reason rather than returning a wrong answer.
- **A top-level rule that filters a collection doesn't type-check.** `COUNT(.orders[.status == "cancelled"]) < 5` as a bare rule fails with `column "status" needs a statically known table` when `rule.recordTable` is set; the same expression inside `FROM Customer WHERE …` is fine.
- **A `CITEXT` column can't be compared to a string literal without a `CAST`.** Deliberate under the strict no-coercion rule, but awkward in practice; a decision is pending.
- **One schema per language-server session.** The server reads a single `minab.config.json` at startup and shares it across all open documents.
- **Requires Node.js 20.10 or newer.**

[0.2.0]: https://github.com/shams-app/minab/releases/tag/v0.2.0
