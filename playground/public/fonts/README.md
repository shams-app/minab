# public/fonts

Self-hosted fonts for the design (W2). Both are SIL Open Font License 1.1.

| File | What it is |
|---|---|
| `Geist-Variable.woff2` | Geist, variable weight, Latin subset |
| `JetBrainsMono-Variable.woff2` | JetBrains Mono, variable weight, Latin subset |
| `JetBrainsMono-Italic-Variable.woff2` | JetBrains Mono italic, variable weight, Latin subset |
| `Geist-OFL.txt`, `JetBrainsMono-OFL.txt` | The licenses |

Rules:
- `@font-face` lives in `src/styles/tokens.css`. Use `font-display: swap`.
- Persian and Arabic names fall back to the system font (see `--font-mono`).
