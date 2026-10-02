# Decisions

Every question the owner must answer for Minab to reach production. Each one has options, a **recommended** answer, the reason, and (for language questions) a concrete example. Phase **A2** (the decision sitting) walks through all of them. You can answer "accept all recommendations except D13, D21" and talk only about the exceptions.

**How a language decision works with the spec-governance rule.** `.cursor/rules/spec-governance.mdc` asks for proposal → example → approval → implementation. For every language decision below, the text is the proposal and the example is the concrete example. Your answer is the approval. The phase that implements it does not ask again, unless it needs something the decision does not cover.

**How to record an answer.** Replace `_(open)_` after **Answer:** with the chosen option, your words if any, and the date. Example: `**Answer:** (a), but use "Asia/Tehran" as the default time zone — 2026-10-03`. To postpone a question to its phase, write `**Answer:** ask at phase L6`. The progress tool counts open answers.

**Groups:** [Product and process](#product-and-process) (D01–D09) · [Language](#language) (D10–D26) · [Runtime and hosts](#runtime-and-hosts) (D27–D39) · [Website and launch](#website-and-launch) (D40–D45)

---

## Product and process

<a id="d01"></a>
### D01 — Who writes Minab programs, where are they kept, where do they run?

**Blocks:** R1, Q3, G2

**What we already know (from the Shamsine repo).** In Shamsine, *app builders* (Shamsine's users, not Minab developers) write Minab in the browser: in the form and page designer (`{ value, bound }` settings), in filter conditions (`minab` operands) and later in commands. Shamsine stores the source in MongoDB with the view or field. `core/service` (NestJS) checks it on save. It runs in the browser (expressions that only read the current record) and in `core/service` (expressions that read other records), against Dynodb: Postgres, one database per application.

**Options.**
- (a) **Confirm this picture. Recommended.** Every program is untrusted input: limits are always on, the server never accepts SQL or a schema from a browser, and the schema given to a program is its whole read surface.
- (b) Programs are written only by trusted developers and reviewed in a repository. (Then Q3's limits and the run-by-id endpoint could be lighter.)

**Answer:** _(open)_

<a id="d02"></a>
### D02 — What must be ready for the TV launch?

**Blocks:** nothing directly; it sets **priority** between lanes, and V4 checks it.

**Question.** "We go live on TV": is that Shamsine (with Minab inside it), the Minab website, or both? And which Minab version is the minimum?

**Options.**
- (a) **Shamsine launches on Minab 0.3.x plus the security (Q3) and performance (Q4) phases; the website launches with 1.0. Recommended.** 0.3.0 has everything Shamsine needs (runtime in browser and NestJS, analysis, Monaco, Unicode names, built-ins, dates). Statements, loops and writes (lane X) follow before 1.0. Run lanes R, H, E5, L3, L5, L6, C, Q3 and Q4 first.
- (b) Everything waits for 1.0.
- (c) Shamsine launches without Minab evaluation (expressions stored only) and adds it later.

**Answer:** _(open)_

<a id="d03"></a>
### D03 — What goes into the first public release?

**Blocks:** V1, Q2

**Context.** `0.2.0` was packaged on 2026-09-19 but never published (`npm view @shamsine/minab` is a 404, there is no `v0.2.0` tag). It has known wrong answers (`CAST` does nothing in the interpreter, text `+` cannot run, a top-level collection filter does not check).

**Options.**
- (a) **Fix first. Recommended.** The first published version is `0.2.0` and contains: `&` removed (L1), the correctness fixes (C1–C8), CI (Q1) and release automation (Q2). Nobody ever installs the wrong answers.
- (b) Publish `0.2.0` now, as it is, with the bugs listed as known limitations, and fix them in `0.2.1`.

**Answer:** _(open)_

<a id="d04"></a>
### D04 — Where is Minab published, and is the repository public?

**Blocks:** Q2, V1, E4

**Questions and recommendations.**
1. **npm:** publish `@shamsine/minab` publicly. You need an npm organization named `shamsine` (free for public packages). *Is it yours?*
2. **Repository visibility:** make `shams-app/minab` **public** before V1. npm **provenance** (a signed link from the package to the commit that built it) needs a public repository, and the website and Marketplace pages link to the source. If it must stay private: publish without provenance.
3. **VS Code Marketplace:** publisher `shamsine` (created in Azure DevOps; the extension already uses that name). *Is it yours?*
4. **Open VSX** (used by Cursor, VSCodium and other VS Code forks): also publish there, namespace `shamsine`. **Recommended**, because Cursor users cannot install from the Microsoft Marketplace.
5. **Secrets the workflows need:** npm trusted publishing (no token) or `NPM_TOKEN`; `VSCE_PAT`; `OVSX_PAT`.

**Answer:** _(open)_

<a id="d05"></a>
### D05 — A `next` prerelease channel?

**Blocks:** Q2

**Options.**
- (a) **Yes. Recommended.** Every merge to `main` that changes the package publishes `X.Y.Z-next.N` under the npm tag `next`. Shamsine can integrate early (for example right after R4) without waiting for a release. `npm install @shamsine/minab` still gets only real releases.
- (b) No: only tagged releases.

**Answer:** _(open)_

<a id="d06"></a>
### D06 — Which Node.js versions?

**Blocks:** Q1, H1

**Context.** `engines` says `>=20.10.0`, but **Node 20 reached end of life on 2026-04-30**. Node 22 is in maintenance until 2027-04-30, Node 24 is the active LTS. Node 22.12+ can `require()` an ES module without a flag. Shamsine uses Bun as well.

**Options.**
- (a) **`engines: >=22.12.0`; CI on Node 22 and 24; a Bun smoke test for the package (H1). Recommended.**
- (b) Keep `>=20.10.0` and add Node 20.10 to CI (the old plan). Not recommended: a production 1.0 should not promise an unsupported runtime.

**Answer:** _(open)_

<a id="d07"></a>
### D07 — One package manager

**Blocks:** Q1

**Options.**
- (a) **npm only. Recommended.** CI already uses `npm ci` and `package-lock.json`. Delete `bun.lock` and `playground/bun.lock`, and ignore them in `.gitignore`.
- (b) Keep both lockfiles (they drift; one is already stale).

**Answer:** _(open)_

<a id="d08"></a>
### D08 — Formatter and linter

**Blocks:** B1

**Options.**
- (a) **Prettier + ESLint (typescript-eslint with type-aware rules such as `no-floating-promises`, `no-misused-promises`, `await-thenable`). Recommended.** The interpreter is async everywhere, and a forgotten `await` is a real bug class. Prettier is set to today's style (4 spaces, single quotes, semicolons), so the one-time format is small. It runs once, in B1, before the parallel lanes start.
- (b) No tools; write that down so it stops being an open question.

**Answer:** _(open)_

<a id="d09"></a>
### D09 — Approved new dependencies

**Blocks:** C1, C2, B1, H1, H2, H3, H6, Q3, E4, G1, W4

**Recommended list.** Any dependency not on this list needs a question to the owner first.

| Package | Kind | Used by | Why |
|---|---|---|---|
| `big.js` | **runtime dependency** | C2 | Exact `DECIMAL` arithmetic (about 6 KB, no dependencies, MIT) |
| `@electric-sql/pglite` | dev (root) | C1 | Real Postgres in-process for tests, no setup (the playground already uses it) |
| `prettier`, `eslint`, `typescript-eslint` | dev | B1 | D08 |
| `fast-check` | dev | Q3 | Property-based (fuzz) tests |
| `esbuild` | dev (root) | H1 | The CommonJS bundle (the extension already uses esbuild) |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/testing`, `rxjs`, `reflect-metadata` | dev + **optional peer** | H2 | The NestJS module and its tests |
| `pg` | **optional peer** (already dev) | H1 | Postgres data port |
| `monaco-editor` | **optional peer** (types as dev) | E5 | Monaco integration |
| `typedoc` | dev | G1 | API reference |
| `@vscode/test-electron` | dev (extension package) | E4 | Extension smoke test |
| `@playwright/test` | dev (`examples/browser`, `playground`) | H6, E5, W4 | Browser tests |
| `@lhci/cli`, `@axe-core/playwright` | dev (`playground`) | W4 | Lighthouse and accessibility checks |
| NestJS, TypeORM, `pg`, Jest, `supertest` | `examples/nestjs` own package | H3 | The example app (TypeORM because Shamsine's Dynodb uses it) |

**Answer:** _(open)_

---

## Language

<a id="d10"></a>
### D10 — Built-in functions and user functions, without `&`

**Blocks:** L1 (and every new built-in: L5, L6, L7; host functions: R3)

**Context.** Decided on 2026-09-24: user functions are called `name(...)`, like built-ins, and `&` leaves the language. Open: with no `&`, how do we stop a *future* built-in from breaking a program that already has a `fn` with that name? L5 and L6 add about 20 built-ins.

**Options.**
- (a) **A case rule. Recommended.** Built-in names are ALL UPPERCASE (like `FROM`, `CAST`, `COUNT`). A user `fn` name (and a host function name, D27) **must contain at least one lowercase letter**. A new built-in can never collide with existing code, and you can still see at a glance which calls are built-in. Every `fn` in the spec, showcase, examples, playground and tests already follows it.
- (b) Reserve a list of names now (today's eight plus the planned library). Any built-in added later is a breaking change.
- (c) A `fn` may shadow a built-in, with a warning. Nothing breaks, but `SUM(...)` can mean different things in different files.

**Example (recommended):**
```
fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL {
    total - total * rate / 100
}

discounted(.total, 15) > 100        // was: &discounted(.total, 15) > 100

fn SUM(x: INTEGER): INTEGER { x }   // error: a function name needs a lowercase letter; ALL-CAPS names are kept for built-ins
fn TAX(x: DECIMAL): DECIMAL { x }   // error: same rule
fn tax(x: DECIMAL): DECIMAL { x }   // fine
foo(1)                              // error: unknown function "foo"
```

**Answer:** _(open)_

<a id="d11"></a>
### D11 — May other names be the same as a function name?

**Blocks:** L1

**Context.** Functions are not values in Minab (spec §8), so a name before `(` can only be a function. The question is readability: without `&`, `total` and `total(...)` look related.

**Options.**
- (a) **An error. Recommended.** A `let`, a parameter or a host input (D27) may not have the name of a declared `fn` in scope. A `fn` may not have the name of a table in the schema.
- (b) A warning only.
- (c) Allowed.

**Example (recommended):**
```
fn total(a: DECIMAL): DECIMAL { a }
let total: DECIMAL = 5;                       // error: "total" is the name of a function
fn check(total: DECIMAL): BOOLEAN { true }    // error: parameter "total" has a function's name
fn Customer(): INTEGER { 1 }                  // error: "Customer" is a table name
```

**Answer:** _(open)_

<a id="d12"></a>
### D12 — Names in other languages, and names with spaces

**Blocks:** L3, G2

**Context.** Names today are ASCII only: `[a-zA-Z_][a-zA-Z0-9_]*`. In Shamsine, a field or dataset name is **any non-empty string** (`z.string().min(1)`), and Dynodb uses it directly as the Postgres column name. Users write Persian, Arabic and Turkish names, often with spaces. Today they cannot reference those fields at all.

**Options.**
- (a) **Unicode names plus backtick-quoted names. Recommended.**
  - A plain name may use any Unicode letter, digit (not first) and `_`. The zero-width non-joiner (U+200C, used inside Persian words) and zero-width joiner (U+200D) are allowed inside a name, not at its start.
  - Any other name is written in backticks: `` `Order date` ``. Inside backticks, `` \` `` is a backtick and `\\` is a backslash. Backticks also allow a keyword as a name (`` .`FROM` ``).
  - The schema may give a table or column a **physical name** (`sqlName`) when the database name differs from the Minab name. Shamsine does not need it (field name = column name), but other hosts do.
- (b) Only backtick-quoted names (ASCII plain names stay as today).
- (c) The host maps every field to an ASCII "API name"; Minab stays ASCII.

**Example (recommended):**
```
// schema: table سفارش with columns مبلغ (DECIMAL) and وضعیت (TEXT)
FROM سفارش
WHERE .وضعیت == "ارسال‌شده" AND .مبلغ > 100
SELECT .مبلغ AS مبلغ_کل

// names with spaces or symbols use backticks
.`Order date` <= .`Ship date`
COUNT(.`Line items`[.qty > 10]) > 0

// Turkish
.İl == "İzmir"
```

**Answer:** _(open)_

<a id="d13"></a>
### D13 — Does `+` join text?

**Blocks:** C4

**Context.** The checker accepts `"a" + "b"`, but neither runtime can run it (the interpreter throws "expected a number"; the SQL `+` fails in Postgres).

**Options.**
- (a) **Yes: `+` joins two texts. Recommended.** Both sides must be text (`TEXT` or `CITEXT`); the result is `TEXT` (nullable if either side is). A number needs an explicit `CAST` (no implicit coercion). A `null` side gives `null`, like SQL. Compiles to `||`.
- (b) No: `+` is numbers only; the checker rejects text `+` with a message that names the alternative (a `CONCAT` function would then be added in L5).

**Example (recommended):**
```
.first_name + " " + .last_name          // "Ada Lovelace"
"Order " + CAST(.number AS TEXT)        // a number needs CAST
"a" + null                              // null
"a" + 1                                 // error: + needs two numbers or two texts
```

**Answer:** _(open)_

<a id="d14"></a>
### D14 — Division and `%`

**Blocks:** C4

**Context.** Today the interpreter gives `7 / 2 = 3.5`, Postgres on two integer columns gives `3`. `5 % 0` is `null` in the interpreter and an error in Postgres. The spec says nothing.

**Options.**
- (a) **Recommended.**
  - `/` always gives a `DECIMAL`, even for two `INTEGER`s (low-code users expect `7 / 2` to be `3.5`). Integer division is `FLOOR(a / b)` (FLOOR comes in L5).
  - The result of `/` has 16 digits after the point, rounded half away from zero, in **both** runtimes (C4 finds the SQL form that guarantees this and proves it in the differential test).
  - `%` keeps the sign of the left side (Postgres and JavaScript already agree on this).
  - Division or `%` by zero is an evaluation error (`eval.divisionByZero`) in both runtimes.
- (b) Integer `/` for two integers (SQL style), decimal otherwise.

**Example (recommended):**
```
7 / 2           // 3.5
FLOOR(7 / 2)    // 3
1 / 3           // 0.3333333333333333
-7 % 3          // -1
5 / 0           // error: division by zero
```

**Answer:** _(open)_

<a id="d15"></a>
### D15 — `CITEXT` compared with text

**Blocks:** C5

**Context.** `.email == "ada@example.com"` on a `CITEXT` column is rejected today (no implicit coercion), so every case-insensitive comparison needs `CAST(... AS CITEXT)`. Phase 4 decided the same shape the other way for numbers ("`INTEGER` and `DECIMAL` are one numeric family").

**Options.**
- (a) **`TEXT` and `CITEXT` are one text family. Recommended.** They compare without `CAST` (`==`, `!=`, `IN`, `<`…, `LIKE`). When either side is `CITEXT`, the comparison ignores case. (The compiler must cast the text side to `citext` in SQL, because Postgres would otherwise compare `citext = text` case-sensitively.)
- (b) Keep the strict rule and the `CAST`.

**Example (recommended):**
```
// .email is CITEXT
.email == "Ada@Example.COM"     // true for "ada@example.com"
.email LIKE "%@EXAMPLE.com"     // ignores case
.name == .email                 // TEXT vs CITEXT: allowed, ignores case
```

**Answer:** _(open)_

<a id="d16"></a>
### D16 — Exact `CAST` rules

**Blocks:** C3

**Context.** The interpreter's `CAST` returns its value unchanged today. The spec (§5.5) says a narrowing cast "truncates or rounds" without choosing.

**Options.**
- (a) **Follow Postgres for every cast both runtimes support. Recommended.**
  - `DECIMAL` → `INTEGER` rounds half away from zero (`3.5` → `4`, `-3.5` → `-4`).
  - Text → number trims spaces, then must be a valid number, or the run fails with `eval.castFailed`.
  - `DECIMAL` → `TEXT` gives the shortest exact form: no trailing zeros, no exponent (`2.50` → `"2.5"`; SQL uses `trim_scale`).
  - Text → `BOOLEAN` accepts Postgres's words: `true/false`, `t/f`, `yes/no`, `y/n`, `on/off`, `1/0`, any case.
  - Text → `DATE`/`TIME`/`DATETIME` accepts ISO 8601 only (`2026-10-02`, `08:30:00`, `2026-10-02T08:30:00Z`).
  - `CAST(null AS T)` is `null`.
- (b) Truncate `DECIMAL` → `INTEGER` (like JavaScript `Math.trunc`). The SQL side then needs `trunc()`.

**Example (recommended):**
```
CAST(3.5 AS INTEGER)       // 4
CAST(" 12 " AS INTEGER)    // 12
CAST("12a" AS INTEGER)     // error: cannot cast "12a" to INTEGER
CAST(5 AS TEXT) == "5"     // true
CAST(2.50 AS TEXT)         // "2.5"
CAST("yes" AS BOOLEAN)     // true
```

**Answer:** _(open)_

<a id="d17"></a>
### D17 — Exact decimals and the integer range

**Blocks:** C2 (and the wire format R6)

**Context.** The interpreter uses JavaScript numbers, so `0.1 + 0.2 == 0.3` is `false` there, while Postgres `numeric` is exact. Shamsine stores money (`currency`) as `DECIMAL`. A wrong cent on TV is a bad day.

**Options.**
- (a) **Exact decimals. Recommended.**
  - `DECIMAL` values are exact in the interpreter (`big.js`, D09).
  - Values leave Minab (run results, `--json`, the wire format) as **strings**: `"0.3"`. `INTEGER` stays a JSON number.
  - `INTEGER` is a whole number in the safe JavaScript range (±9,007,199,254,740,991). Going outside it is an evaluation error (`eval.integerOutOfRange`), never a silent wrong value.
  - Numbers inside `JSON` values stay JSON numbers (normal JSON behavior).
- (b) Keep JavaScript numbers and write the precision limits into the spec.

**Example (recommended):**
```
0.1 + 0.2 == 0.3            // true in both runtimes
.price * .quantity          // exact; returned as "24.90"
9007199254740991 + 1        // error: integer out of range
```

**Answer:** _(open)_

<a id="d18"></a>
### D18 — `ORDERBY` on something that is not a `SELECT` alias

**Blocks:** C8

**Context.** It compiles and runs today (`ORDER BY "Order"."total"`), but the roadmap and ADR 0001 describe "ORDERBY by select alias" only.

**Options.**
- (a) **Allowed: `ORDERBY` takes any expression over the source row, or a `SELECT` alias. Recommended.** Write it into spec §4.1 and pin it with a test.
- (b) Only aliases: make the checker reject other expressions.

**Example (recommended):**
```
FROM Order
SELECT .id AS id, .total AS total
ORDERBY .created_at DESC        // allowed: a column that is not selected
```

**Answer:** _(open)_

<a id="d19"></a>
### D19 — `LOG` for debugging

**Blocks:** L7

**Options.**
- (a) **Recommended.**
  - `LOG(value)` or `LOG(value, label)` is an **expression**: it records the value and returns it unchanged, so it can wrap any part of a rule.
  - One level only (no `WARN`/`ERROR`).
  - A bare call may stand alone as a statement: `LOG(x);` (this also serves host functions later).
  - Inside a part that runs as SQL, `LOG(x)` compiles as plain `x` and the checker gives a **warning** ("this LOG runs in the database and will not print").
  - The CLI prints logs to **stderr** as `file:line:col label: value` (stdout stays clean for `--json`). `--no-logs` turns them off.
  - The playground shows them in a **Console** tab.
- (b) A `PRINT`/`DEBUG` name, or a variadic `LOG("label", a, b)`.

**Example (recommended):**
```
LOG(COUNT(.orders[.status == "cancelled"]), "cancelled") < 5

fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL {
    let cut: DECIMAL = LOG(total * rate / 100, "cut");
    LOG(cut);
    total - cut
}
```
CLI stderr: `rule.minab:1:1 cancelled: 2`

**Answer:** _(open)_

<a id="d20"></a>
### D20 — Built-in library, part 1: text, null and numbers

**Blocks:** L5

**Context.** Minab has eight built-ins, all aggregates or predicates. Real rules need text and number helpers. Names follow D10 (ALL CAPS) and Postgres where possible. Unless stated, a `null` argument gives `null`.

**Recommended list:**

| Function | Types | Notes |
|---|---|---|
| `LOWER(s)`, `UPPER(s)` | text → same type | Unicode default case mapping (not locale-specific) |
| `TRIM(s)` | text → same type | Removes spaces, tabs and line breaks at both ends |
| `LENGTH(s)` | text → `INTEGER` | Counts characters (Unicode code points), like Postgres `char_length` |
| `SUBSTRING(s, start, length?)` | text, `INTEGER`, `INTEGER` → text | 1-based, like SQL |
| `REPLACE(s, from, to)` | text → text | Replaces every match |
| `STARTS_WITH(s, part)`, `ENDS_WITH(s, part)`, `CONTAINS(s, part)` | text → `BOOLEAN` | Ignore case when either side is `CITEXT` |
| `COALESCE(a, b, …)` | same type (numbers may mix) → that type | First non-null; not null if the last argument is not nullable |
| `ROUND(n, digits?)` | number → same type | Half away from zero; `digits` defaults to 0 |
| `ABS(n)` | number → same type | |
| `FLOOR(n)`, `CEIL(n)` | number → `INTEGER` | |
| `GREATEST(a, b, …)`, `LEAST(a, b, …)` | orderable, same type → that type | Ignore `null`s, like Postgres; `null` only if all are `null` |

- (a) **This list. Recommended.**
- (b) A shorter or longer list (say which).

**Example:**
```
LENGTH(TRIM(.name)) >= 2
STARTS_WITH(.sku, "BR-")
ROUND(.total * 1.09, 2)
COALESCE(.nickname, .name)
```

**Answer:** _(open)_

<a id="d21"></a>
### D21 — Built-in library, part 2: dates, times and time zones

**Blocks:** L6, R3 (clock port)

**Recommended rules:**
- `DATETIME` is an **instant** (like Postgres `timestamptz`). `DATE` and `TIME` have no time zone.
- Every run has a **time zone** from the host's clock port (an IANA name such as `Asia/Tehran`; default `UTC`). Shamsine passes the user's zone.
- `NOW()` is the instant the run started; every `NOW()` in one run returns the same value. In SQL it is a bound parameter, not the database's `now()`, so both runtimes agree and tests are repeatable.
- Values cross JSON as ISO 8601 strings: `"2026-10-02"`, `"08:30:00"`, `"2026-10-02T08:30:00.000Z"`.

**Recommended functions:**

| Function | Types | Notes |
|---|---|---|
| `NOW()` | → `DATETIME` | |
| `TODAY()` | → `DATE` | The date of `NOW()` in the run's time zone |
| `YEAR(d)`, `MONTH(d)`, `DAY(d)` | `DATE`/`DATETIME` → `INTEGER` | `DATETIME` is read in the run's time zone |
| `HOUR(t)`, `MINUTE(t)` | `TIME`/`DATETIME` → `INTEGER` | |
| `DATE_ADD(d, n, unit)` | → same type as `d` | Units `"year"`, `"month"`, `"week"`, `"day"`; plus `"hour"`, `"minute"`, `"second"` for `DATETIME`. Month ends clamp (Jan 31 + 1 month = Feb 28/29), like Postgres. Day units on `DATETIME` follow the run's time zone (daylight-saving safe) |
| `DATE_DIFF(a, b, unit)` | → `INTEGER` | Whole units from `b` to `a`, truncated toward zero |
| `CAST(dt AS DATE)` | `DATETIME` → `DATE` | Uses the run's time zone |

The unit must be a text literal; the checker rejects unknown units. Jalali (Persian) calendar display is the host's job, not Minab's.

- (a) **These rules and functions. Recommended.**
- (b) Changes (say which).

**Example:**
```
.due_date < TODAY()
DATE_DIFF(TODAY(), .paid_on, "day") > 30
DATE_ADD(.start, 1, "month") > .end
YEAR(.created_at) == 2026
```

**Answer:** _(open)_

<a id="d22"></a>
### D22 — `KEY` when `GROUPBY` has several keys

**Blocks:** L4 (the grammar part), X2

**Context.** `GROUPBY .status, .customer SELECT KEY …` is refused today ("no single SQL form"). The spec does not say what `KEY` is with two keys.

**Options.**
- (a) **`KEY` is a record of the keys. Recommended.** A `GROUPBY` key may take a name with `AS` (a small grammar addition, done in L4). With several keys, `KEY.<name>` reads one key; a key that is a plain field path is also reachable by its last field name. A computed key with no name is an error ("give this group key a name with AS"). With one key, nothing changes: `KEY` is the key itself.
- (b) A tuple: `KEY[0]`, `KEY[1]` (reuses tuple access, but `[0]` is the known `[...]` ambiguity of §12 item 4).
- (c) Keep refusing multi-key `KEY`.

**Example (recommended):**
```
FROM Order
GROUPBY .status, .customer.country AS country
SELECT KEY.status AS status, KEY.country AS country, COUNT(.) AS orders
```

**Answer:** _(open)_

<a id="d23"></a>
### D23 — A user function inside a query

**Blocks:** X2

**Options.**
- (a) **Inline simple functions into the SQL; reject the rest when checking. Recommended.** A function whose body is a single expression (no statements, no recursion, no host functions, no queries) is inlined into the compiled SQL. Any other function used inside a query clause is a **check** error (`query.functionNotInlinable`), so `check` tells the truth before anything runs.
- (b) Run the query row by row in the interpreter when it calls a user function (slow; overlaps with lane X).

**Example (recommended):**
```
fn net(total: DECIMAL): DECIMAL { total * 0.9 }

FROM Order WHERE net(.total) > 100 SELECT .id AS id
// compiles to: WHERE ("Order"."total" * $1) > $2
```

**Answer:** _(open)_

<a id="d24"></a>
### D24 — The rest of spec §12

**Blocks:** L4

**Recommended answers**, item by item:

| §12 item | Recommended answer |
|---|---|
| 1. `CurrentRecord` AST shape | Close as confirmed (the evaluator uses it as is) |
| 2. `NOT` precedence | Keep: `NOT x == y` means `NOT (x == y)` |
| 3. `IN` / `LIKE` chaining | Keep non-chaining: `a < b < c` is an error |
| 4. `[...]` list vs. `[...]` filter | Keep both forms; document how to read them; keep the known Chevrotain warning unless a small grammar change removes it without changing any program |
| 8. A second `let` with the same name | An error in the same scope; allowed (shadowing) in an inner block |
| 13. `const` | Not in 1.0 (moved to the post-1.0 list) |
| 17. `!` on a `collection` step | A check error (`type.vivifyOnCollection`) |

- (a) **These answers. Recommended.**
- (b) Changes (say which item).

**Example (item 8):**
```
let x: INTEGER = 1;
let x: INTEGER = 2;              // error: "x" is already declared here
if .vip { let x: INTEGER = 3; x } else { x }     // fine: inner block
```

**Answer:** _(open)_

<a id="d25"></a>
### D25 — Compare a relation with a key directly

**Blocks:** L4

**Context.** `.customer == customerId` is a type error today; programs must write `.customer.id == customerId`. Phase 5 added `primaryKey` to the schema, so the blocker Phase 4 found is gone.

**Options.**
- (a) **Allowed. Recommended.** A `ref` compares (`==`, `!=`, `IN`) with a value of its target's primary-key type. It compiles to the foreign-key column (`"Order"."customer_id" = $1`), with no join.
- (b) Keep the long form only.

**Example (recommended):**
```
.customer == customerId
.customer IN [idA, idB]
```

**Answer:** _(open)_

<a id="d26"></a>
### D26 — Writes: safety, rules and transactions

**Blocks:** X5, X6

**Recommended rules:**
- `minab run` on a program that writes is a **dry run by default**: it prints the statements it would run and changes nothing. `--apply` writes.
- A **validation rule** (record or field rule) may **not** write. Writing is only for programs a host runs on purpose (for example a Shamsine command). The checker rejects `INSERT`/`UPDATE`/`DELETE` and record path assignment inside a rule.
- **One run is one transaction.** All writes of a run succeed together or none do. The host may hand in its own transaction (for example the request's TypeORM `QueryRunner`).

- (a) **These rules. Recommended.**
- (b) Changes (say which).

**Example (CLI):**
```console
$ minab run order-dml.minab
dry run: 2 statements, nothing written (use --apply to write)
  UPDATE "Order" SET "status" = $1 WHERE "Order"."id" = $2   -- ["shipped", "o-104"]
  INSERT INTO "Shipment" ("order_id", "carrier") VALUES ($1, $2)   -- ["o-104", "DHL"]
```

**Answer:** _(open)_

---

## Runtime and hosts

<a id="d27"></a>
### D27 — Host inputs and host functions

**Blocks:** R1, R3

**Context.** Shamsine needs values Minab source cannot name today: the current user, URL parameters, the time (`now`, D21), and later its own functions (for example a currency rate).

**Options.**
- (a) **Recommended.**
  - **Host inputs:** the host declares typed, read-only names (scalar, array or record of typed fields; no relations), for example `currentUser: { id: TEXT, email: CITEXT, roles: TEXT[] }` and `url: JSON`. A program reads them by bare name. Values are given at run time.
  - **Host functions:** the host declares typed functions (`fxRate(from: TEXT, to: TEXT): DECIMAL`) and implements them. They run in the interpreter only, never inside SQL. A host function is marked `local` when it is safe in the browser; otherwise a program using it needs the server (tier `data`).
  - Names follow D10 (contain a lowercase letter) and D11 (a `let`, parameter or `fn` may not reuse them).
- (b) Host functions only (`currentUser()` instead of `currentUser`).

**Example (recommended):**
```
.owner_id == currentUser.id
"admin" IN currentUser.roles
.total * fxRate("EUR", .currency) > 1000
let currentUser: TEXT = "x";      // error: "currentUser" is a host input
```

**Answer:** _(open)_

<a id="d28"></a>
### D28 — What the data port carries

**Blocks:** R1

**Options.**
- (a) **SQL text plus parameters, as today. Recommended.** It is right on a server and with an in-browser database (PGlite). A browser **never** sends SQL to a server: when a browser program needs server data, the browser sends the program's **id and inputs**, and the server runs it itself (D34). A structured, non-SQL data request is written into ADR 0002 as the upgrade path, not built.
- (b) A structured data request (table, filters, projection), safe to send from a browser. The SQL compiler splits into a request builder and a SQL emitter: a large change to every pushdown.

**Answer:** _(open)_

<a id="d29"></a>
### D29 — When the schema is loaded

**Blocks:** R1, R2

**Options.**
- (a) **Up front, cached by version. Recommended.** The host gives the whole schema before `prepare`, with a `version` string (Shamsine: a hash of the datasets' fields). Checking stays synchronous and fast (an editor checks on every key press). The runtime caches language services per schema version.
- (b) Load names on demand (async per name): makes checking async and slow.

**Answer:** _(open)_

<a id="d30"></a>
### D30 — Where programs run

**Blocks:** R1, H5

**Options.**
- (a) **Recommended.** The browser prepares and checks every program in a Web Worker and **runs programs that need no data** there (tier `local`, from analysis R5). Programs that need data run on the server (tier `data`), called by program id. No offline run of data programs in the browser for 1.0 (PGlite stays for the playground and demos).
- (b) Always on the server (simpler, but every key press in a form becomes a network call).
- (c) Always in the browser (needs option (b) of D28).

**Answer:** _(open)_

<a id="d31"></a>
### D31 — Packaging

**Blocks:** R1, R2

**Options.**
- (a) **One package with entry points (subpaths) and optional peer dependencies. Recommended.** `@shamsine/minab` (the runtime, no environment), `/node`, `/nestjs`, `/browser`, `/browser/worker`, `/browser/pglite`, `/monaco`, `/lsp`, `/host`. `pg`, NestJS, PGlite and Monaco are optional peers: you install only what you use. The CLI stays the package's `bin`.
- (b) Several packages (`@shamsine/minab-nestjs`, …); needs npm workspaces, which this repo has avoided.

**Answer:** _(open)_

<a id="d32"></a>
### D32 — ES modules and CommonJS

**Blocks:** H1

**Context.** Minab and Langium are ES modules only. NestJS projects compile to CommonJS by default, and **Jest** (Shamsine's `core/service` end-to-end tests) cannot load ES-only packages without extra setup, on any Node version.

**Options.**
- (a) **Ship both: ES modules (main) plus a CommonJS bundle for `.`, `/node` and `/nestjs`, with Langium bundled in (esbuild). Recommended.** Proven in a fresh `nest new` project with a Jest test (H1).
- (b) ES modules only; document `await import()` and Jest's ESM mode.

**Answer:** _(open)_

<a id="d33"></a>
### D33 — One event stream for trace, logs and timing

**Blocks:** R1, R3

**Options.**
- (a) **One stream of typed events. Recommended.** `{ kind: 'statement' | 'log' | 'timing', … }` with a source range. One adapter per host: stderr (CLI), the playground's tabs, Nest's `Logger`, the wire format.
- (b) Separate `trace` and `log` ports.

**Answer:** _(open)_

<a id="d34"></a>
### D34 — Stored programs and run by id

**Blocks:** R1, H2, Q5

**Options.**
- (a) **Recommended.**
  - Hosts store each program as `{ source, languageVersion }` (Q5 adds `languageVersion`).
  - The NestJS run endpoint (H2) runs **stored programs by id and version**, found through a `ProgramStore` the host provides. It never runs source text sent by a browser, except in a development mode that is off by default.
  - The server caches prepared programs by id and version.
- (b) The endpoint accepts source text (simpler; the server then runs anything it is sent).

**Answer:** _(open)_

<a id="d35"></a>
### D35 — Error messages in other languages

**Blocks:** B1, R4

**Options.**
- (a) **English messages plus stable codes and parameters. Recommended.** Every diagnostic and run error has a code (`type.implicitCoercion`) and its parameters (`{ expected: "INTEGER", actual: "TEXT" }`). Hosts translate by code (Shamsine: fa, ar, tr in its own translation file). Minab ships no translations. Codes never change once released (D38).
- (b) Minab ships translations for fa, ar and tr.

**Answer:** _(open)_

<a id="d36"></a>
### D36 — Default limits

**Blocks:** R4, Q3

**Recommended defaults** (a host can lower or raise each):

| Limit | Default | When it trips |
|---|---|---|
| Source length | 64 KB | `prepare` |
| Expression nesting depth | 200 | `prepare` |
| Wall time per run | 1,000 ms | `run` |
| Statements sent to the data port per run | 100 | `run` |
| Rows returned per statement | 10,000 | `run` |
| Loop iterations per run | 100,000 | `run` |
| Function call depth | 64 | `run` |
| Log entries per run | 100 | `run` (extra entries are dropped and counted, not an error) |
| Runs per wire request (batch) | 100 | the run endpoint |

- (a) **These defaults. Recommended.**
- (b) Other values (say which).

**Answer:** _(open)_

<a id="d37"></a>
### D37 — Logs in production

**Blocks:** L7, H2

**Options.**
- (a) **Logs are for debugging. Recommended.** On a server they are **off by default in production** (on in development). When on: capped (D36), every value printed on one line (newlines escaped, so a value cannot fake a log line), tagged with the program id and request id. The docs warn that logged values may contain personal data.
- (b) Logs are also an audit trail in production (then they need levels, structure and retention; much more work).

**Answer:** _(open)_

<a id="d38"></a>
### D38 — Compatibility policy

**Blocks:** Q5, G1, V5

**Options.**
- (a) **Recommended.**
  - Semantic versioning. Before 1.0, a minor release may break things, always with a migration note in the CHANGELOG.
  - From 1.0: no breaking change to the language, the runtime API, the wire format or the diagnostic codes within 1.x.
  - A deprecated form gives a warning (`deprecated.*` code) for at least one minor release before it is removed in the next major.
  - Every program a host stores carries a `languageVersion`. A golden corpus of programs from every release must keep giving the same results.
- (b) A lighter policy (say which part).

**Answer:** _(open)_

<a id="d39"></a>
### D39 — SQL dialects

**Blocks:** V4

**Options.**
- (a) **Postgres only for 1.0. Recommended.** Write it into ADR 0001's consequences and the README. A second dialect (SQLite is the natural one) goes to the post-1.0 list.
- (b) A dialect seam and a tested second target before 1.0.

**Answer:** _(open)_

---

## Website and launch

<a id="d40"></a>
### D40 — Owner inputs for the website

**Blocks:** W1, W3, W4

From `playground/design/brief.md` ("Open items for Hamed"):

1. **The name.** What does "Minab" mean or refer to? (A good story is one line on the landing page.)
2. **Domain.** For example `minab.dev`, or a path on your portfolio.
3. **Portfolio URL** (for the footer, `footer.authorUrl` in `src/content/landing.ts`).
4. **Social handles** for the launch posts.
5. **Brand direction:** (A) "Instrument" — calm, editorial, paper and ink, **recommended in the brief**; (B) "Terminal Noir" — dark, IDE-like; (C) "Blueprint" — technical drawing, the execution map as hero.
6. **Languages of the site:** English only, or English and Persian (with RTL)? **Recommended: English for 1.0, plus one Persian example program** (L3) to show Unicode names. A full Persian site goes to the post-1.0 list.

**Answer:** _(open)_

<a id="d41"></a>
### D41 — Where the website is hosted

**Blocks:** W4

**Options.**
- (a) **Cloudflare Pages. Recommended.** Free, global, supports a `_headers` file (PGlite's large `.wasm`/`.data` files need long-lived cache headers), preview deploys per pull request, custom domain with HTTPS.
- (b) Netlify (also supports `_headers` and previews).
- (c) Vercel.
- (d) GitHub Pages (no custom headers; works but caches the WebAssembly files less well).
- (e) A path on your portfolio site.

**Answer:** _(open)_

<a id="d42"></a>
### D42 — Does the playground have its own version?

**Blocks:** W4

**Options.**
- (a) **No. Recommended.** It stays `private` and is deployed from `main`. Its changes appear in each release's CHANGELOG under a "Playground" heading (fragments with `scope: playground`). The footer shows the Minab version it runs.
- (b) Its own version and CHANGELOG.

**Answer:** _(open)_

<a id="d43"></a>
### D43 — Security contact

**Blocks:** Q3

**Question.** Which address receives security reports (for `SECURITY.md`)? Or should reports go through GitHub's private vulnerability reporting (needs a public repository, D04)? **Recommended: GitHub private vulnerability reporting, plus one email address as a fallback.**

**Answer:** _(open)_

<a id="d44"></a>
### D44 — What the TV demo shows

**Blocks:** W5

**Options.**
- (a) **A 2-minute scripted playground demo, in English and Persian, that works with the network off, plus a recorded backup video. Recommended.** The Shamsine part of a TV demo (a form that reacts to a Minab rule) belongs to Shamsine's own plan; this plan gives it a short "how it works inside" clip.
- (b) Only a recorded video.
- (c) A live demo in Shamsine only.

**Answer:** _(open)_

<a id="d45"></a>
### D45 — How a failed rule explains itself to an end user

**Blocks:** G2

**Context.** A rule returns only `true` or `false`. Real validation needs a message, maybe a field to attach it to, and translations.

**Options.**
- (a) **The host's job. Recommended.** The host stores a translated message next to each rule (Shamsine already stores rules with fields). Minab gives codes and source ranges for errors. An "explain" mode (which sub-condition was false, with values) goes to the post-1.0 list.
- (b) A language feature: a message attached to the rule in Minab source.

**Answer:** _(open)_
