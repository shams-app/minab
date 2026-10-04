# bench

Recorded numbers that other phases and CI compare with.

## Files

- `bundle.json`: size of each browser bundle, in bytes and gzip bytes (minified). Written by
  `node scripts/browser-bundle.mjs`. Phase Q4 sets the size budget from it.

## Rules

- Do not edit the numbers by hand. Run the script and commit the new file when a size changes on purpose.
- The workflow `.github/workflows/browser-bundle.yml` runs the script and fails when a Node-only module
  is in a browser bundle.
