# Minab Language Specification

**Status:** Stable
**Scope:** Language reference for the pipeline query layer and the standalone expression/validation layer.

---

## 1. Overview

Minab is a small language with two layers that share a single expression sub-language:

1. **Pipeline layer** — `FROM / JOIN / WHERE / GROUPBY / HAVING / SELECT / ORDERBY / LIMIT`, for querying tabular data. Produces a table (a stream of records) or, when reduced (e.g. by an aggregate `SELECT` with no `GROUPBY`), a single record.
2. **Expression layer** — a standalone sub-language usable without any `FROM`, for validation rules. Produces a scalar (typically boolean).

Because both layers share the same expression grammar, anything you can write in a `WHERE` clause you can also write as a standalone validation rule, and vice versa.

Design principle: **ad-hoc convenience over upfront declaration.** Any table can be referenced inline via `#TableName` anywhere an expression is expected — no prior `JOIN` or `USING` clause is required. This keeps validation rules and one-off cross-table checks short, at the cost of static analyzability (you cannot tell which tables a rule touches just by reading its header — you have to scan the body).

---

## 2. Context Sigils

Single-character (or single-keyword) tokens that resolve to a position in the current scope stack. These are the core of what makes the expression language usable both inside a pipeline and standalone.

| Symbol | Name | Meaning |
|---|---|---|
| `.` | `CurrentRecord` | The current record in the innermost active scope. `.field` accesses a field on it. |
| `$` | `FieldValue` | The value of the field currently being validated. Only meaningful inside a `field` rule. |
| `^` | `ParentRecord` | The enclosing scope's `.` — one level up. Used to "escape" a nested filter or subquery back to the row that opened it. |
| `#alias` | `NamedScope` | A named scope referencing any table, view, subquery, or join alias — e.g. `#Customer`, `#o`. Can be opened inline without a prior declaration. |
| `KEY` | `GroupKeyRef` | The group key, bound after a `GROUPBY` clause. |
| `.$index` | `IndexRef` | The zero-based position of the current element within the nearest enclosing array-typed `[...]` filter or `WHERE` clause (§3.5). Only meaningful when that source is array-like — a `JSON` array or an in-memory `T[]` — not a relational `collection(Table)`, which has no inherent position. |

### 2.1 Design rationale

