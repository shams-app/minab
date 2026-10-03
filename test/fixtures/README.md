# Test fixtures

Data files that tests read.

## Files

- `spec-schema.json`: the tables the spec and showcase examples use (`Customer`, `Order`, `Shipment`, `Booking` and more). Same shape as `schema` in a host config. `test/spec-examples.test.ts` uses it to check the examples.

## Rules

- When a spec or showcase example needs a new table or column, add it here.
- Keep it small: only what the examples use.
