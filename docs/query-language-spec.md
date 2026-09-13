# Minab Language Specification

**Status:** Draft
**Scope:** Language reference for the pipeline query layer and the standalone expression/validation layer.

---

## 1. Overview

Minab is a small language with two layers that share a single expression sub-language:

1. **Pipeline layer** — `FROM / JOIN / WHERE / GROUP BY / HAVING / SELECT / ORDER BY / LIMIT`, for querying tabular data. Produces a table (a stream of records) or, when reduced (e.g. by an aggregate `SELECT` with no `GROUP BY`), a single record.
2. **Expression layer** — a standalone sub-language usable without any `FROM`, for validation rules. Produces a scalar (typically boolean).

Because both layers share the same expression grammar, anything you can write in a `WHERE` clause you can also write as a standalone validation rule, and vice versa.

Design principle: **ad-hoc convenience over upfront declaration.** Any table can be referenced inline via `@TableName` anywhere an expression is expected — no prior `JOIN` or `USING` clause is required. This keeps validation rules and one-off cross-table checks short, at the cost of static analyzability (you cannot tell which tables a rule touches just by reading its header — you have to scan the body).

---

## 2. Context Sigils

Single-character (or single-keyword) tokens that resolve to a position in the current scope stack. These are the core of what makes the expression language usable both inside a pipeline and standalone.

| Symbol | Name | Meaning |
|---|---|---|
| `.` | `CurrentRecord` | The current record in the innermost active scope. `.field` accesses a field on it. |
| `$` | `FieldValue` | The value of the field currently being validated. Only meaningful inside a `field` rule. |
| `^` | `ParentRecord` | The enclosing scope's `.` — one level up. Used to "escape" a nested filter or subquery back to the row that opened it. |
| `@alias` | `NamedScope` | A named scope referencing any table, view, subquery, or join alias — e.g. `@Customer`, `@o`. Can be opened inline without a prior declaration. |
| `KEY` | `GroupKeyRef` | The group key, bound after a `GROUP BY` clause. |

### 2.1 Design rationale