- `.` and `$` are split rather than overloaded because they answer different questions: *"what record am I on"* vs. *"what value am I checking."* A field-level rule needs both simultaneously (e.g. compare the field's own value against something else on the same record).
- `^` is the cheap, positional escape hatch — "one level up, whatever that is." It requires no name and reads naturally in nested filters.
- `#alias` is the named, arbitrary-depth escape hatch — "this specific thing, however deep I am." It's what lets you jump into an entirely unrelated table. It also doubles as a disambiguation prefix for joined scopes: bare `alias.field` is the default (§4.2), and `#alias` is reserved for the rare case where an alias's name would otherwise be confusable with a real field name in the same expression.
- `KEY` is spelled out (not a symbol) because group keys are a comparatively rare, structurally distinct concept — it doesn't need to compete for a single character, and spelling it out avoids confusion with `.` inside a grouped pipeline (where `.` still refers to the current *row within the group*, not the key).
- `.$index` is spelled out for the same reason as `KEY`: a rare, structurally distinct concept (an ordinal position, not a value) that doesn't need its own single character. It's written as one atomic token (the `.` is part of the keyword itself, not a separate `CurrentRecord` sigil followed by a member) — kept distinct from bare `$` (`FieldValue`, only meaningful in a field-level validation rule) purely by not overlapping at all, rather than by relying on lookahead to tell them apart.

### 2.2 Scoping rule

Sigils resolve against a **scope stack**, pushed by:

- Entering a `FROM`/`JOIN` source (pushes the primary/aliased scope)
- Entering a `[...]` filter or index on a collection (pushes the collection's element as the new `.`)
- Entering a `for-in` loop body (§9.4) over a collection (pushes the collection's element as the new `.`, exactly like `[...]` — the loop's named variable is simply an alias for that same element, the same relationship a `FROM`/`JOIN` alias has to bare `.field`, §4.2)
- Entering a subquery `(...)` used as an expression
- Opening `#Table` inline (pushes that table's row scope, without affecting `.`)

`^` always refers to the scope immediately below the current one on the stack. `#alias` refers to a named scope regardless of stack depth.

---

## 3. Relational Fields & Traversal

Fields in the schema can be:

- **scalar** — an ordinary value
- **ref(Table)** — a many-to-one pointer to a single row in another table
- **collection(Table)** — a one-to-many pointer to a set of rows in another table

### 3.1 Traversal rule

- `.field` on a **record** follows the relation: for `scalar` it returns the value, for `ref` it returns the related record, for `collection` it returns the related collection.
- `.field` on a **collection** **broadcasts**: it returns a collection of that field's value across every element (comparable to XPath node-set access or `jq`'s `.[].field`).
- If a `ref` is itself `null`, `.field` on it (and any further chained `.field` after that) evaluates to `null` rather than erroring — see §7.7 for the full rule and what it doesn't yet cover.

This means aggregation needs no special mapping syntax — aggregate functions are just functions over collections:

```
SUM(.orders.total)
```

`.orders` → collection of `Order`. `.total` broadcasts over it → collection of numbers. `SUM` reduces it → scalar.

### 3.2 Inline filtering

Collections can be filtered inline with postfix `[...]`, without a subquery:

```
.orders[.status == "cancelled"]
```

Inside `[...]`, `.` rebinds to each element of the collection; the enclosing record becomes reachable via `^`:

```
.orders[.total > ^.credit_limit]
```

### 3.3 Unrelated tables

For tables with **no declared relation**, open them inline with `#Table`:

```
EXISTS(#Customer[.id == $])
```

`#Customer` opens the whole `Customer` table as a scope. `.` inside `[...]` is each `Customer` row. `$` is the field value being validated (see §6). No `JOIN` or prior declaration is required.

### 3.4 The collection boundary (resolved — §12 item 7)

`ref` chains stay fully implicit no matter how deep — `.customer.billing_address.country` is always just a sequence of single-row lookups, so there's no cost boundary to cross and nothing needs to change about how you write it.

**Crossing a `collection` field is different.** The moment a traversal chain touches a `collection` field — directly, or by broadcasting a further `.field` through one (§3.1) — the result is a *collection*, not a scalar. A collection-valued expression **cannot be used directly** anywhere a scalar or boolean is truly required: not in a comparison, not in arithmetic, not as a bare `WHERE`/`HAVING` condition or validation rule (§6). It must first be reduced by one of:

- an **aggregate function** over the (optionally broadcast) collection — `SUM(.orders.total)`, `COUNT(.orders)`, `AVG(.orders.total)`
- a **predicate function** over an inline-filtered collection — `EXISTS(.orders[.total > 100])`, or `ALL`/`ANY` following the same shape

So this is **invalid** — `.orders.total` is a collection, and `>` expects a scalar on both sides:

```
WHERE .orders.total > 100     ✗ invalid — .orders.total is a collection
```

This is what you'd write instead, depending on which question you actually mean:

```
WHERE EXISTS(.orders[.total > 100])     // "at least one order over 100"
WHERE SUM(.orders.total) > 100          // "orders' combined total is over 100"
WHERE COUNT(.orders[.total > 100]) >= 3 // "at least 3 orders over 100"
```

**`SELECT` is not one of these positions.** Unlike `WHERE`/`HAVING`/comparison/arithmetic — which need a definite scalar or boolean to evaluate — a `SELECT` item is a projection: it just says what shape this row's output has. A raw `collection` there is a legitimate nested result, not a type error:

```
FROM Customer SELECT .id, .orders AS orders   // fine — each row's "orders" is that customer's whole order collection, nested
```

Note the WHERE/comparison/arithmetic restriction is a **semantic rule, not a syntactic one** — the grammar's `Expression` production (§11) doesn't track whether a chain resolves to a scalar or a collection, so `.orders.total > 100` still parses without error. Catching the violation requires a type-checking pass that follows each `.field` step against the schema's `scalar` / `ref` / `collection` declarations (§3) and flags any collection-valued expression used in a scalar-expecting position — the same kind of post-linking Langium **validation-phase** check used for variable type-checking (§12 item 8).

### 3.5 Positional access

The postfix `[...]` from §3.2 has **two readings**, disambiguated by the type of the expression inside the brackets, not by any new grammar — `FilterAccess` (§11) is the one production behind both:

- a **boolean** expression inside `[...]` is a **filter** — the existing §3.2 behavior, valid on a relational `collection(Table)`, a `JSON` array, or an in-memory `T[]`.
- an **integer** expression inside `[...]` is a **positional index** — valid only on a `JSON` array or an in-memory `T[]`, since both have a defined element order. On a relational `collection(Table)`, an integer index is a **semantic error, not a parse error**: a query's row order isn't guaranteed without an explicit `ORDERBY`, so "the 3rd row" isn't a well-defined thing to ask for — the grammar accepts `.orders[2]` exactly as readily as `.orders[.total > 100]`, and the validation pass is what rejects the former when `.orders` is a relational collection.

```
.tags[2]                          // valid: .tags is a JSON array, positional
.customers[.city == "Istanbul"]   // valid: boolean filter, works on any of the three kinds
.orders[2]                        ✗ invalid — .orders is a relational collection(Order); no stable position
```

The index expression doesn't have to be a literal — `.tags[i]` is fine for a variable `i: INTEGER` — because every element of an array shares one element type, so there's nothing type-inference needs the literal value *for* (contrast this with `TupleAccess`, §7.6, where the index must be a literal precisely because a tuple's positions each have their own, possibly different, type — a variable index into a tuple couldn't be resolved to a single type at all).

`.$index` (§2) is the companion to this: inside a `[...]` filter, or a `WHERE` clause, over an array-like source, `.$index` gives the current element's position — so `.customers[2]` and `FROM .customers WHERE .$index == 2 SELECT .` describe the same thing two ways. Same legality rule as the integer-index form above: meaningful only against `JSON`/`T[]` sources, a semantic error against a relational collection.

---

## 4. Pipeline Layer

### 4.1 Clause order

```
FROM <source> [AS alias]
  [JOIN|LEFTJOIN|CROSSJOIN <source> AS alias [ON <expr>]]*
  [WHERE <expr>]
  [GROUPBY <expr> [, <expr>]*]
  [HAVING <expr>]
  [SELECT [DISTINCT] <expr> [AS alias] [, ...]]
  [ORDERBY <expr> [ASC|DESC] [, ...]]
  [LIMIT <n> [OFFSET <n>]]
```

Semantics per clause, in evaluation order:

1. **FROM** — establishes the primary scope. Its source can be a bare schema table name (`FROM Order`), an ad-hoc `#Table` reference (`FROM #Customers`, same sigil as everywhere else — no prior declaration needed), or a `.field` off an enclosing record (`FROM .orders`), optionally narrowed by an inline filter (`FROM .orders[.status == "paid"]`, same meaning as §3.2) — meaningful when that field is a relational `collection(Table)` or a `JSON`-array value (§7.3), and only valid when a `.`-scope is actually active (inside a function/loop/DML statement operating on a record, not at bare top level with no enclosing record). Its alias is implicit either way: fields on it are reachable as bare `.field` (or `alias.field`) without needing `#`.
2. **JOIN** — adds another scope. `ON` is an ordinary boolean expression comparing fields from any active scope. `LEFTJOIN` preserves unmatched left-side rows with nulls on the right; `CROSSJOIN` takes no `ON` and produces the full cross-product.
3. **WHERE** — filters the joined row stream.
4. **GROUPBY** — partitions the stream by one or more key expressions. Inside and after this clause, `.` refers to *a row within the current group* (so aggregate functions like `SUM(.total)` still work), and `KEY` refers to the group key.
5. **HAVING** — filters the *grouped* stream, evaluated after aggregation, so aggregate calls are valid here.
6. **SELECT** — projects final columns. Each item may be aliased with `AS`. `SELECT *` selects every column of the row instead of listing them; omitting `SELECT` entirely is also still valid (§4.1 shows it as optional) — the two are different things, not the same "no explicit projection" case. An optional `DISTINCT` immediately after `SELECT` deduplicates the projected rows — deduplication is by the full projected tuple (every selected column together), not any single column, matching standard SQL `SELECT DISTINCT` semantics.
7. **ORDERBY** — sorts the result. `ASC` is the default. Each sort key is either a `SELECT` alias (`ORDERBY total DESC`) or any expression over the source row (`ORDERBY .created_at DESC`), even a column that `SELECT` does not list. An alias name wins over a source column with the same name.
8. **LIMIT / OFFSET** — truncates and pages the result.

### 4.2 Scope aliasing convention

- The **primary `FROM` scope** is implicit: use bare `.` or bare `alias.field`.
- **Bare `alias.field` is always allowed** for every joined scope too, regardless of how many scopes are active — there's no rule that kicks in "once you have more than one joined scope."
- **`#alias` is reserved for disambiguation**: use it only when a join alias's name would otherwise be confusable with a real field name reachable in the same expression — most commonly when a joined alias shares its name with a relation field also reachable by traversal (e.g. joining `Customer AS customer` alongside an `Order`-side `.customer` ref field). Prefixing with `#customer` makes it unambiguous that you mean the named scope, not the field.

```
FROM Order
JOIN Customer AS customer ON .customer.id == customer.id
SELECT .id, #customer.name AS customer_name   // '#' disambiguates the alias from Order's own `.customer` field
```

Outside a collision like that, `#alias` and bare `alias.field` are equivalent — bare is the default/recommended form.

### 4.3 Examples

**Filter, project, sort:**
```
FROM Order
WHERE .status == "shipped" AND .customer.country == "US"
SELECT .id, .total, .customer.name AS customer_name
ORDERBY .total DESC
LIMIT 20
```

**Select every column:**
```
FROM Customers
SELECT *
```

**Deduplicate projected rows:**
```
FROM Order
SELECT DISTINCT .customer.country
```

**Join on declared relation:**
```
FROM Order AS o
JOIN Shipment AS s ON o.tracking_code == s.tracking_code
WHERE s.status == "delivered"
SELECT o.id, o.total, s.delivered_at AS shipped_at
ORDERBY o.total DESC
LIMIT 20
```

**Group, aggregate, filter grouped data:**
```
FROM Order
GROUPBY .customer
HAVING SUM(.total) > 1000
SELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count
ORDERBY total_spent DESC
```

**Cross join:**
```
FROM Product AS p
CROSSJOIN Warehouse AS w
SELECT p.name, w.name, p.id == w.default_product_id AS is_default
```

---

## 5. Expression Language

### 5.1 Operator precedence (low → high)

```
OR
AND
NOT
comparison   (== != < <= > >= IN LIKE is isnot)
additive     (+ -)
multiplicative (* / %)
unary        (- +)
postfix      (.member  [filter]  (call))
primary      (literals, sigils, ( ), [ ])
```

Notes:

- `NOT` binds tighter than `AND`/`OR` but looser than comparison, and is right-recursive into itself: `NOT NOT x` is valid; `NOT x == y` parses as `NOT (x == y)`.
- `IN` and `LIKE` are **non-chaining** comparison operators — `a < b < c` is not valid, matching standard convention. `IN` expects a `ListLiteral` or collection expression on the right, and is defined as repeated `==` under the hood — which is why `null` is a fine element to include in that list (§7.7), even though `null` isn't a valid operand for `LIKE` itself.
- `is`/`isnot` are also non-chaining, same tier — see §5.6.
- List literals use `[...]` — e.g. `.status IN ["pending", "shipped"]`. This is grammatically distinct from the postfix filter `[...]` (one is a primary expression, the other suffixes a collection expression), but the two can look visually similar; see open question in §12.

### 5.2 Literals

| Kind | Syntax |
|---|---|
| String | `"..."` or `'...'` |
| Number | `123`, `12.5` |
| Boolean | `true`, `false` |
| Null | `null` or `NULL` |
| List | `[expr, expr, ...]` |
| Object | `{ key: value, ... }` — see §7.3 for shorthand properties and JSON-specific behavior |

`null` and `NULL` are the exact same literal — same AST node, same value, no semantic difference. The casing is purely a readability convention, not enforced by the grammar: lowercase `null` reads naturally next to JSON-value contexts (§7.3, §5.6), uppercase `NULL` reads naturally next to relational/DML contexts (§10). Use whichever fits the surrounding code; nothing checks which one you picked.

### 5.3 Functions

Functions are ordinary postfix calls: `name(arg, arg, ...)`. Aggregate functions (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`) and predicate functions (`EXISTS`, `ALL`, `ANY`) operate over collections, which are produced naturally by relational traversal (§3) or by inline filters.

```
EXISTS(.orders[.status == "cancelled"])
COUNT(.orders) > 0
AVG(.orders.total)
```

**Built-in vs. user-defined (§12 item 10, revised 2026-09-24):** a user function is called by its name, exactly like a built-in: `discounted(.total, 15)`. The grammar does not tell the two apart — `CallExpression` (`Name(...)`) parses for any identifier. The type checker resolves the name: a built-in first, otherwise a `fn` declared in the program; a name that is neither is the error `unknown function "foo"`. Two rules keep the two apart, so a built-in added later can never change the meaning of an existing program:

- **Built-in names are ALL UPPERCASE** (`COUNT`, `SUM`, `EXISTS`, ...). A user `fn` name **must contain at least one lowercase letter**. Declaring `fn SUM(...)` or `fn TAX(...)` is an error (`call.functionNameCase`); `fn tax(...)` is fine.
- **A function name is not reused.** A `let` or a parameter may not have the name of a declared `fn` (`scope.nameIsFunction`), and a `fn` may not have the name of a table in the schema (`scope.functionNameIsTable`). Functions are not values in Minab (§8), so a name before `(` can only be a function; this rule keeps `total` and `total(...)` from looking related.

#### 5.3.1 Built-in function signatures

Not previously written down formally — the built-ins were introduced only by example. Each is polymorphic over its collection's element type `T`, not a single fixed signature:

| Function | Signature | Notes |
|---|---|---|
| `COUNT` | `(collection<T>) -> INTEGER` | Any `T`. Counts elements. |
| `SUM` | `(collection<N>) -> N` | `N` is `INTEGER` or `DECIMAL` — preserves the numeric type, no auto-widening. |
| `AVG` | `(collection<N>) -> DECIMAL` | `N` is `INTEGER` or `DECIMAL`; the average is always fractional regardless of the input type. |
| `MIN` | `(collection<T>) -> T` | `T` must be orderable: `INTEGER`, `DECIMAL`, `TEXT`, `CITEXT`, `DATE`, `TIME`, or `DATETIME` — not `UUID`, `BOOLEAN`, or `JSON` (§7.2). |
| `MAX` | `(collection<T>) -> T` | Same orderability constraint as `MIN`. |
| `EXISTS` | `(collection<T>) -> BOOLEAN` | Any `T`; `true` iff the collection is non-empty. |
| `ALL` | `(collection<BOOLEAN>) -> BOOLEAN` | Typically a broadcast boolean column, e.g. `ALL(.orders.paid)`. |
| `ANY` | `(collection<BOOLEAN>) -> BOOLEAN` | Same shape as `ALL`. |

### 5.4 Subqueries as expressions

A full pipeline query in parentheses is a valid expression, evaluating to a collection or scalar depending on its shape:

```
FROM Customer
WHERE .id IN (FROM Order WHERE .status == "flagged" SELECT .customer_id)
```

### 5.5 Casting

Minab does **not** perform implicit type coercion — comparing or combining values of different declared types (e.g. a `TEXT` column against a `UUID`, or a `DECIMAL` against an `INTEGER` in an aggregate result) requires an explicit `CAST`:

```
CAST(<expr> AS <Type>)
```

```
CAST(.id AS TEXT) == rawIdParam
CAST(.total AS INTEGER)
```

`CAST`'s target is always a scalar type (`TypeRef`, §7.2) — casting to a `TupleType` isn't meaningful, so it's not accepted there. A cast is a runtime conversion request, not a guarantee: a widening cast (`INTEGER` → `DECIMAL`) always succeeds, a narrowing numeric cast (`DECIMAL` → `INTEGER`) truncates or rounds, and a cast that can't be satisfied for a given value (`TEXT` → `UUID` on a malformed string) fails at evaluation time rather than being caught statically — the type checker only verifies the cast target is a valid scalar type, not that every possible input value will convert.

### 5.6 `is` / `isnot` — JSON shape testing

`JSON` values (§7.3) can hold any of the six JSON value kinds, and their shape isn't known statically — `is`/`isnot` test it at runtime:

```
<expr> ('is' | 'isnot') ('null' | 'array' | 'object' | 'string' | 'number' | 'boolean')
```

```
if config is object { CAST(config AS JSON) } else { null }
if tags is array { ... }
if x isnot null { ... }
```

Deliberately lowercase and unrelated to `TypeRef` (§7.2) — `is object`/`is array`/etc. describe a JSON value's structural kind, not one of Minab's own column types, and the vocabulary here is exactly the six kinds the JSON spec defines (`null`, `boolean`, `number`, `string`, `array`, `object`), nothing more. `isnot` is one keyword (no space), parallel to `is`, not `is` + `not` as two tokens.

`is null`/`isnot null` aren't only for `JSON` — `x is null` and `x == null` mean exactly the same thing for any expression, not just a `JSON` one (§7.7), and both spellings are equally valid.

`is`/`isnot` are grammatically valid on **any** expression, not only `JSON`-typed ones — `.total isnot null` works exactly like `x isnot null` would. But only the `null`/`not null` check is meaningful outside `JSON` — applying `is array` or `is boolean` to something whose declared type is already, say, `DECIMAL` is always statically decidable (always false) rather than an actual runtime test — the grammar doesn't stop you from writing it, but it's not doing anything a JSON-shape test is meant to do. The five non-null kinds only really earn their keep against a `JSON` value (or, once JSON path traversal exists, an untyped value pulled out of one).

---

## 6. Validation Rules

Validation drops the pipeline **and the keywords** entirely — a bare expression is a complete, executable rule, with no wrapping statement form at all. Minab distinguishes only two flavors, by which sigil the expression uses.

### 6.1 Record-level rules

Use `.` for the whole record being validated:

```
.end_date > .start_date
```

```
COUNT(.orders[.status == "cancelled"]) < 5
```

**Correlated cross-record check** (no declared relation to `Booking` required):

```
.end_date > .start_date AND NOT EXISTS(
    #Booking[. != ^ AND .room_id == ^.room_id
             AND .start_date < ^.end_date AND .end_date > ^.start_date]
)
```

Here `#Booking` opens every row of `Booking` as a scope; `.` inside `[...]` is each candidate booking; `^` reaches back to the booking under validation.

### 6.2 Field-level rules

Use `$` for the value of whichever field the rule is validating. `.` is still available and still refers to the enclosing record, so a field-level rule can reference sibling fields:

```
$ IN ["pending", "shipped", "cancelled"]
```

```
$ >= 0 AND $ <= .customer.credit_limit
```

**Referential integrity check**, using an ad-hoc `#Table` scope:

```
EXISTS(#Customer[.id == $])
```

Note that Minab itself doesn't name *which* field a `$`-based rule belongs to — there's no `field name:` header anymore to say so. That association comes from wherever the rule is attached outside the language (e.g. a column's own validation slot in the surrounding schema), not from anything written in the rule's text. A rule written with `.` (no `$`) is a record-level rule; a rule that uses `$` is implicitly a field-level rule, and the field it's checking is whatever the rule is attached to.

### 6.3 Declarations, and the tail expression

A Minab document is any number of leading `let`/`fn` declarations (and, per §9, assignments, loops, `break`/`continue`), followed by **at most one** trailing statement — a `Query` or a bare validation `Expression` — which is the document's actual result:

```
entry Model:
    (declarations+=Declaration)*
    (tail=MainStatement)?;

Declaration:
    BodyStatement | FunctionDecl;

MainStatement:
    Query | Expression;
```

(`BodyStatement` is defined in §9 — it's the same set of statements shared with function bodies, `let` plus everything from §9.)

`let` keeps its own trailing `;` (it's a distinct statement kind, §7.1); `fn` doesn't need one, since its closing `}` already delimits it. The **tail** — the `Query` or bare `Expression` — never takes a `;`, and there's always at most one, always last. That means a document that's nothing but a single validation rule needs no punctuation at all:

```
.end_date > .start_date
```

```
let threshold: INTEGER = 100;

.total > threshold
```

**Why a bare expression can't also appear earlier, `;`-terminated, before the tail:** an earlier iteration of this design tried exactly that — a bare expression as an ordinary repeatable statement (`Expression ';'`), sitting alongside a separate, optional, un-terminated tail expression of the same shape. That's genuinely ambiguous for a parser: the two share identical leading tokens, and telling them apart requires scanning arbitrarily far ahead to see whether a `;` eventually turns up. Langium's generated parser can't resolve that with the finite lookahead an LL parser uses, and in practice it failed silently rather than raising a clean error. Restricting a bare expression to only ever occur once, in the tail position, removes the ambiguity by construction — there's no second place a bare expression could be mistaken for.

---

## 7. Variables

Minab supports simple named variable bindings — a lightweight way to name a computed or literal value once and reuse it across the rest of a script (queries, `WHERE`/`HAVING` conditions, and validation rules, §6).

### 7.1 Declaration

```
'let' name ':' Type ('=' Expression)? ';'
```

- `name` is any identifier.
- `Type` is one of the logical types listed in §7.2 — a domain-level vocabulary, not tied to any particular storage backend.
- The initializer is optional at declaration time, but if present may be **any expression** — a literal ("hard-coded"), a sigil-based expression (`.field`, `#Table[...]`), an aggregate/function call, or a full subquery. There's no separate syntax for "hard-coded" vs. "computed" values — both are just `Expression`; the difference is only in what the expression happens to be.
- Like every other statement (§6.3), a `let` ends in `;`.

```
let min_amount: DECIMAL = 100.00;

let flagged_statuses: TEXT[] = ["flagged", "under_review"];

let top_customer_id: UUID = (
    FROM Order
    GROUPBY .customer
    SELECT KEY.id
    ORDERBY SUM(.total) DESC
    LIMIT 1
);
```

### 7.2 Type domain

Minab's scalar types are a small, storage-agnostic vocabulary — behavioral categories, not domain labels. What matters to Minab is what operations a value supports (arithmetic, ordering, case-sensitive vs. case-insensitive equality, JSON shape-testing), not what the value represents. A real schema may have many more domain-specific field concepts than this table — all of them reduce to one of the types below, and that reduction is fetched externally (via the scope provider, the same channel that resolves table/column metadata and `ref` nullability, §7.7), never written into Minab's own grammar.

| Type | Behavior |
|---|---|
| `TEXT` | Case-sensitive string. |
| `CITEXT` | Case-insensitive string. |
| `INTEGER` | Whole numbers. |
| `DECIMAL` | Numbers with a fractional part. |
| `BOOLEAN` | `true`/`false` only. |
| `DATE` | A calendar date, no time component. |
| `TIME` | A time of day, no date component. |
| `DATETIME` | Both a date and a time. |
| `UUID` | An opaque identifier — equality only, no ordering. |
| `JSON` | Structured data of unknown shape — test it with `is`/`isnot` (§5.6) before treating it as one kind or another. |

Any type may be suffixed with `[]` to form an array — `INTEGER[]`, `UUID[]` — since function parameters (§8) need arrays of arbitrary element types.

**Exact numbers.** A `DECIMAL` is exact, as Postgres `numeric` is: `0.1 + 0.2 == 0.3` is `true`, in the interpreter and in the compiled SQL. A number literal with a fractional part (`0.30`) is a `DECIMAL`; one without (`30`) is an `INTEGER`. `INTEGER` with `INTEGER` stays `INTEGER`; a mix is `DECIMAL`. An `INTEGER` is a whole number from -9,007,199,254,740,991 to 9,007,199,254,740,991. A result outside that range is an evaluation error, `eval.integerOutOfRange`, never a silently wrong value. Use `DECIMAL` for larger numbers.

A `DECIMAL` result leaves Minab as a **string** in its shortest exact form, with no exponent and no trailing zeros: `"0.3"`, `"170"`. This holds for run results, `--json` output and parameters bound to SQL. An `INTEGER` stays a number. Numbers inside a `JSON` value stay JSON numbers. A host that reads a `DECIMAL` result should parse the string with a decimal library, not with `parseFloat`.

**Nullable types.** A trailing `?` marks a type as nullable — it can hold `null` in addition to its ordinary values. `?` can appear in **two independent positions**: right after the base type (before any `[]`), and right after the `[]` suffix (if present) — because "can this element be null" and "can the whole column be null" are two separate questions once arrays are involved:

| Type | Meaning |
|---|---|
| `INTEGER` | Never `null`. |
| `INTEGER?` | A nullable integer — either an integer or `null`. |
| `INTEGER[]` | An array of integers; the array itself is never `null`, and neither are its elements. |
| `INTEGER[]?` | The *column* can be `null`, or else an array of (non-`null`) integers. No `null` among the elements. |
| `INTEGER?[]` | Always an array (never `null` itself), but its individual elements can be `null`. |
| `INTEGER?[]?` | The column can be `null`, or an array whose elements can also individually be `null`. |

Assigning `null` to a non-nullable type is a **semantic** check, not a grammar one — `let x: INTEGER = null;` parses without complaint (`null` is an ordinary `NullLiteral`, a valid `Expression`, valid anywhere a `let` initializer is), and is rejected during the same immediate literal-initializer check that already catches `let x: INTEGER = "hello"` (§12 item 8) — a `NullLiteral` node satisfies a `TypeRef` only when that `TypeRef`'s relevant `?` (base or array, matching where the `null` would apply) is present. List-literal elements are checked the same way against the *base* type's nullability: `let arr: INTEGER[]? = [1, null, 3];` fails (elements are plain `INTEGER`, not nullable) where `let arr: INTEGER?[]? = [1, null, 3];` succeeds.

`?` applies to `TypeRef` only, not `TupleType` — a tuple's own nullability (`(INTEGER, TEXT)?`) isn't supported yet; each tuple *element*'s type could independently take a `?` if it's a `TypeRef`, e.g. `(INTEGER?, TEXT)`, since `TupleType`'s elements are just `Type`s.

### 7.3 `JSON` values

A `JSON`-typed variable can hold either a JSON object or a JSON list:

```
let config: JSON = { theme: "dark", retries: 3, tags: ["a", "b"] };

let tags: JSON = ["alpha", "beta", "gamma"];
```

Object literals use `{ key: value, ... }`, where `key` is a bare identifier or a string. An identifier key can also be written **without** a value — `{ someField }` — as shorthand for `{ someField: someField }`, referencing an in-scope `let` name of the same spelling via ordinary `NameRef` resolution (§7.4); a string key always needs an explicit `: value`, since there's no identifier to fall back to:

```
let someField: INTEGER = 5;
let someObject: JSON = { someField, anotherField: 10 };
// same as: { someField: someField, anotherField: 10 }
```

List literals reuse the existing `[expr, ...]` list syntax (§5.2) — the same syntax already used for `IN` lists, so a nested array inside a JSON object (like `tags` above) works without any extra grammar.

Since a `JSON` value's shape isn't known statically, check it with `is`/`isnot` (§5.6) before treating it as one kind or another:

```
if config is object { config } else { {} }
```

### 7.4 Using variables

Once declared, a variable is referenced by its bare name — the same `NameRef` production used for any other identifier — anywhere an expression is valid: in a pipeline clause, or inside a validation rule (§6).

```
let min_amount: DECIMAL = 100.00;
let flagged_statuses: TEXT[] = ["flagged", "under_review"];

FROM Order
WHERE .total >= min_amount AND .status IN flagged_statuses
SELECT .id, .total
```

```
let max_cancellations: INTEGER = 5;

COUNT(.orders[.status == "cancelled"]) < max_cancellations
```

### 7.5 Scope

A variable is bound for the remainder of the script from its declaration onward (top-level, sequential — like the statements in §6.3). It is **not** part of the scope stack described in §2.2: it doesn't push onto or interact with `.` / `^` / `#alias` resolution, and it can't be shadowed by a table alias or vice versa. Referencing a variable before its declaration, or declaring the same name twice, is a semantic error rather than a parse error — the grammar alone doesn't enforce this (see open question in §12).

### 7.6 Tuples

A tuple type is a fixed-size, ordered group of types, written in parentheses — **at least two** elements, comma-separated:

```
'(' Type (',' Type)+ ')'
```

```
let point: (INTEGER, INTEGER) = (3, 4);
let labeled: (TEXT, DECIMAL) = ("shipping", 12.50);
```

`Type` is now the umbrella covering both a `TypeRef` (§7.2's logical types) and a `TupleType`, so tuples nest freely — `(INTEGER, (TEXT, BOOLEAN))` is a valid type — and are usable anywhere a type is written: a `let`, a function parameter, or a function's return type (§8.3).

**Literals** reuse ordinary parenthesized grouping: `(expr, expr, ...)`. A single expression in parens, `(3 + 4)`, stays plain grouping — a tuple literal always needs at least one comma, matching the type's two-element minimum. This is safe to parse because the parser only needs to check for a `,` immediately after the first expression finishes, not scan arbitrarily far ahead the way the earlier tail-expression ambiguity (§6.3) would have required.

**Access** is positional, using the same brackets already used for collection filtering (§3.2), but with a literal index instead of a predicate:

```
point[0]   // 3
point[1]   // 4
```

This is a distinct grammar production (`TupleAccess`, keyed to a literal `NUMBER` immediately inside `[...]`) rather than a reuse of collection filtering's `FilterAccess` — `point["x"]` or `point[.field]` fail to parse as tuple access at all, since only a bare number is accepted there. What the grammar can't rule out: whether that number is a valid index for the tuple's actual size (`point[5]` on a 2-tuple), or whether the receiver is even tuple-typed to begin with — both are semantic checks, in the same category as the other type-checking rules in §12.

### 7.7 Null semantics

Two rules, both settled:

**1. `.field` traversal through a `null` `ref` propagates `null`, unconditionally.** `.customer.country` evaluates to `null` if `.customer` (a `ref(Customer)`) is itself `null` — not a runtime error, and not something that needs an opt-in operator (there's no separate "safe navigation" `?.` — every `.field` access already behaves this way). This propagates through an arbitrarily long chain: if `.a` is `null`, `.a.b.c` is `null` regardless of what `b`/`c` would otherwise resolve to, since each step in the chain inherits the `null` from the one before it. This holds **regardless of what the real schema says** — even a `ref` whose foreign key is `NOT NULL` in the actual database still propagates defensively if it's somehow `null` at runtime (bad data, a bug upstream); Minab doesn't distinguish "an expected `null`" from "a `null` that violates a schema guarantee." The schema's `NOT NULL` fact only sharpens *static typing* (see below), never *runtime* behavior.

**Static nullability comes from the real schema, not from anything written in Minab.** Minab has no schema-declaration syntax of its own — `scalar`/`ref(Table)`/`collection(Table)` (§3) are descriptive terms for how the type-checker interprets fields it looks up externally (the real schema, whatever backend it lives on, §7.2), fetched the same way any other cross-reference resolves, via Langium's **scope provider**. That's also where a `ref`'s actual `NOT NULL` status comes from: the type-checker asks the scope provider, per relation, whether the underlying foreign key is nullable, and types `.field` traversal through that `ref` as nullable only when the real schema allows it — not uniformly for every `ref` regardless of the actual constraint. This is exactly the same channel that already resolves table names and column types, so it's not a new integration point, just one more fact read off metadata already being fetched. `collection` fields are assumed never `null` themselves (an empty relation is an empty collection, not a `null` one) — only `ref` is affected by this rule.

**2. `==`/`!=` against `null` use ordinary equality, not SQL's three-valued logic.** `x == null` is exactly `x is null` (§5.6) — a definite `true` or `false`, never an unknown/neither-true-nor-false result the way SQL's `x = NULL` famously is. Both spellings are valid and mean the same thing; neither is preferred over the other.

The natural reading of this — stated here as an explicit generalization, not something separately confirmed — is that Minab treats `null` as an **ordinary comparable value** for `==`/`!=` in general, not just when the literal keyword `null` appears in the source. Two nullable expressions that both happen to be `null` at runtime are `==`-equal to each other (`null == null` is `true`), the same way two non-`null` values of the same value are equal. This is a deliberate departure from SQL, not an oversight — SQL's three-valued logic exists specifically so `NULL = NULL` reads as "unknown, since neither value is known," which Minab doesn't adopt.

**3. `null` is only a valid operand for `is`/`isnot`/`==`/`!=` — nothing else.** Ordering comparisons (`<`, `>`, `<=`, `>=`) and `LIKE` against `null` are a **semantic error**, not `false` and not an unknown/three-valued result — `null` simply isn't an operand those operators accept. This is a validation-phase check (§12 item 8's category), since the grammar has no way to know an operand's runtime nullability from parsing alone; `.total < null` parses fine and is rejected during type-checking.

`IN` is the one place `null` is *always* fine to include, precisely because `IN` is defined as repeated `==`: `x IN [a, b, null, c]` means `x == a OR x == b OR x == null OR x == c` — and since `==` accepts `null` on either side, so does the `IN` it's built from. This holds however the right-hand collection is written — a literal list, a subquery, an `#Table[...]` — since the underlying per-element check is always `==`, never an ordering comparison.

```
.status IN [null, "flagged"]           // fine — same as: .status == null OR .status == "flagged"
.total < null                          ✗ semantic error — < doesn't accept null as an operand
.description LIKE null                 ✗ semantic error — LIKE doesn't accept null as an operand
```

---

## 8. Functions

Minab supports user-defined functions: a named, reusable computation with **mandatory** parameter and return types. Every function is implicitly **asynchronous** — there is no synchronous function variant and no `async` keyword, since `fn` always means async. A user-defined function is called by its name — `name(arg, ...)` — the same way as a built-in aggregate or predicate function (`SUM`, `COUNT`, `EXISTS`, etc., §5.3). A function name needs a lowercase letter and built-in names are ALL UPPERCASE, so the two never collide (§5.3). The call is implicitly awaited: `name(...)` evaluates, as an expression, to the function's resolved value — never to a pending value the caller has to unwrap separately.

### 8.1 Declaration

```
'fn' name '(' (param (',' param)*)? ')' ':' ReturnType '{' statement* MainStatement? '}'
```

```
fn cumulativeAdd(inputs: INTEGER[]): INTEGER {
    ...
}
```

- Every parameter must declare a type (`name: TYPE`); there's no untyped or inferred parameter.
- The return type is likewise mandatory, written after the parameter list with `:`.
- There's no `return` keyword. A function's body ends the same way a top-level document does (§6.3): a mandatory trailing **tail** — a `Query` or a bare `Expression`, with no `;` — is the function's result. See §8.2.

### 8.2 Body

A function body may contain local variable declarations (`let`, §7) and any of the other `BodyStatement` forms (assignment, loops, `INSERT`/`UPDATE`/`DELETE`, §9–§10), followed by exactly one trailing tail — either a bare expression or a full `FROM` pipeline — which is the function's return value:

```
fn discountedTotal(orderId: UUID, rate: DECIMAL): DECIMAL {
    let base: DECIMAL = (
        FROM Order
        WHERE .id == orderId
        SELECT .total
    );
    base - (base * rate / 100)
}
```

```
fn processOrder(orderId: UUID): BOOLEAN {
    let valid: BOOLEAN = (
        FROM Order WHERE .id == orderId SELECT .status == "pending"
    );
    valid
}
```

A function can also end in a `Query`, so its "return value" is a table rather than a scalar — see §8.6 for what its declared return type must be in that case:

```
fn cancelledOrdersFor(customerId: UUID): JSON {
    FROM Order
    WHERE .customer.id == customerId AND .status == "cancelled"
    SELECT .id
}
```

The tail (whether a `Query` or a bare expression) takes any `Expression`/`Query` shape — a literal, a sigil expression, a call, a subquery, or a full pipeline — exactly like a variable initializer (§7.1) already allows for `let`. Parameters (`orderId`, `rate` above) and any locally-declared `let`s are referenced the same way a top-level variable is: by bare name via `NameRef`.

A function body ends in **exactly one tail** as its result. What the grammar doesn't enforce is that the tail is actually *present*: it's grammatically optional, even though the declared return type is mandatory, so a function with no tail would have nothing to satisfy that type. Requiring a tail whenever a return type is declared is therefore a semantic check, not a parse-time one — same category as the type-checking rules in §12.

**`yield` has been retired.** An earlier iteration of this design let a function body emit any number of `yield <expr>;` statements ahead of its tail, intended as some kind of intermediate/progress value distinct from the final result — but what a call `name(...)` should actually produce when a function both `yield`s and has a tail was never resolved (see the now-closed discussion in §12 item 9's history), and Minab has no iterator/generator protocol yet for a caller to actually consume a sequence of yielded values against. Rather than keep a keyword whose call-site semantics were undefined, `yield` and `YieldStatement` have been removed from the grammar entirely. It may come back once iterators are designed properly, but as a different mechanism built for that purpose — not a re-add of this same form.

### 8.3 Types

Parameter and return types are drawn from the same type domain as variables (§7.2), including array types: any base type may be suffixed with `[]` — `INTEGER[]`, `DECIMAL[]`, `UUID[]`, and so on — and tuple types (§7.6):

```
fn swap(a: INTEGER, b: INTEGER): (INTEGER, INTEGER) {
    (b, a)
}
```

### 8.4 Calling a function

A call to a user-defined function is written `name(arg, ...)`, like a built-in call. The name must be a `fn` declared in the program (§5.3); any other name that is not a built-in is the error `unknown function "name"`:

```
FROM Customer
SELECT .id, cumulativeAdd(.orders.total) AS lifetime_total
```

```
discountedTotal(.id, .discount_rate) <= .total
```

`name(...)` is a `CallExpression` (§11), so it chains with the ordinary postfix operators like anything else — `getPrimaryContact(.id).email`, `recentOrders(.id)[.status == "shipped"]`, and so on.

A function may also call itself or another function in the same way, including **recursively**, and regardless of where the other function is declared in the file (so mutual recursion between two functions is allowed too).

### 8.5 Scope

A function's parameters and its own local `let`s are scoped to its body. In addition, a function body can read `let` variables declared **outside** it — at the top level of the script, or (for a nested function) in an enclosing function — the same way a closure captures its surrounding bindings. A parameter or local `let` with the same name as an outer one shadows it within the function body.

### 8.6 Query-tailed functions return `JSON` (resolved — §12 item 11)

A function's declared return type (§8.3) is always a single logical type — built for describing one scalar column — but its tail can be a `Query` (§8.2), which produces a table, possibly many rows. Rather than inventing a separate "table return type" syntax, a `Query`-tailed function's result is simply `JSON`: a JSON array of whatever its `SELECT` produces, one array element per row.

- `SELECT *` → a `JSON` array of objects, one per row.
- `SELECT <single column>` → a `JSON` array of that column's value type.

A `Query`-tailed function must therefore declare its return type as `JSON` — declaring anything else (`UUID`, `INTEGER`, ...) for a `Query`-tailed body is a semantic error, checked once at the `FunctionDecl` itself, not per call site:

```
fn cancelledOrdersFor(customerId: UUID): JSON {
    FROM Order
    WHERE .customer.id == customerId AND .status == "cancelled"
    SELECT .id
}
// cancelledOrdersFor(x) : JSON — a JSON array of UUIDs (one per cancelled order)

fn recentOrders(customerId: UUID): JSON {
    FROM Order
    WHERE .customer.id == customerId
    SELECT *
    ORDERBY .placed_at DESC
    LIMIT 10
}
// recentOrders(x) : JSON — a JSON array of order objects
```

A function whose tail is a plain `Expression` (not a `Query`) is unaffected by this rule — it's scalar-valued exactly as declared, same as always. Because the result is `JSON`, consuming it further needs the ordinary `is`/`isnot` shape-testing rules (§5.6) — e.g. `is array` — the same as any other `JSON` value; there's no separate "query-result" type the checker treats specially beyond this.

### 8.7 Host functions and host inputs

A program can use names that **the host** gives it. The host declares them once, with types, when it creates the runtime (`createMinab`). Minab source never declares them.

- **A host input** is a typed, read-only name, such as `currentUser` or `url`. Its type is a scalar, an array, or a record of typed fields (no relations). A program reads it by its bare name, and the host gives the value for each run. A declared input with no value is a run error (`eval.missingInput`).
- **A host function** is a typed function that the host implements, such as `fxRate(from: TEXT, to: TEXT): DECIMAL`. A program calls it like any other function: `fxRate("EUR", .currency)`. It runs in the interpreter only. The SQL compiler never turns a call to it into SQL (`compile.hostFunctionInSql`). The host may mark a function `local` when it is safe to run in a browser. A program that uses a function that is not `local` needs the server.

```
.owner_id == currentUser.id OR "admin" IN currentUser.roles OR .total * fxRate("EUR", .currency) > 1000
```

**Names.** A host function name needs at least one lowercase letter, like a user `fn` (§5.3, decision D10). The same rule holds for a host input name. The runtime checks this when the host declares them, and the host developer gets a clear error. A `fn`, a `let` or a parameter may not reuse a host input name or a host function name (`scope.nameIsHostName`, decision D11). A host input is read-only: assigning to it, or to a field of it, is an error (`scope.assignToInput`).

```
let currentUser: TEXT = "x";      // error: "currentUser" is a host input
```

---

## 9. Flow Control

`if` and `switch` (§9.1, §9.2) are **expressions** — every branch evaluates to a value, and both are usable anywhere any other expression is (a `let` initializer, a tail, an argument). Both accept a **block** as a branch's body — `let`s, assignments, loops, then a tail expression — so a branch can run several statements before producing its value. Assignment and loops (§9.3, §9.4) are the opposite: **statements**, not expressions — they produce no value and can't themselves be a `let` initializer, a tail, or an `if`/`switch` branch's *result* (though they can appear inside a branch's block, ahead of that result).

### 9.1 `if` / `else`

```
'if' Expression Block ('else' (Block | IfExpr))?
```

`else` is **optional**. When it's present, both branches are ordinary blocks and their tail types must agree, exactly as before. When it's **omitted**, the missing branch is treated as implicitly producing `null` — so the whole `if` expression's type is the `then`-branch's type, made **nullable** (§7.2). This is why nullable types exist: without them, an else-less `if` would have no sound way to describe what happens on the false path; with them, `null` is simply the honest, typed answer.

```
let tier: TEXT? = if .total > 1000 { "gold" };
```

`tier` is `TEXT?` here, not `TEXT` — the assignment above is only valid because the declared type is nullable. Writing `let tier: TEXT = if .total > 1000 { "gold" };` (no `?`) parses fine but is a **semantic** error: the `if`'s inferred type is `TEXT?`, and `TEXT?` can't satisfy a non-nullable `TEXT` — same category of check as any other type mismatch (§12 item 8), just triggered by the implicit `null` rather than a written one.

`else if` chains via recursion, same as before, and can itself omit its own final `else`:

```
let tier: TEXT = if .total > 1000 { "gold" } else if .total > 100 { "silver" } else { "bronze" };
```

Each branch is still a full **block** (§9.2/§8.2's `Block`: `let`s, assignments, loops, then a tail expression) — not just a single bare expression — so a branch can run statements before settling on its result. Because a branch is a full block, it can hold assignments and function calls ahead of its tail — this is what lets you write "if true, update this, then call that function." Note that a function call's result needs to be captured (even into a `let` you don't otherwise use) rather than left bare — there's no free-standing "call statement" that discards a result, only the same statement forms available everywhere else (`let`, assignment, loops, `break`/`continue`, `INSERT`/`UPDATE`/`DELETE`), matching the tail-position restriction from §6.3 (a bare expression is never allowed to sit mid-block, only in the one designated tail slot):

```
if .total > 1000 {
    total = total + 100;
    let notified: BOOLEAN = notifyManager(.customer_id);
    "flagged"
} else {
    "ok"
}
```

If a branch's only purpose is its side effects and it has no value worth naming, dropping `else` (rather than writing a matching trivial `null` branch by hand, the way earlier examples in this doc did before nullable types existed) is now the more direct way to say that:

```
if shouldProcess {
    result = processOrder(orderId);
    null
}
```

The branch still needs *some* tail (`null`, here) — a block with no tail at all has an undefined type in a value-producing position, the same open question a tail-less function body already has (§8.2) — but the `else` branch itself no longer needs to be spelled out; omitting it produces the same nullable-`null` result implicitly. If the branch genuinely has no value worth naming at all, `if!` (§9.1.1) is the more direct tool — no `null` tail, no nullable-type dance, just a statement.

Same `{` ambiguity rule as `switch` applies here: `{` after the condition always starts a `Block`, never a bare `JsonObjectLiteral` — wrap a literal object result in parens (`({ ... })`) if that's what a branch should produce.

### 9.1.1 `if!` — `if` as a statement

Everything in §9.1 is `IfExpr`, an **expression** — it can only appear where an expression is legal (a `let` initializer, an assignment's value, an argument, or the one designated tail slot per block, §6.3). Even an else-less, side-effect-only `if` is still bound by that: it can only be **the last thing in its enclosing block**, and every branch it does write still needs its own tail value (even a trivial `null`), because it's still, fundamentally, a value-producing construct.

`if!` is a genuinely separate production — `IfStatement`, not an expression at all. It has no value, no type to satisfy, and no tail requirement on its branches, and it's a `BodyStatement` (§11): usable anywhere a statement is valid, including in the middle of a block, with ordinary code after it.

```
'if!' Expression Block ('else' (Block | IfStatementElse))?
```

```
if! v % 2 != 0 {
    continue;
}

seen = seen + 1;

if! v > threshold {
    result = v;
    break;
}
```

Both `if!`s above are ordinary statements sitting in a normal statement sequence — the second one isn't a block's tail, and neither branch needs a trailing value. `else`/`else if` still work exactly as you'd expect, and are just as optional as they are for `IfExpr` — but there's no nullable-type story here at all, because there's no value in the first place:

```
if! newStatus == "severe" {
    INSERT #CollectionsQueue
    VALUES { customer_id: customer.id, reason: newStatus };
}
```

**Why the `!` specifically.** A block's grammar (`'{' (statements+=BodyStatement)* (tail=MainStatement)? '}'`) has to decide, on seeing an `if`-shaped token right before the closing `}`, whether it's "one more `BodyStatement`" or "the tail." If both productions shared the identical `'if' Expression Block ('else' ...)?` shape and only the keyword told them apart, that decision would still be safe — the danger would only appear if the *same* leading keyword could mean either one, forcing the parser to scan arbitrarily far ahead to see which. Giving the statement form its own distinct leading token (`if!` — one atomic keyword, not `if` followed by a separate `!`) means the lexer resolves this before the parser ever has to guess, via the same longest-match-wins mechanism already relied on for `isnot` vs. `is` and `+:` vs. `+` — `if!` and `if` are simply two different tokens, full stop. `else if` chains inside an `if!` reuse plain `if` (`IfStatementElse`, not `IfExpr`) — safe because that position is only ever reached *after* already committing to `IfStatement` via its `else`, so there's nothing left to disambiguate there.

### 9.2 `switch`

```
'switch' Expression '{'
    (Value (',' Value)* '=>' Result ',')*
    '_' '=>' Result
'}'
```

- Case values are **literals only** (string, number, boolean, null) — this is plain value-equality matching, not pattern matching over structured data or enum variants (deferred, per the earlier decision not to add enums yet).
- A case may list several values sharing one result: `"pending", "shipped" => ...`.
- The trailing `_ =>` default arm is **mandatory and grammar-enforced** — a `switch` without one simply doesn't parse. (`if` no longer has an equivalent requirement — its `else` is optional, §9.1 — since `switch` is exhaustive-by-construction over its listed cases while `if` only ever has one condition to check.)

```
let priority: INTEGER = switch .status {
    "urgent" => 1,
    "high" => 2,
    "normal", "low" => 3,
    _ => 0
};
```

**A `switch` arm's result can also be a block** — `{ let ...; tail }` — using the same statement forms as a function body (§8.2), with its own tail expression as the arm's result:

```
fn classifyOrder(orderId: UUID): TEXT {
    let status: TEXT = (
        FROM Order WHERE .id == orderId SELECT .status
    );

    switch status {
        "cancelled" => "closed",
        "shipped", "delivered" => {
            let hasShipment: BOOLEAN = EXISTS(#Shipment[.order_id == orderId]);
            if hasShipment { "fulfilled" } else { "pending shipment" }
        },
        _ => "open"
    }
}
```

Block and plain-expression arms mix freely in the same `switch`, as shown above.

**`{` is always read as a block, never as a bare `JsonObjectLiteral`, in a switch-arm result position.** This mirrors Rust's own block-vs-struct-literal rule, and exists for the same reason: `JsonObjectLiteral` (§7.3) also starts with `{`, and telling the two apart from the opening token alone isn't possible. If an arm's result is meant to be a JSON object literal, wrap it in parens to force it back into plain-expression territory:

```
switch .tier {
    "gold"   => ({ discount: 20, freeShipping: true }),
    "silver" => ({ discount: 10, freeShipping: false }),
    _        => ({ discount: 0, freeShipping: false })
}
```

Without the parens, `{ discount: 20, freeShipping: true }` is read as the start of a `Block`: `discount` parses as a bare `NameRef` expression attempting to be the block's tail, and then the parser hits `:` where it expects the closing `}` — a parse error, not a silent misinterpretation, but a confusing one (it won't say "wrap this in parens for a JSON object"), so it's still worth knowing about ahead of time rather than discovering it here.

### 9.3 Assignment

`let` bindings are **mutable by default** — Minab has no constants (for now; see §12 item 13). A target can be reassigned with plain `=`, no type annotation and no `let`:

```
Target ('=' | '+=' | '-=' | '*=' | '/=' | '?=' | '|=') Expression ';'
```

```
let total: INTEGER = 0;
total = total + 5;
```

**The target is a full expression, not just a bare name.** A separately-declared `let` name still works exactly as above, but a `.`-rooted field-access path is equally valid — walking through a record's relations to reach a nested field:

```
.doctor.id = 21;
```

Not every expression is a legal target, only a bare name or a chain of `.field`/`[...]` steps rooted in one — an arithmetic expression or a literal on the left of `=` is a semantic error, since there's nothing there to assign into. Whether the target is even declared, and whether the value's type matches, are semantic checks too, same category as everywhere else in this doc.

**Auto-creating a missing link in the path with `!`.** If a step in the path is a `ref` and it's currently `null`, the assignment beyond that point is a **no-op** by default — consistent with `.field` traversal already propagating `null` when reading (§7.7), now extended to writes. Appending `!` right after that specific step instead means "create the missing record first, then continue" — so a `null`-safe path and an auto-creating one can be mixed freely, step by step:

```
.doctor.id = 21;              // no-op if .doctor is null
.doctor!.id = 21;              // creates .doctor first if it's null, then sets its id
.a!.b.c!.d.e! = { name: 'x' };  // vivify at a, c, and e; b and d propagate null if they're missing
```

If a step marked `!` genuinely can't be created (some other required field has no value, no default, whatever the real schema demands) — that's a **runtime error**. Nothing about this is visible to the grammar or even the type-checker; it depends on constraints only the real schema knows about. `!` on a `collection` step is meaningless, since a `collection` is never itself `null` (§7.7) — assumed to be a semantic error rather than silently ignored, though this hasn't been separately confirmed (§12 item 17).

**Filtering which elements a path assignment touches.** When a step in the path is a `collection`, an inline `[filter]` narrows which elements the rest of the path (and the final assignment) applies to — the same `[...]` already used for reading (§3.2), now also usable mid-path in a write:

```
.doctor.patients[.city == 'istanbul'].activate = true;
// same effect as:
UPDATE .doctor.patients
WHERE .city == 'istanbul'
SET { activate: true };
```

The `[filter]` is optional — `.doctor.patients.activate = true;` (no filter at all) sets `.activate` across *every* patient, the unfiltered case of the same mechanism.

**`|=` — merge, rather than replace.** Plain `=` replaces a field's value outright. `|=` instead merges an object literal's fields into the target — meaningful for a `ref` (merge fields into the related record) or a `JSON` value (merge keys into the existing object), and it implies "create it first if missing" on its own, which is exactly why a `!` right before `|=` never adds anything — there's nothing left for it to do. On a `collection` target, `|=` merges those fields into every matching element, the multi-field counterpart to `=`'s single-field bulk-set:

```
.doctor |= { name: 'Dr. Smith' };                          // merge into .doctor, creating it if null
.doctor.patients[.city == 'istanbul'] |= { checked: true };  // merge into every matching patient
```

**A spacing hazard worth knowing about — two of them now.** A nullable type's trailing `?` (§7.2) can end up directly adjacent to a following `=` — write `let x: INTEGER? = 5;` with a space, not `let x: INTEGER?=5;`, or the lexer's longest-match rule greedily consumes `?=` as one token where a plain initializer needs a bare `=`. The vivify marker has the same hazard with plain `=` specifically: `.doctor! = 21;` (space) is "vivify, then assign"; `.doctor!=21;` (no space) lexes as the existing `!=` (not-equal) comparison operator instead, which isn't even valid there since a comparison can't be an assignment target. This doesn't happen with `!` before any of the *other* operators (`+=`, `|=`, etc.) — only a bare `=` shares a first character with an already-existing token (`!=`) that `!` could accidentally complete. Both hazards are spacing conventions to follow, not ambiguities the parser has to resolve alone — every example in this document already puts a space around every assignment operator.

**Compound assignment.** `+=`/`-=`/`*=`/`/=` update the target relative to its current value, same shape as the `SET`-clause operators (§10.3) but spelled with `=` instead of `:`, matching ordinary assignment's own `=`. `+=` means numeric increment or string concatenation depending on the target's declared type (one operator, disambiguated by type, same rule as `SET`'s `+:`); `-=`/`*=`/`/=` are numeric only.

```
let total: INTEGER = 0;
total += 5;    // total = total + 5

let label: TEXT = "order";
label += "-42";    // label = "order-42"
```

**`?=` — assign only if currently `null`.** The target must be a nullable type (§7.2); `x ?= expr` leaves `x` unchanged if it's already non-`null`, and sets it to `expr` only if it's currently `null` — a null-coalescing assignment.

```
let discount: DECIMAL? = null;
discount ?= 0.10;    // discount was null, so it's now 0.10

discount ?= 0.20;    // discount is already 0.10 (not null), so this is a no-op
```

Using `?=` on a non-nullable target is a semantic error — same category as assigning `null` to one directly (§7.2) — since a non-nullable variable can never *be* `null` in the first place, so "assign only if null" could never trigger.

Unlike everything else introduced so far, `AssignmentStatement` is **not an expression** — it produces no value, so it can't be a `let` initializer, a tail, or an `if`/`switch` branch's result. It's a `BodyStatement`: valid wherever a `let` is valid (the top level, or inside a function/loop body), never anywhere an `Expression` is expected.

A parsing note worth being upfront about: since the target is now a full expression rather than a single token, `AssignmentStatement` and a block's own tail (§6.3) share the same possible leading tokens (a bare name, or `.`). They're still distinguishable — `Postfix` (§11) parses a `.field`/`[...]` chain deterministically, greedily, with no guessing involved in how far to extend it; only *after* that self-terminating process stops does the parser check whether an assignment operator follows (this statement) or something else does (the tail, or a different statement). That's a different shape from the original tail-ambiguity bug (§6.3), where the two alternatives were identical with nothing but an *optional*, arbitrarily-later token to tell them apart. Flagged rather than just assumed — this specific interaction hasn't been run through an actual parser, and is worth verifying there before leaning on it further.

### 9.4 Loops

All three loop forms share one grammar rule and one body shape, and — like `AssignmentStatement` — **loops are statements, not expressions.** A loop's body tail, if it has one, is simply discarded; the loop itself never produces a value:

```
(Label ':')? 'loop'
    ( Variable 'from' Expression 'to' Expression (('by' Expression) | ('where' Expression))?
    | Variable 'in' Expression ('where' Expression)?
    | Expression
    )
'{' statement* MainStatement? '}'
```

**Range loop**, with an optional `by` (step) or `where` (filter) — mutually exclusive, not combinable:

```
let sumEven: INTEGER = 0;

loop n from 0 to 20 by 2 {
    sumEven = sumEven + n;
}

sumEven
```

```
let sumOdd: INTEGER = 0;

loop n from 1 to 20 where n % 2 != 0 {
    sumOdd = sumOdd + n;
}

sumOdd
```

**For-in loop**, over anything array- or collection-typed — including a relational `collection(Table)` field. This is another valid way to consume a collection-valued expression, alongside the aggregate/predicate reductions from §3.4. Entering the loop body pushes the collection's element as the new `.` (§2.2) — exactly like `[...]` filtering already does — and the loop's named variable is just an alias for that same element. `.field` and `order.field` are fully interchangeable, in any combination, including within the same expression — same relationship bare `.field` has to `alias.field` in a `FROM` (§4.2):

```
let shippedTotal: DECIMAL = 0;

loop order in .orders where .status == "shipped" AND order.total > 0 {
    shippedTotal = shippedTotal + order.total;
}

shippedTotal > 500
```

`.status` and `order.total` in the same `WHERE`-guard expression above resolve to the same record — there's no rule requiring one style over the other, or forbidding mixing them; `order` is simply a name for whatever `.` already refers to inside the loop.

`^` still reaches back to whatever `.` was *before* the loop pushed this new scope — the same rule `[...]` filtering already follows (§3.2) — and the named variable (`order`) is the more convenient tool once you're nested inside something that's re-pushed `.` to mean something else (a further `[...]` filter, or another loop), the same way `#alias` is the arbitrary-depth counterpart to `^`.

**Bare-condition loop** (`while`-style) — just `loop <Expression> { }`, with no `from`/`in`:

```
fn countUntilOver(limit: INTEGER): INTEGER {
    let count: INTEGER = 0;
    let runningTotal: INTEGER = 0;

    loop runningTotal <= limit {
        count = count + 1;
        runningTotal = runningTotal + count;
    }

    count
}
```

Distinguishing this from the range/for-in forms only needs 2-token lookahead — after `loop` and an identifier, either `from`/`in` follows or it doesn't, and neither keyword is a valid way to continue an ordinary expression, so there's no case where the parser has to guess. Same bounded-lookahead shape as the `TupleAccess`/`FilterAccess` split (§7.6), not the unbounded-scan problem that broke the earlier tail-expression design (§6.3).

**Labels, `break`, and `continue`.** A loop may be optionally labeled (`label: loop ...`); `break`/`continue` may optionally name a label to target an outer loop instead of the innermost one:

```
fn firstPairOver(a: INTEGER[], b: INTEGER[], limit: INTEGER): INTEGER {
    let result: INTEGER = 0;

    outer: loop x in a {
        inner: loop y in b {
            if x + y > limit {
                result = x + y;
                break outer;
                null
            } else {
                continue inner;
                null
            }
        }
    }

    result
}
```

`break`/`continue` are statements, not expressions, same as assignment and loops themselves. What the grammar doesn't check: that a named label in `break`/`continue` actually refers to an enclosing loop (as opposed to a typo, or a label that exists but doesn't enclose this point), or that a bare (unlabeled) `break`/`continue` even appears inside *some* loop at all — both are semantic checks.

Note that `outer`/`inner` here each still push a `.` per the rule above, even though the example never uses it — `x` and `y` are plain `INTEGER`s (not records), so there's no field to reach via `.`, and naming both loop variables is what actually matters for telling them apart once nested. The named-variable form and `.` aren't in tension; the example just has no reason to reach for `.` when the values are scalars and already have clear names.

---

## 10. Data Manipulation (`INSERT` / `UPDATE` / `DELETE`)

Like assignment and loops (§9.3, §9.4), these are **statements, not expressions** — they produce no value. They're `BodyStatement`s (§11), so they're usable at the top level, inside a function body, or inside a loop body — anywhere `let`, an assignment, or a loop already is. Because a whole Minab document can already execute under a record context (this is exactly how a top-level `VALIDATE`-style rule works today, §6 — `.` there means "the record being validated"), the same is true here: a `DELETE`/`UPDATE`/`INSERT` written at the top level of a document invoked against a specific record can use `.` for that record and `^` to escape a nested filter back to it, with no new scoping mechanism needed beyond what §2.2/§3.2 already define.

All three share one target-resolution rule: the target expression must resolve (a semantic check, not a parse-time one) to something you can actually mutate — a relational `collection(Table)` field, a `JSON`-array field, or a whole table via `#Table` — not an arbitrary scalar.

### 10.1 `INSERT`

```
'INSERT' target=Expression 'VALUES' payload=(Query | Expression)
```

```
INSERT .customers
VALUES {name: 'hamed', surename: 'zakeri'};

INSERT .customers
VALUES #Customers;

INSERT .customers
VALUES #Customers[.city == 'Istanbul'];

INSERT .customers
VALUES FROM #Customers WHERE .city == 'Istanbul' SELECT .;
```

`VALUES`'s payload is either a single row (a `JsonObjectLiteral` — already an ordinary `Expression`, nothing new needed there) or a source of many rows: `#Table`, a filtered `#Table[...]`, or a full pipeline `Query`. The `Query` case is why the payload's grammar is `Query | Expression` rather than just `Expression` — a bare (unparenthesized) `Query` isn't itself a valid `Expression` (§5.4 requires parens for that), but this is exactly the same shape as `MainStatement` (§6.3): a `Query | Expression` alternation used in exactly **one** fixed, non-repeated grammar slot. That's the specific pattern that's safe — the danger from §6.3's original bug was a bare `Expression` appearing ambiguously *inside a repeated list*, not in a single designated slot like this one.

An object literal's keys are checked against the target table's actual declared columns — a schema-directed check, different from `JSON`'s free-form key acceptance (§7.3) even though the literal syntax is identical.

### 10.2 `DELETE`

```
'DELETE' target=Expression (whereClause=WhereClause)? (orderByClause=OrderByClause)? (limitClause=LimitClause)?
```

```
DELETE .customers[2];
DELETE .customers[.city == 'Istanbul'];
DELETE #customers[.city == 'Istanbul'];
DELETE .customers WHERE .city == 'Istanbul';
DELETE .customers[.city == 'Istanbul' AND ^.marked == true];
DELETE .customers[.city == 'Istanbul' OR ^.ignored == true];
DELETE .customers WHERE .orders_total < 1000 ORDERBY .orders_total DESC LIMIT 10;
```

An inline `[...]` filter on the target and a separate `WHERE` clause are two ways to say the same thing — `DELETE .customers[.city == 'Istanbul']` and `DELETE .customers WHERE .city == 'Istanbul'` are equivalent, since `target` is a general `Expression` (which may already carry its own postfix filter) and `WhereClause` is just an additional, independent filter on top of whatever `target` evaluates to. `ORDERBY`/`LIMIT` reuse the exact clauses `Query` already has (§11) — there's no separate `TOP(n)` syntax; `LIMIT n` is the one way to say "at most N rows," here and in `Query`.

`.customers[2]` and integer indices generally follow §3.5's rule exactly: legal when `.customers` is a `JSON` array, a semantic error when it's a relational collection.

### 10.3 `UPDATE`

```
'UPDATE' target=Expression (whereClause=WhereClause)? (orderByClause=OrderByClause)? (limitClause=LimitClause)?
'SET' '{' (assignments+=SetAssignment (',' assignments+=SetAssignment)*)? '}'

SetAssignment: key ('+:' | '-:' | '*:' | '/:' | ':|' | ':') value
```

```
UPDATE .customers
SET { city: 'Istanbul' };

UPDATE .customers[.city == 'Istanbul']
SET { checked: true };

UPDATE .customers[.city == 'Istanbul']
SET { someStringField: null };

UPDATE .customers
WHERE .city == 'Istanbul'
SET { puan +: 10, hardness /: 2, multiplier *: 2, reducer -: 10 };

UPDATE .customers
WHERE .city == 'Istanbul'
SET { address +: ' KARTAL/Istanbul' };

UPDATE .customers
WHERE .$index > 2
SET { address +: ' KARTAL/Istanbul' };
```

`SET`'s clause order matches every example above: target, then optional `WHERE`/`ORDERBY`/`LIMIT`, then `SET` last — deliberately not SQL's `UPDATE ... SET ... WHERE` ordering, since every one of your own examples put `SET` at the end.

A plain `key: value` pair replaces the field outright. The four compound forms mutate it relative to its current value: `+:` (numeric increment, or string concatenation when the field is text-typed — one operator, disambiguated by the field's declared type, same category of semantic check as everywhere else in this doc), `-:`/`*:`/`/:` (numeric only). `:|` merges an object literal's fields into a `ref`- or `JSON`-typed field, rather than replacing it wholesale — the `SET`-clause counterpart to ordinary assignment's `|=` (§9.3), spelled with `:` to match every other `SET` operator's colon-first shape:

```
UPDATE .customers[.city == 'Istanbul']
SET { metadata :| { verified: true } };
```

One judgment call here worth flagging: the colon-style compound operators are what's implemented — `address +: '...'` — rather than a separate `+=` spelling for the string case, since having two different compound-operator spellings side by side in the same `SET {...}` block (colon-style for most of them, equals-style for one) seemed like an inconsistency rather than an intentional distinction. Say so if string append was actually meant to look different from numeric increment. (Ordinary variable assignment does have its own `+=`/`-=`/`*=`/`/=`/`|=` now, §9.3 — the two families don't overlap: `SET`'s colon-style is only ever for object-literal fields inside `UPDATE`, equals-style is only ever for a plain assignment statement's target.)

`+:`/`-:`/`*:`/`/:`/`:|` are new two-character tokens, distinct from the existing single-character `+`/`-`/`*`/`/`/`:` — same precedented pattern as `==` vs `=` or `isnot` vs `is`, where a longer literal token takes priority over its shorter prefix.

---

## 11. Grammar Reference (Langium)

The full grammar targeting the Langium playground:

```langium
grammar Minab

entry Model:
    (declarations+=Declaration)*
    (tail=MainStatement)?;

Declaration:
    BodyStatement | FunctionDecl;

MainStatement:
    Query | Expression;

Query:
    'FROM' source=FromSource ('AS' alias=ID)?
    joins+=JoinClause*
    (whereClause=WhereClause)?
    (groupByClause=GroupByClause)?
    (havingClause=HavingClause)?
    (selectClause=SelectClause)?
    (orderByClause=OrderByClause)?
    (limitClause=LimitClause)?;

FromSource infers Expression:
    TableRef | NamedScope | CurrentRecord ({infer FilterAccess.receiver=current} '[' filter=Expression ']')?;

TableRef infers Expression:
    {infer TableRef} name=QualifiedName;

JoinClause:
    (left?='LEFTJOIN' | cross?='CROSSJOIN' | 'JOIN') source=QualifiedName 'AS' alias=ID
    ('ON' condition=Expression)?;

WhereClause:
    'WHERE' condition=Expression;

GroupByClause:
    'GROUPBY' keys+=Expression (',' keys+=Expression)*;

HavingClause:
    'HAVING' condition=Expression;

SelectClause:
    'SELECT' distinct?='DISTINCT'? (all?='*' | items+=SelectItem (',' items+=SelectItem)*);

SelectItem:
    expression=Expression ('AS' alias=ID)?;

OrderByClause:
    'ORDERBY' items+=OrderItem (',' items+=OrderItem)*;

OrderItem:
    expression=Expression direction=('ASC' | 'DESC')?;

LimitClause:
    'LIMIT' limit=NUMBER ('OFFSET' offset=NUMBER)?;

VariableDecl:
    'let' name=ID ':' type=Type ('=' value=Expression)? ';';

Type:
    TypeRef | TupleType;

TupleType:
    '(' elementTypes+=Type (',' elementTypes+=Type)+ ')';

TypeRef:
    base=(
        'TEXT' | 'CITEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' |
        'DATE' | 'TIME' | 'DATETIME' | 'UUID' | 'JSON'
    )
    nullable?='?'?
    (array?='[]' arrayNullable?='?'?)?;

FunctionDecl:
    'fn' name=ID '(' (params+=Param (',' params+=Param)*)? ')' ':' returnType=Type
    '{' (body+=BodyStatement)* (tail=MainStatement)? '}';

Param:
    name=ID ':' type=Type;

BodyStatement:
    VariableDecl | AssignmentStatement | LoopStatement | BreakStatement | ContinueStatement
    | InsertStatement | DeleteStatement | UpdateStatement | IfStatement;

InsertStatement:
    'INSERT' target=Expression 'VALUES' payload=ValuesPayload ';';

ValuesPayload:
    Query | Expression;

DeleteStatement:
    'DELETE' target=Expression
    (whereClause=WhereClause)?
    (orderByClause=OrderByClause)?
    (limitClause=LimitClause)? ';';

UpdateStatement:
    'UPDATE' target=Expression
    (whereClause=WhereClause)?
    (orderByClause=OrderByClause)?
    (limitClause=LimitClause)?
    setClause=SetClause ';';

SetClause:
    'SET' '{' (assignments+=SetAssignment (',' assignments+=SetAssignment)*)? '}';

SetAssignment:
    key=(ID | STRING) operator=('+:' | '-:' | '*:' | '/:' | ':|' | ':') value=Expression;

AssignmentStatement:
    target=Expression operator=('=' | '+=' | '-=' | '*=' | '/=' | '?=' | '|=') value=Expression ';';

LoopStatement:
    (label=ID ':')?
    'loop'
    ( (variable=ID 'from' lowerBound=Expression 'to' upperBound=Expression
        (stepClause=StepClause | whereClause=WhereGuard)?)
    | (variable=ID 'in' iterable=Expression (whereClause=WhereGuard)?)
    | condition=Expression
    )
    '{' (statements+=BodyStatement)* (tail=MainStatement)? '}';

StepClause:
    'by' step=Expression;

WhereGuard:
    'where' condition=Expression;

BreakStatement:
    'break' (label=ID)? ';';

ContinueStatement:
    'continue' (label=ID)? ';';

QualifiedName returns string:
    ID ('.' ID)*;

Expression:
    Or;

Or infers Expression:
    And ({infer BinaryExpression.left=current} operator='OR' right=And)*;

And infers Expression:
    Not ({infer BinaryExpression.left=current} operator='AND' right=Not)*;

Not infers Expression:
    {infer UnaryExpression} negated?='NOT' operand=Not
    | Comparison;

Comparison infers Expression:
    Additive (
        {infer BinaryExpression.left=current}
            operator=('==' | '!=' | '<=' | '>=' | '<' | '>' | 'IN' | 'LIKE')
            right=Additive
      | {infer TypeTestExpression.value=current}
            operator=('is' | 'isnot')
            test=JsonKind
    )?;

Additive infers Expression:
    Multiplicative ({infer BinaryExpression.left=current} operator=('+' | '-') right=Multiplicative)*;

Multiplicative infers Expression:
    Unary ({infer BinaryExpression.left=current} operator=('*' | '/' | '%') right=Unary)*;

Unary infers Expression:
    {infer UnaryExpression} operator=('-' | '+') operand=Unary
    | Postfix;

Postfix infers Expression:
    Primary (
        {infer MemberAccess.receiver=current} '.' member=ID vivify?='!'?
      | {infer TupleAccess.receiver=current} '[' index=NUMBER ']'
      | {infer FilterAccess.receiver=current} '[' filter=Expression ']'
      | {infer CallExpression.callee=current} '(' (args+=Expression (',' args+=Expression)*)? ')'
    )*;

Primary infers Expression:
    StringLiteral
    | NumberLiteral
    | BooleanLiteral
    | NullLiteral
    | CurrentRecord
    | FieldValue
    | ParentRecord
    | NamedScope
    | CastExpr
    | GroupKeyRef
    | IndexRef
    | ListLiteral
    | JsonObjectLiteral
    | Subquery
    | ParenOrTuple
    | IfExpr
    | SwitchExpr
    | NameRef;

CurrentRecord infers Expression:
    {infer CurrentRecord} '.' (field=ID vivify?='!'?)?;

FieldValue infers Expression:
    {infer FieldValue} '$';

ParentRecord infers Expression:
    {infer ParentRecord} '^';

NamedScope infers Expression:
    {infer NamedScope} '#' name=ID;

CastExpr infers Expression:
    {infer CastExpr} 'CAST' '(' value=Expression 'AS' targetType=TypeRef ')';

JsonKind:
    NullLiteral | ArrayKind | ObjectKind | StringKind | NumberKind | BooleanKind;

ArrayKind infers Expression:
    {infer ArrayKind} 'array';

ObjectKind infers Expression:
    {infer ObjectKind} 'object';

StringKind infers Expression:
    {infer StringKind} 'string';

NumberKind infers Expression:
    {infer NumberKind} 'number';

BooleanKind infers Expression:
    {infer BooleanKind} 'boolean';

GroupKeyRef infers Expression:
    {infer GroupKeyRef} 'KEY';

IndexRef infers Expression:
    {infer IndexRef} '.$index';

NameRef infers Expression:
    {infer NameRef} name=ID;

StringLiteral infers Expression:
    {infer StringLiteral} value=STRING;

NumberLiteral infers Expression:
    {infer NumberLiteral} value=NUMBER;

BooleanLiteral infers Expression:
    {infer BooleanLiteral} value=('true' | 'false');

NullLiteral infers Expression:
    {infer NullLiteral} ('null' | 'NULL');

ListLiteral infers Expression:
    {infer ListLiteral} '[' (items+=Expression (',' items+=Expression)*)? ']';

JsonObjectLiteral infers Expression:
    {infer JsonObjectLiteral} '{' (properties+=JsonProperty (',' properties+=JsonProperty)*)? '}';

JsonProperty:
    (key=ID (':' value=Expression)?) | (key=STRING ':' value=Expression);

Subquery infers Expression:
    {infer Subquery} '(' query=Query ')';

ParenOrTuple infers Expression:
    '(' Expression ({infer TupleLiteral.items+=current} (',' items+=Expression)+)? ')';

IfExpr infers Expression:
    {infer IfExpr} 'if' condition=Expression thenBranch=Block
    ('else' (elseIf=IfExpr | elseBranch=Block))?;

IfStatement:
    'if!' condition=Expression thenBranch=Block
    ('else' (elseIf=IfStatementElse | elseBranch=Block))?;

IfStatementElse:
    'if' condition=Expression thenBranch=Block
    ('else' (elseIf=IfStatementElse | elseBranch=Block))?;

SwitchExpr infers Expression:
    {infer SwitchExpr} 'switch' subject=Expression '{'
        (cases+=SwitchCase ',')*
        '_' '=>' defaultResult=SwitchResult
        ','?
    '}';

SwitchCase:
    values+=SwitchCaseValue (',' values+=SwitchCaseValue)* '=>' result=SwitchResult;

SwitchCaseValue:
    StringLiteral | NumberLiteral | BooleanLiteral | NullLiteral;

SwitchResult:
    Block | Expression;

Block infers Expression:
    {infer Block} '{' (statements+=BodyStatement)* (tail=MainStatement)? '}';

terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal STRING: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/;

hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
```

---

## 12. Open Design Questions

The language as specified in §§1–11 is stable: everything the grammar accepts has defined behavior, and the checker and evaluator implement it. The items below are questions and extensions that were deliberately deferred — each still open one is marked as such, and none changes what an existing, valid program means. Resolving one goes through the usual proposal → example → approval cycle and, when it does change the language, updates this spec and `docs/showcase.md` together.

1. **`CurrentRecord` AST shape for `.field` chains.** `.orders.total` currently collapses into `CurrentRecord(field: orders)` followed by a `MemberAccess(member: total)`. Confirm this shape matches evaluator expectations, versus a more uniform nested-member-access tree.
2. **`NOT` precedence relative to comparison.** As specified, `NOT x == y` parses as `NOT (x == y)`. Confirm this matches intent versus `(NOT x) == y`.
3. **`IN` / `LIKE` chaining.** Currently non-chaining, single-shot comparisons. Confirm this is sufficient (no need for `a < b < c`-style chains).
4. **Visual ambiguity between `[...]` list literals and `[...]` postfix filters.** Structurally distinct in the grammar (`Primary` vs. `Postfix` suffix) but may read ambiguously to humans, e.g. in `.status IN [1, 2, 3]` vs. `.orders[.status == "x"]`. Consider a different delimiter for one of the two if this proves confusing in practice.
5. ~~**Multi-token keyword handling.**~~ Resolved: `GROUPBY`, `ORDERBY`, `LEFTJOIN`, and `CROSSJOIN` are now single compound keywords (no space), so there's no risk of `GROUP`, `BY`, `LEFT`, or `CROSS` being misparsed as identifiers elsewhere.
6. ~~**Bare `alias.field` vs. required `#alias.field` for joined scopes.**~~ Resolved: bare `alias.field` is always allowed for any active scope; `#alias` is reserved for the case where an alias's name would otherwise collide with a real field name reachable in the same expression (§4.2).
7. ~~**Depth of implicit relation traversal before requiring an explicit subquery.**~~ Resolved: `ref` chains stay fully implicit at any depth. Crossing a `collection` field produces a collection-valued expression, which cannot be used directly as a scalar/boolean — it must be reduced via an aggregate (`SUM`, `COUNT`, ...) or a predicate over an inline filter (`EXISTS`, `ALL`, `ANY`) before use (§3.4). This is a semantic rule enforced by a type-checking pass, not by the grammar itself.
8. **Variable type checking.**
   - ~~Checking mechanism~~ Resolved: **literal initializers are checked immediately**, without needing cross-reference resolution — e.g. `let x: INTEGER = "hello"` is rejected outright, since a `StringLiteral` node can never satisfy an `INTEGER`-typed `TypeRef`; this is a local, structural check on the initializer node itself. The same immediate check now also covers `NullLiteral` against a type's nullability (§7.2) — `let x: INTEGER = null` is rejected the same way, unless `x` is declared `INTEGER?`. **Non-literal initializers** — `.total`, a subquery, a function call, another variable — can't be type-checked this way, because their type depends on something the parser hasn't resolved yet (a schema field's declared type, a function's return type, another `let`'s declared type). In Langium's pipeline (parse → link → validate), that information only becomes available after **linking**, so these checks run as ordinary Langium **validation-phase** checks, not at parse time.
   - **Still open:** should a second `let` for the same name be a redeclaration error, or an allowed rebinding?
9. **Function scoping and recursion.**
   - ~~Recursion, closures, and body shape~~ Resolved: recursion (including mutual recursion between two functions, regardless of declaration order) is allowed. There's no `return` keyword — a function body is any number of `let`/`BodyStatement` forms followed by exactly one trailing tail `Expression`/`Query` (no `;`), the same convention used at the top level (§6.3); the grammar's rule shape (`BodyStatement*` then an optional trailing tail) already rules out anything coming after the tail. What it doesn't enforce is that the tail is actually present — it's grammatically optional even though the declared return type is mandatory — so requiring a tail whenever a return type is declared is a semantic check, not a parse-time one. A function body can read `let`s from any enclosing scope (top-level, or an outer function), i.e. it closes over outer bindings; a same-named parameter or local `let` shadows the outer one.
   - **Retired, not resolved:** an earlier iteration of this item asked what a call `name(...)` should produce when a function both `yield`s and has a tail. That question is moot now — `yield`/`YieldStatement` have been removed from the grammar entirely (§8.2), rather than answered, since Minab has no iterator/generator protocol for a caller to consume a yielded sequence against in the first place. If something like `yield` returns, it needs its own design pass once iterators exist, not a reinstatement of this same keyword with the same open question attached.
10. ~~**`&` enforcement is semantic, not grammatical.**~~ **Resolved, then revised 2026-09-24 (§5.3, §5.3.1):** the first answer kept a grammar split between bare calls `Name(...)` (built-ins only) and `&name(...)` calls (user functions only), and reserved the eight built-in names. That is revised: `&` is removed from the language before any release. A user function is called `name(...)`, like a built-in (decisions D10, D11). The type checker looks the name up as a built-in first, then as a declared `fn`. Built-in names are ALL UPPERCASE and a `fn` name needs a lowercase letter, so a future built-in cannot collide with existing code; a `let` or parameter may not reuse a function's name, and a `fn` may not reuse a table name.
11. ~~**What does a scalar return type mean for a `Query`-tailed function?**~~ **Resolved (§8.6):** a `Query`-tailed function's result is `JSON` — a JSON array of whatever its `SELECT` produces (an array of objects for `SELECT *`, an array of that column's value type for a single-column `SELECT`). Its declared return type must therefore be `JSON`, checked once at the `FunctionDecl`, not per call site. A plain-`Expression`-tailed function is unaffected, scalar-valued exactly as declared.
12. ~~Should `if`/`else` branches accept a block, the way `switch` arms do?~~ **Resolved (§9.1):** `if`/`else` branches are now both `Block` (statements plus a tail), matching `switch` arms. No remaining asymmetry between the two.
13. **No constants.** `let` is mutable by default (§9.3) — Minab currently has no way to declare a binding that can't be reassigned. Worth deciding later whether a `const`-style immutable declaration is wanted, and if so, whether it's a modifier on `let` or a separate keyword.
14. ~~`if` as a statement.~~ **Resolved (§9.1.1):** added as `if!`/`IfStatement` — a distinct keyword from `if`/`IfExpr`, resolved at the lexer level (same longest-match mechanism as `isnot` vs. `is`), so there's no ambiguity between "one more `BodyStatement`" and "the tail." `else`/`else if` inside an `if!` reuse plain `if` (`IfStatementElse`), safe since that position is only reached after already committing to the statement form.
15. ~~`ref`/`collection` nullability marker.~~ **Resolved (§7.7):** not a syntax question — Minab has no schema-declaration syntax of its own, so there's nowhere to write a marker. Static nullability for a `ref` field is instead fetched from the real schema via the scope provider (the same channel that already resolves table/column metadata), and only that real `NOT NULL` fact determines whether traversal through a given `ref` is typed nullable — not a uniform "every `ref` is maybe-null" assumption. Runtime behavior doesn't change based on this either way: a `ref` propagates `null` defensively on traversal regardless of what the schema promised, per rule 1 above.
16. ~~Ordering comparisons and `IN` against `null`.~~ **Resolved (§7.7):** `null` is a valid operand only for `is`/`isnot`/`==`/`!=` — ordering comparisons (`<`/`>`/`<=`/`>=`) and `LIKE` against `null` are a semantic error, not `false` and not three-valued. `IN` against a list containing `null` is fine, precisely because `IN` is defined as repeated `==` under the hood.
17. **Vivify (`!`) on a `collection` path step.** §9.3's path-based assignment lets `!` auto-create a missing `ref` mid-path. Since a `collection` is never itself `null` (§7.7), `!` on a `collection` step has nothing to do — assumed to be a semantic error rather than silently ignored, but this hasn't been separately confirmed.
18. ~~Path-assignment target parsing — needs empirical verification.~~ **Resolved (2026-09-13):** run through Langium for real (`langium generate` + `tsc -b`, both clean, no ambiguity reported for this) and covered by dedicated parse tests (`AssignmentStatement` targets ranging from a bare name to `.a!.b.c!.d.e!` and a mid-path `[filter]`, including one sitting inside an `if`-expression branch right before that branch's own tail). The reasoning holds: `Postfix`'s deterministic, self-terminating parse followed by a single-token operator check is a fundamentally different shape from the original §6.3 bug. (Empirical verification during this same pass did turn up three *other* real defects — a clause-order regression, a missing `vivify` flag, and an `isnot` misuse — see `docs/roadmap.md` Phase 1 for detail; none of them were this specific risk.)
