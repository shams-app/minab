# `PreparedProgram.compileGroupExpression`

Turns a prepared **group expression** (spec §4.2.1, phase P1) into **one SQL expression**. The host puts it inside its
own `SELECT … GROUP BY …`, so the database computes the value for every group of the statement: each cell, each
subtotal and the grand total. Added in phase P2.

```ts
compileGroupExpression(options: CompileExpressionOptions): CompileExpressionResult

interface CompileExpressionOptions {
    column: (name: string) => string;
}

type CompileExpressionResult =
    | { ok: true; sql: string }
    | { ok: false; error: MinabError };
```

Both types are exported from `@shamsine/minab`.

## Example

```ts
import { createMinab } from '@shamsine/minab';

const minab = createMinab({ schema });
const prepared = await minab.prepare('SUM(.Revenue) - SUM(.Cost)', {
    ruleContext: { isFieldRule: false, groupTable: 'Sale' }
});
const result = prepared.compileGroupExpression({ column: name => 'b.' + name.toLowerCase() });
// { ok: true, sql: 'CAST((SUM((b.revenue)) - SUM((b.cost))) AS numeric)' }
```

## `column(name)`

- Returns the host's SQL for one column of the group row, for example `b.v_3` or `(b.price)::numeric`.
- `name` is a column name of `groupTable` as the schema writes it (`Revenue`, `Total cost`, `مبلغ`). Minab never calls
  it with any other name, and it calls it once for each column the expression reads.
- Minab puts the answer in parentheses. Minab never writes a table or column name itself.
- The answer is **trusted**: it goes into the fragment as it is. Build it from your own query, never from user text
  (`docs/security.md`, host rule 13).

## The fragment

| Minab | SQL |
|---|---|
| `SUM(x)`, `MIN(x)`, `MAX(x)` | `SUM(<x>)`, `MIN(<x>)`, `MAX(<x>)` |
| `AVG(x)` | `SUM(<x>)` divided by `COUNT(<x>)` with Minab's `/` rule (16 decimals), so it equals the interpreter to the last digit |
| `COUNT(.)`, `COUNT(x)` | `COUNT(*)`, `COUNT(<x>)` |
| `a / b`, `a % b`, `a \ b` | the divisor is `NULLIF(<b>, 0)`: a zero divisor gives `NULL` |
| `if`, `switch` | `CASE … END` |
| `==`, `!=` | `IS NOT DISTINCT FROM`, `IS DISTINCT FROM` |
| a number literal | exact decimal text: `1000`, `2.5`, `(-3)` |
| a text literal | quoted, with `'` doubled: `'it''s'`. Text with `\` uses `E'…'` with `\` doubled too |
| `null`, `true`, `false` | `NULL`, `TRUE`, `FALSE` |

- **Type.** A number answer is `numeric` (the fragment is wrapped in `CAST(… AS numeric)`): exact, never a float, never
  rounded. A `COUNT(…)` alone is `bigint`. A text answer is `text`, a yes/no answer is `boolean`. Cast or round in your
  own `SELECT` if you need to.
- **No parameters.** The fragment has no `$1`, so it fits a statement that has its own parameters.
- **No statement text.** The fragment never has `SELECT`, a subquery, `;`, `--` or `/*` outside its text literals.
- **The clock.** `NOW()` and `TODAY()` in a fragment are written when you call `compileGroupExpression`, with the
  system clock in **UTC**. `run` uses the clock and the time zone of the run instead. So near midnight `TODAY()` in
  Asia/Tehran can be a day later in `run` than in the fragment. If your expression reads the date, run it with `run`
  over `groupRows`, or avoid `NOW()` and `TODAY()` in a stored group expression. A clock option for the fragment is on
  the post-1.0 list.

## Errors

| `error.code` | When |
|---|---|
| `compile.notGroupExpression` | The program was not prepared with `ruleContext.groupTable`. Use `compile()` for it. |
| `compile.programHasErrors` | The group expression has errors (for example `aggregate.fieldOutsideAggregate`). |
| `compile.nothingToCompile` | The program has no expression. |
| `compile.notSql` | A part has no SQL form here, for example a host input such as `currentUser` (there is no value for it when the SQL is built). Run the program with `run({ groupRows })` instead. |

It never throws for a bad program. It throws only if your `column()` throws.