- `.` and `$` are split rather than overloaded because they answer different questions: *"what record am I on"* vs. *"what value am I checking."* A field-level rule needs both simultaneously (e.g. compare the field's own value against something else on the same record).
- `^` is the cheap, positional escape hatch — "one level up, whatever that is." It requires no name and reads naturally in nested filters.
- `@alias` is the named, arbitrary-depth escape hatch — "this specific thing, however deep I am." It's what lets you jump into an entirely unrelated table.
- `KEY` is spelled out (not a symbol) because group keys are a comparatively rare, structurally distinct concept — it doesn't need to compete for a single character, and spelling it out avoids confusion with `.` inside a grouped pipeline (where `.` still refers to the current *row within the group*, not the key).

### 2.2 Scoping rule

Sigils resolve against a **scope stack**, pushed by:

- Entering a `FROM`/`JOIN` source (pushes the primary/aliased scope)
- Entering a `[...]` filter or index on a collection (pushes the collection's element as the new `.`)
- Entering a subquery `(...)` used as an expression
- Opening `@Table` inline (pushes that table's row scope, without affecting `.`)

`^` always refers to the scope immediately below the current one on the stack. `@alias` refers to a named scope regardless of stack depth.

---

## 3. Relational Fields & Traversal

Fields in the schema can be:

- **scalar** — an ordinary value
- **ref(Table)** — a many-to-one pointer to a single row in another table
- **collection(Table)** — a one-to-many pointer to a set of rows in another table

### 3.1 Traversal rule

- `.field` on a **record** follows the relation: for `scalar` it returns the value, for `ref` it returns the related record, for `collection` it returns the related collection.
- `.field` on a **collection** **broadcasts**: it returns a collection of that field's value across every element (comparable to XPath node-set access or `jq`'s `.[].field`).

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

For tables with **no declared relation**, open them inline with `@Table`:

```
EXISTS(@Customer[.id == $])
```

`@Customer` opens the whole `Customer` table as a scope. `.` inside `[...]` is each `Customer` row. `$` is the field value being validated (see §6). No `JOIN` or prior declaration is required.

---

## 4. Pipeline Layer

### 4.1 Clause order

```
FROM <source> [AS alias]
  [JOIN|LEFT JOIN|CROSS JOIN <source> AS alias [ON <expr>]]*
  [WHERE <expr>]
  [GROUP BY <expr> [, <expr>]*]
  [HAVING <expr>]
  [SELECT <expr> [AS alias] [, ...]]
  [ORDER BY <expr> [ASC|DESC] [, ...]]
  [LIMIT <n> [OFFSET <n>]]
```

Semantics per clause, in evaluation order:

1. **FROM** — establishes the primary scope. Its alias is implicit: fields on it are reachable as bare `.field` (or `alias.field`) without needing `@`.
2. **JOIN** — adds another scope. `ON` is an ordinary boolean expression comparing fields from any active scope. `LEFT JOIN` preserves unmatched left-side rows with nulls on the right; `CROSS JOIN` takes no `ON` and produces the full cross-product.
3. **WHERE** — filters the joined row stream.
4. **GROUP BY** — partitions the stream by one or more key expressions. Inside and after this clause, `.` refers to *a row within the current group* (so aggregate functions like `SUM(.total)` still work), and `KEY` refers to the group key.
5. **HAVING** — filters the *grouped* stream, evaluated after aggregation, so aggregate calls are valid here.
6. **SELECT** — projects final columns. Each item may be aliased with `AS`.
7. **ORDER BY** — sorts the (post-SELECT) result. `ASC` is the default.
8. **LIMIT / OFFSET** — truncates and pages the result.

### 4.2 Scope aliasing convention

- The **primary `FROM` scope** is implicit: use bare `.` or bare `alias.field`.
- **Every other joined scope** must be referenced as `@alias` if there is more than one non-primary scope active, to keep cardinality visually explicit. (Bare `alias.field` is also acceptable when unambiguous — see open question in §8.)

### 4.3 Examples

**Filter, project, sort:**
```
FROM Order
WHERE .status == "shipped" AND .customer.country == "US"
SELECT .id, .total, .customer.name AS customer_name
ORDER BY .total DESC
LIMIT 20
```

**Join on declared relation:**
```
FROM Order AS o
JOIN Shipment AS s ON o.tracking_code == s.tracking_code
WHERE s.status == "delivered"
SELECT o.id, o.total, s.delivered_at AS shipped_at
ORDER BY o.total DESC
LIMIT 20
```

**Group, aggregate, filter grouped data:**
```
FROM Order
GROUP BY .customer
HAVING SUM(.total) > 1000
SELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count
ORDER BY total_spent DESC
```

**Cross join:**
```
FROM Product AS p
CROSS JOIN Warehouse AS w
SELECT p.name, w.name, p.id == w.default_product_id AS is_default
```

---

## 5. Expression Language

### 5.1 Operator precedence (low → high)

```
OR
AND
NOT
comparison   (== != < <= > >= IN LIKE)
additive     (+ -)
multiplicative (* / %)
unary        (- +)
postfix      (.member  [filter]  (call))
primary      (literals, sigils, ( ), [ ])
```

Notes:

- `NOT` binds tighter than `AND`/`OR` but looser than comparison, and is right-recursive into itself: `NOT NOT x` is valid; `NOT x == y` parses as `NOT (x == y)`.
- `IN` and `LIKE` are **non-chaining** comparison operators — `a < b < c` is not valid, matching standard convention. `IN` expects a `ListLiteral` or any other collection-valued expression on the right — a collection field on the current record (`.allowed_statuses`), a field on another table opened via `@Table` (`@CategoryConfig.valid_categories`), etc. (see §6.2 for field-rule examples).
- List literals use `[...]` — e.g. `.status IN ["pending", "shipped"]`. This is grammatically distinct from the postfix filter `[...]` (one is a primary expression, the other suffixes a collection expression), but the two can look visually similar; see open question in §8.

### 5.2 Literals

| Kind | Syntax |
|---|---|
| String | `"..."` or `'...'` |
| Number | `123`, `12.5` |
| Boolean | `true`, `false` |
| Null | `null` |
| List | `[expr, expr, ...]` |

### 5.3 Functions

Functions are ordinary postfix calls: `name(arg, arg, ...)`. Aggregate functions (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`) and predicate functions (`EXISTS`, `ALL`, `ANY`) operate over collections, which are produced naturally by relational traversal (§3) or by inline filters.

```
EXISTS(.orders[.status == "cancelled"])
COUNT(.orders) > 0
AVG(.orders.total)
```

### 5.4 Subqueries as expressions

A full pipeline query in parentheses is a valid expression, evaluating to a collection or scalar depending on its shape:

```
FROM Customer
WHERE .id IN (FROM Order WHERE .status == "flagged" SELECT .customer_id)
```

---

## 6. Validation Layer

Validation drops the pipeline entirely — a bare expression (or a small set of dedicated statement forms) is a complete, executable rule.

### 6.1 `VALIDATE` — record-level rule

Evaluates a boolean expression against a whole record. `.` is the record being validated.

```
VALIDATE .end_date > .start_date
```

```
VALIDATE COUNT(.orders[.status == "cancelled"]) < 5
```

**Correlated cross-record check** (no declared relation to `Booking` required):

```
VALIDATE .end_date > .start_date AND NOT EXISTS(
    @Booking[. != ^ AND .room_id == ^.room_id
             AND .start_date < ^.end_date AND .end_date > ^.start_date]
)
```

Here `@Booking` opens every row of `Booking` as a scope; `.` inside `[...]` is each candidate booking; `^` reaches back to the booking under validation.

### 6.2 `field` — field-level rule

Evaluates a boolean expression against a single field. `$` is that field's value; `.` is still the enclosing record, so the rule can reference sibling fields.

```
field status:
    $ IN ["pending", "shipped", "cancelled"]

field total:
    $ >= 0 AND $ <= .customer.credit_limit
```

`IN`'s right-hand side isn't limited to a list literal — anything that evaluates to a collection works, including a collection-valued field on the current record or a field pulled from another table via `@Table`:

```
field status:
    $ IN .allowed_statuses

field category:
    $ IN @CategoryConfig.valid_categories
```

**Referential integrity check**, using an ad-hoc `@Table` scope:

```
field customer_id:
    EXISTS(@Customer[.id == $])
```

---

## 7. Grammar Reference (Langium)

The full grammar targeting the Langium playground:

```langium
grammar Minab

entry Model:
    statements+=Statement*;

Statement:
    Query | ValidateStatement | FieldRule;

Query:
    'FROM' source=QualifiedName ('AS' alias=ID)?
    joins+=JoinClause*
    (whereClause=WhereClause)?
    (groupByClause=GroupByClause)?
    (havingClause=HavingClause)?
    (selectClause=SelectClause)?
    (orderByClause=OrderByClause)?
    (limitClause=LimitClause)?;

JoinClause:
    (left?='LEFT' | cross?='CROSS')? 'JOIN' source=QualifiedName 'AS' alias=ID
    ('ON' condition=Expression)?;

WhereClause:
    'WHERE' condition=Expression;

GroupByClause:
    'GROUP' 'BY' keys+=Expression (',' keys+=Expression)*;

HavingClause:
    'HAVING' condition=Expression;

SelectClause:
    'SELECT' items+=SelectItem (',' items+=SelectItem)*;

SelectItem:
    expression=Expression ('AS' alias=ID)?;

OrderByClause:
    'ORDER' 'BY' items+=OrderItem (',' items+=OrderItem)*;

OrderItem:
    expression=Expression direction=('ASC' | 'DESC')?;

LimitClause:
    'LIMIT' limit=NUMBER ('OFFSET' offset=NUMBER)?;

ValidateStatement:
    'VALIDATE' condition=Expression;

FieldRule:
    'field' name=ID ':' condition=Expression;

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
    Additive ({infer BinaryExpression.left=current}
        operator=('==' | '!=' | '<=' | '>=' | '<' | '>' | 'IN' | 'LIKE')
        right=Additive)?;

Additive infers Expression:
    Multiplicative ({infer BinaryExpression.left=current} operator=('+' | '-') right=Multiplicative)*;

Multiplicative infers Expression:
    Unary ({infer BinaryExpression.left=current} operator=('*' | '/' | '%') right=Unary)*;

Unary infers Expression:
    {infer UnaryExpression} operator=('-' | '+') operand=Unary
    | Postfix;

Postfix infers Expression:
    Primary (
        {infer MemberAccess.receiver=current} '.' member=ID
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
    | GroupKeyRef
    | ListLiteral
    | Subquery
    | '(' Expression ')'
    | NameRef;

CurrentRecord infers Expression:
    {infer CurrentRecord} '.' (field=ID)?;

FieldValue infers Expression:
    {infer FieldValue} '$';

ParentRecord infers Expression:
    {infer ParentRecord} '^';

NamedScope infers Expression:
    {infer NamedScope} '@' name=ID;

GroupKeyRef infers Expression:
    {infer GroupKeyRef} 'KEY';

NameRef infers Expression:
    {infer NameRef} name=ID;

StringLiteral infers Expression:
    {infer StringLiteral} value=STRING;

NumberLiteral infers Expression:
    {infer NumberLiteral} value=NUMBER;

BooleanLiteral infers Expression:
    {infer BooleanLiteral} value=('true' | 'false');

NullLiteral infers Expression:
    {infer NullLiteral} 'null';

ListLiteral infers Expression:
    {infer ListLiteral} '[' (items+=Expression (',' items+=Expression)*)? ']';

Subquery infers Expression:
    {infer Subquery} '(' query=Query ')';

terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal STRING: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/;

hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
```

---

## 8. Open Design Questions

These are flagged but not yet resolved — worth deciding before the grammar is considered final:

1. **`CurrentRecord` AST shape for `.field` chains.** `.orders.total` currently collapses into `CurrentRecord(field: orders)` followed by a `MemberAccess(member: total)`. Confirm this shape matches evaluator expectations, versus a more uniform nested-member-access tree.
2. **`NOT` precedence relative to comparison.** As specified, `NOT x == y` parses as `NOT (x == y)`. Confirm this matches intent versus `(NOT x) == y`.
3. **`IN` / `LIKE` chaining.** Currently non-chaining, single-shot comparisons. Confirm this is sufficient (no need for `a < b < c`-style chains).
4. **Visual ambiguity between `[...]` list literals and `[...]` postfix filters.** Structurally distinct in the grammar (`Primary` vs. `Postfix` suffix) but may read ambiguously to humans, e.g. in `.status IN [1, 2, 3]` vs. `.orders[.status == "x"]`. Consider a different delimiter for one of the two if this proves confusing in practice.
5. **Multi-token keyword handling.** `GROUP BY`, `ORDER BY`, `LEFT JOIN`, `CROSS JOIN` are currently two separate tokens each rather than single compound keywords. Confirm this doesn't cause unwanted parses (e.g. `GROUP` or `BY` used as an identifier elsewhere).
6. **Bare `alias.field` vs. required `@alias.field` for joined scopes.** Currently the spec recommends `@alias` for every non-primary scope "if there is more than one," but also permits bare `alias.field` when unambiguous. Pick one rule and apply it consistently — likely candidates: (a) primary scope implicit, every other scope requires `@alias`, always; or (b) bare `alias.field` always allowed, `@alias` reserved only for cases where an alias collides with a real field name.
7. **Depth of implicit relation traversal before requiring an explicit subquery.** E.g., should `.customer.country` silently perform a join-equivalent lookup in `WHERE`/`SELECT`, or should crossing a to-many relation always require explicit `[...]` filtering or a subquery to keep query cost visible to the reader?
