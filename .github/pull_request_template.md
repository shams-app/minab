<!-- Phase pull requests: title "[<ID>] <phase title>". See docs/production/README.md, "End of session". -->

## Phase

**ID and title:** [<ID>] <phase title>
**Card:** `docs/production/phases/<ID>.md`

## Summary

What this phase did, in a few short lines.

## Checklist

- [ ] Depends checked: every phase in Depends has `Status: done`
- [ ] Status file written: `docs/production/status/<ID>.md`
- [ ] Changelog fragment written (`changes/<ID>.md`), or not needed because: …
- [ ] No protected file edited outside my card

## Checks run (paste counts)

```
npm run build:
npm test:
playground (npm test, npm run build), if src/ or playground/ changed:
vscode-extension (npm run build), if the grammar, language server or extension changed:
database test, if the card has one:
```
