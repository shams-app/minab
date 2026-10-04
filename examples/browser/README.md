# examples/browser

A small Vite + TypeScript app (no UI framework) that uses Minab the way Shamsine's web app will.
It is its own npm package. It installs Minab from the **packed tarball**, so its tests check what
a user gets from npm. The guide in G1 cites this app.

It has two pages:

- **Form** (`#form`). Fields of an order. The local rule `.end_date > .start_date` needs no data, so it
  runs in a Web Worker on every change, with no network call. The stored rule `order-limit` reads other
  orders, so on submit it goes to the NestJS example (H3) by program id and version. The page shows the
  verdict and the error code, if any.
- **Editor** (`#editor`). A Monaco editor made with one call to `registerMinab` (E5): highlighting, error
  markers, completion, hover and signature help. The editor is loaded only when this page opens.

## Run it

You need Node 22 and a Postgres (see `examples/nestjs/README.md`).

```sh
# 1. The server (the NestJS example)
cd examples/nestjs
npm ci && npm run setup && npm run migrate
npm start                       # http://localhost:3000

# 2. The browser app
cd examples/browser
npm ci
npm run setup                   # npm pack in the repository root, then install the tarball here
npm run dev                     # http://localhost:5173
npx playwright install chromium # once
npm test                        # builds, serves on :4173 and runs the Playwright tests
```

`npm test` starts the NestJS server and the preview by itself if they are not running. Set `MINAB_SERVER`
if the server is not on `http://localhost:3000`.

## Files

- `src/schema.ts`: the schema the browser knows (the NestJS schema plus two dates) and the rule context.
- `src/minab.worker.ts`: the worker. It only imports `@shamsine/minab/browser/worker`.
- `src/minab.ts`: `createWorkerMinab`, `createRemoteMinab` and `routeByTier`, made once.
- `src/form.ts`: page 1. `src/editor.ts`: page 2. `src/main.ts`: the two pages and their route.
- `vite.config.ts`: proxies `/minab` to the server, so the page and the server share one origin (no CORS).
- `tests/browser.spec.ts`: the Playwright tests. `scripts/setup.mjs`: the packed install.

## How it works

1. **Prepare in the worker.** `router.prepare({ id, version, source })` checks the source in the worker and reads
   its analysis. Tier `local` means the rule needs no data. Tier `data` means it does.
2. **Local rule.** `run` stays in the worker. The tests check that the page sends no request to `/minab`.
3. **Delegated rule.** `run` sends `{ ref: { id, version } }` and the record fields the rule reads
   (`analysis.recordFields`) in one wire v1 request. The body has no SQL, no schema and no program text (D28, D34).
   The server runs its stored program with its own data port.
4. **Editor.** `registerMinab(monaco, { client, ruleContext })`. Everything that needs the parser runs in the
   same worker. `autoClosingBrackets` is off here only so the tests type predictable text.

The stored program text in `src/form.ts` must match the server's `order-limit` v1. The browser uses it to
learn the tier. The server never takes it from the browser.

## Rules

- Install Minab only from the tarball (`npm run setup`). Never link `../..` or import from `src/`.
- This folder is not in the npm package (`files` in the root `package.json`).
- `test/examples.test.ts` ignores this folder: it has no `browser.minab` program.
- Chromium only. Firefox and WebKit are a later task.
