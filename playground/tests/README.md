# playground/tests

Browser checks for the built website (W4). They run with Playwright against
`npm run preview`, so build first: `npm run build && npm run test:site`.
The unit tests are in `../test` (Vitest).

- `routes.ts` — the list of routes the checks visit.
- `accessibility.spec.ts` — axe checks on every route, in light and dark.
- `smoke.spec.ts` — the landing page loads, an example runs, a tour goal can be met.

Rules:

- Set `CHROMIUM_PATH` to use an already installed Chromium.
- Lighthouse budgets are in `../lighthouserc.json` (`npm run lighthouse`).
- CI runs these in `.github/workflows/site-checks.yml`.
