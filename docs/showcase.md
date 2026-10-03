# Minab Showcase

A progression of Minab code, from the simplest possible rule to the most complex constructs the language currently supports. Every example here is valid against the current grammar in `query-language-spec.md` — **this file and the spec are kept in sync; when the grammar changes, both documents get updated together.**

Each example links back to the spec section it demonstrates, in case you want the full rationale behind why something is written the way it is.

---

## 1. Validation rules — the simplest possible programs

A bare expression, no wrapping statement at all. (§6)

**Record-level — the whole record is `.`:**
```
.end_date > .start_date
```

**Field-level — `$` is the value being checked, `.` still reaches sibling fields:**
```
$ >= 0 AND $ <= .customer.credit_limit
```

**Using a built-in aggregate:**
```
COUNT(.orders[.status == "cancelled"]) < 5
```

---

## 2. A correlated, cross-table validation rule

No `JOIN` or prior declaration needed — `#Table` opens any table inline. (§3.3, §6.1)

```
.end_date > .start_date AND NOT EXISTS(
    #Booking[. != ^ AND .room_id == ^.room_id
             AND .start_date < ^.end_date AND .end_date > ^.start_date]
)
```

*"This booking's dates don't overlap with any other booking for the same room."*

---

## 3. A first query

The pipeline layer. (§4)

```
FROM Order
WHERE .status == "shipped" AND .customer.country == "US"
SELECT .id, .total, .customer.name AS customer_name
ORDERBY .total DESC
LIMIT 20
```

**Select every column, no projection list:**
```
FROM Customers
SELECT *
```

**Deduplicated projection:**
```
FROM Order
SELECT DISTINCT .customer.country
```

---

## 4. Joins

Declared relations join like SQL; `LEFTJOIN`/`CROSSJOIN` behave as you'd expect. (§4.3)

```
FROM Order AS o
JOIN Shipment AS s ON o.tracking_code == s.tracking_code
WHERE s.status == "delivered"
SELECT o.id, o.total, s.delivered_at AS shipped_at
ORDERBY o.total DESC
LIMIT 20
```

```
FROM Product AS p
CROSSJOIN Warehouse AS w
SELECT p.name, w.name, p.id == w.default_product_id AS is_default
```

---

## 5. Grouping and aggregation

`KEY` is the group key; aggregates run naturally over the grouped collection. (§4.3, §3.1)

```
FROM Order
GROUPBY .customer
HAVING SUM(.total) > 1000
SELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count
ORDERBY total_spent DESC
```

---

## 6. Variables

Named, reusable values — computed once, referenced anywhere. (§7)

```
let min_amount: DECIMAL = 100.00;
let flagged_statuses: TEXT[] = ["flagged", "under_review"];

FROM Order
WHERE .total >= min_amount AND .status IN flagged_statuses
SELECT .id, .total
```

**A variable initialized from a subquery:**
```
let top_customer_id: UUID = (
    FROM Order
    GROUPBY .customer
    SELECT KEY.id
    ORDERBY SUM(.total) DESC
    LIMIT 1
);

.customer.id == top_customer_id
```

---

## 7. Casting, type-safe comparisons, and nullable types

No implicit coercion — cross-type comparisons need an explicit `CAST`. (§5.5)

```
CAST(.id AS TEXT) == rawIdParam
```

```
let thresholdInt: INTEGER = 500;

.total > CAST(thresholdInt AS DECIMAL)
```

**Nullable types** — a trailing `?` on the base type, the array suffix, or both, independently. (§7.2)

```
let age: INTEGER? = null;                    // fine: INTEGER? accepts null
let scores: INTEGER[]? = null;                // fine: the column itself can be null
let scores2: INTEGER[]? = [1, 2, 3];          // fine: or a non-null array
let scores3: INTEGER?[]? = [1, null, 3];      // fine: elements can be null too
```

```
let age: INTEGER = null;    // semantic error — INTEGER (no ?) can't hold null
```

**Compound and null-coalescing assignment** — `+=`/`-=`/`*=`/`/=` update relative to the current value; `?=` assigns only when the target is currently `null`. (§9.3)

```
let total: INTEGER = 0;
total += 5;    // 5
total -= 2;    // 3
total *= 4;    // 12
total /= 3;    // 4

let label: TEXT = "order";
label += "-42";    // "order-42"

let discount: DECIMAL? = null;
discount ?= 0.10;    // was null, so now 0.10
discount ?= 0.20;    // already 0.10 (not null), so this is a no-op

discount
```

**Null propagation and equality** — `.field` through a `null` `ref` is `null`, not an error; `==`/`isnot null` against `null` are ordinary equality, not SQL's three-valued logic; `null` is only a valid operand for `is`/`isnot`/`==`/`!=`. (§7.7)

```
.customer.country                   // null, if .customer is null — not an error
.customer.country == null           // same as: .customer.country is null
.total isnot null AND .total > 0
.status IN [null, "flagged"]        // fine — same as: .status == null OR .status == "flagged"
```

```
.total < null    // semantic error — < doesn't accept null as an operand
```

**Text `+`, division and `%`** — `+` joins two texts, `/` always gives a `DECIMAL`, `%` keeps the sign of the left side. (§5.1)

```
"Ada" + " " + "Lovelace"    // "Ada Lovelace"
```

```
"a" + null    // null — a null side gives null
```

```
7 / 2    // 3.5
```

```
-7 % 3    // -1
```

```
5 / 0    // evaluation error: eval.divisionByZero
```

---

## 8. Tuples

Fixed-size, ordered, positionally-accessed groups of (possibly different) types. (§7.6)

```
let point: (INTEGER, INTEGER) = (3, 4);

point[0] + point[1]   // 7
```

```
let labeled: (TEXT, DECIMAL) = ("shipping", 12.50);

labeled[0] == "shipping" AND labeled[1] > 10
```

---

## 9. `JSON` values, shape testing, and array access

A `JSON` value's shape isn't known statically — `is`/`isnot` test it, and array-typed `JSON` supports the same `[...]` your relational collections use, but with positional meaning. (§5.6, §7.3, §3.5)

```
let config: JSON = { theme: "dark", retries: 3, tags: ["a", "b"] };

if config is object { config } else { {} }
```

**Shorthand properties** — a bare identifier key with no `: value` reuses an in-scope `let` of the same name:
```
let someField: INTEGER = 5;
let someObject: JSON = { someField, anotherField: 10 };
// same as: { someField: someField, anotherField: 10 }
```

```
let tags: JSON = ["alpha", "beta", "gamma"];

tags[0]              // "alpha", positional — legal because tags is a JSON array
tags isnot null AND tags is array
```

**Equivalent ways to express "the item at position 2":**
```
.customers[2]

// same as:
FROM .customers
WHERE .$index == 2
SELECT .
```

---

## 10. Functions

Typed parameters, typed return, implicitly async, no `return` keyword — the body's tail is the result. (§8)

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

**Calling it, by name:**
```
FROM Customer
SELECT .id, discountedTotal(.id, .discount_rate) AS discounted
```

**A function whose tail is a `Query` always returns `JSON` — a JSON array of the selected shape (§8.6):**
```
fn cancelledOrdersFor(customerId: UUID): JSON {
    FROM Order
    WHERE .customer.id == customerId AND .status == "cancelled"
    SELECT .id
}
// cancelledOrdersFor(x) : JSON — an array of UUIDs, one per cancelled order
```

**Built-ins are ALL UPPERCASE, user function names need a lowercase letter — the two never collide (§5.3):**
```
COUNT(.orders) > 0              // built-in
discountedTotal(.id, 0.1)      // user-defined
```
```
fn SUM(x: INTEGER[]): INTEGER { 0 }   // ✗ semantic error — a function name needs a lowercase letter (built-in names are ALL UPPERCASE)
```

**Tuple return type, multiple `let`s in a body:**
```
fn swap(a: INTEGER, b: INTEGER): (INTEGER, INTEGER) {
    (b, a)
}

fn processOrder(orderId: UUID): BOOLEAN {
    let valid: BOOLEAN = (
        FROM Order WHERE .id == orderId SELECT .status == "pending"
    );
    valid
}
```

---

## 11. `if` — expression and statement — and `switch`

`if` is an **expression**: every branch is a full block — statements, then a tail — not just a single expression, and `else` is optional (an omitted `else` implicitly produces `null`, making the whole `if` nullable-typed). `if!` is a separate, genuine **statement** form — no value, usable anywhere a statement is, including mid-block. (§9.1, §9.1.1, §9.2)

```
let tier: TEXT = if .total > 1000 { "gold" } else if .total > 100 { "silver" } else { "bronze" };
```

**`else` is optional on the expression form — an else-less `if` implicitly evaluates to `null` on the false path, so its type is always nullable:**
```
let discount: DECIMAL? = if .tier == "gold" { 0.20 };
```

```
let discount: DECIMAL = if .tier == "gold" { 0.20 };    // semantic error — the if is DECIMAL?, not DECIMAL
```

**`if!` — pure control flow, no value at all, mid-block or anywhere else a statement goes:**
```
if! .status == "flagged" {
    let notified: BOOLEAN = notifyManager(.customer_id);
}

.total > 0
```

`if!`'s branches are ordinary `Block`s, same as the expression form — so the usual rule still applies: a bare function call can't sit as a statement on its own (§9.1), it still needs capturing into a `let`. What `if!` actually buys over the expression form: no tail requirement on its branches, no `else` needed at all, no nullable-type inference to worry about, and — the real difference — it doesn't have to be the last thing in its enclosing block. The document's own tail here is the separate validation expression `.total > 0` that follows.

```
let priority: INTEGER = switch .status {
    "urgent" => 1,
    "high" => 2,
    "normal", "low" => 3,
    _ => 0
};
```

**A value-producing `if` branch that runs statements before its tail — including a function call (note the call's result gets captured into a `let`, since there's no bare "call statement" that discards a result — only the usual statement forms):**
```
if .total > 1000 {
    total = total + 100;
    let notified: BOOLEAN = notifyManager(.customer_id);
    "flagged"
} else {
    "ok"
}
```

**A `switch` arm as a full block, mixed with plain-expression arms:**
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

---

## 12. Loops — all three forms

Statements, not expressions; a loop never produces a value. (§9.4)

**Range, with a step:**
```
let sumEven: INTEGER = 0;

loop n from 0 to 20 by 2 {
    sumEven = sumEven + n;
}

sumEven
```

**Range, with a filter instead of a step:**
```
let sumOdd: INTEGER = 0;

loop n from 1 to 20 where n % 2 != 0 {
    sumOdd = sumOdd + n;
}

sumOdd
```

**For-in, over a relational collection** (entering the loop pushes `.` to the current element, exactly like `[...]` filtering — `order` is just an alias for the same thing, and both spellings can mix freely, even in one expression):
```
let shippedTotal: DECIMAL = 0;

loop order in .orders where .status == "shipped" AND order.total > 0 {
    shippedTotal = shippedTotal + order.total;
}

shippedTotal > 500
```

**Bare-condition (`while`-style):**
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

**`break`/`continue` with no label** — the label is optional; unlabeled targets the innermost enclosing loop. This also uses `if!` (§9.1.1) — a genuine statement, not the value-producing `if`, so no trailing `null` tails are needed and it doesn't have to be the last thing in the block:
```
fn firstEvenOver(values: INTEGER[], threshold: INTEGER): INTEGER {
    let result: INTEGER = 0;
    let seen: INTEGER = 0;

    loop v in values {
        if! v % 2 != 0 {
            continue;
        }

        seen = seen + 1;

        if! v > threshold {
            result = v;
            break;
        }
    }

    result
}
```

**Labeled, nested, with `break`/`continue` targeting an outer loop** — labels are only needed once you have more than one loop to choose between:
```
fn firstPairOver(a: INTEGER[], b: INTEGER[], limit: INTEGER): INTEGER {
    let result: INTEGER = 0;

    outer: loop x in a {
        inner: loop y in b {
            if! x + y > limit {
                result = x + y;
                break outer;
            } else {
                continue inner;
            }
        }
    }

    result
}
```

---

## 13. Data manipulation — `INSERT` / `DELETE` / `UPDATE`

Statements, not expressions. (§10)

**Insert one row, insert from a table, insert from a filtered table, insert from a full query:**
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

**Delete by position, by inline filter, by `WHERE`, with a compound condition, with `ORDERBY`/`LIMIT`:**
```
DELETE .customers[2];
DELETE .customers[.city == 'Istanbul'];
DELETE .customers WHERE .city == 'Istanbul';
DELETE .customers[.city == 'Istanbul' AND ^.marked == true];
DELETE .customers WHERE .orders_total < 1000 ORDERBY .orders_total DESC LIMIT 10;
```

**Update — plain replacement, then the four compound operators, then `$index`-based targeting:**
```
UPDATE .customers[.city == 'Istanbul']
SET { checked: true };

UPDATE .customers
WHERE .city == 'Istanbul'
SET { puan +: 10, hardness /: 2, multiplier *: 2, reducer -: 10 };

UPDATE .customers
WHERE .city == 'Istanbul'
SET { address +: ' KARTAL/Istanbul' };

UPDATE .customers
WHERE .$index > 2
SET { address +: ' KARTAL/Istanbul' };

UPDATE .customers[.city == 'Istanbul']
SET { metadata :| { verified: true } };
```

**Path-based assignment** — walk a `.field` path directly and assign into it, no `UPDATE` needed for a single-record write. `!` creates a missing `ref` mid-path; without it, a `null` `ref` anywhere in the path makes the whole assignment a no-op:
```
.doctor.id = 21;                    // no-op if .doctor is null
.doctor!.id = 21;                   // creates .doctor first if it's null, then sets id
.a!.b.c!.d.e! = { name: 'x' };      // vivify at a, c, and e; b and d propagate null if missing
```

**Filtering mid-path, and `|=` to merge instead of replace:**
```
.doctor.patients[.city == 'Istanbul'].activate = true;
// same effect as:
UPDATE .doctor.patients
WHERE .city == 'Istanbul'
SET { activate: true };

.doctor |= { name: 'Dr. Smith' };                            // merge into .doctor, creating it if null
.doctor.patients[.city == 'Istanbul'] |= { checked: true };  // merge into every matching patient
```

---

## 14. Everything together

A function that queries, branches, loops, mutates via `UPDATE`, and calls another function — combining nearly every construct in the language in one place.

```
fn daysSincePayment(customerId: UUID): INTEGER {
    let days: INTEGER = (
        FROM Payment WHERE .customer_id == customerId SELECT .days_ago AS d ORDERBY d LIMIT 1
    );
    days
}

fn reconcileOverdueAccounts(cutoff: DECIMAL, graceDays: INTEGER): INTEGER {
    let flaggedCount: INTEGER = 0;

    loop customer in #Customers where .balance > cutoff {
        let daysLate: INTEGER = daysSincePayment(.id);

        let newStatus: TEXT = if daysLate > 90 {
            let notes: JSON = .metadata;
            if notes is object {
                "disputed"
            } else {
                "severe"
            }
        } else if daysLate > graceDays {
            "late"
        } else {
            "ok"
        };

        if! newStatus != "ok" {
            flaggedCount = flaggedCount + 1;

            UPDATE #Customers[.id == customer.id]
            SET { status: newStatus, flaggedAt +: 1 };

            if! newStatus == "severe" {
                INSERT #CollectionsQueue
                VALUES { customer_id: customer.id, reason: newStatus };
            }
        }
    }

    flaggedCount
}
```

Note the mix of bare `.field` and the named `customer.field`: entering the loop pushes `.` to mean the current customer, so `.balance`, `.id`, `.metadata` all work directly — but inside `#Customers[.id == customer.id]`, the `[...]` filter re-pushes `.` again (to mean each candidate row being filtered), so reaching back to the *loop's* customer needs either `customer.id` (the named alias) or `^.id` (one level up) — bare `.id` there would mean the wrong thing.

This one example alone touches: functions with typed params/return, `let`, `for-in` over an ad-hoc `#Table` with a `where` guard, a nested function call by name, an `if`/`else if`/`else` **expression** chain whose branches are full blocks (one with its own `let`/nested `if`), `if!` **statements** for pure control flow, `JSON` shape-testing with `is`, string comparison via `!=`, assignment, `UPDATE` with a plain and a compound `SET` field, a conditional `INSERT`, and the function's final tail as its return value.

Two things worth calling out about *why* it's written this way, not just what it does:
- **No `switch` here, deliberately.** `switch` case values must be literals (§9.2) — they can't be computed conditions like `daysLate > 90`. An `if`/`else if`/`else` chain is the correct tool whenever the branches depend on a computed comparison rather than matching a value against a fixed set.
- **The `if!`s inside the loop (§9.1.1) are genuine statements**, not the value-producing `if` — that's why they need no trailing `null` tail and no `else` at all when there's nothing to fall back to. Only `newStatus` itself, which produces a real `TEXT` value used right after, is built with the value-producing `if`/`else if`/`else` chain — the two forms coexist in the same function, each used where it actually fits.

---

## 15. Host inputs and host functions

*Spec §8.7.* The host (for example Shamsine) declares typed names that a program can use. They are not declared in Minab source. Here the host declared the input `currentUser` (a record with `id`, `email` and `roles`) and the function `fxRate(from: TEXT, to: TEXT): DECIMAL`.

```
.owner_id == currentUser.id OR "admin" IN currentUser.roles OR .total * fxRate("EUR", .currency) > 1000
```

`currentUser` is read-only and the host gives its value for each run. `fxRate` is the host's code: it runs in the interpreter and is never turned into SQL. A user `fn`, a `let` or a parameter cannot use these names:

```
let currentUser: TEXT = "x";      // error: "currentUser" is a host input
```

---

## 16. Names in any language, and quoted names

Names are not limited to ASCII (spec §2.3). A Persian field name is a plain name:

```
FROM سفارش
WHERE .وضعیت == "ارسال‌شده" AND .مبلغ > 100
SELECT .مبلغ AS مبلغ_کل
ORDERBY .مبلغ DESC
```

A name with spaces or symbols goes in backticks. A backtick also lets a keyword be a field name:

```
FROM Order
WHERE .`Order date` <= .`Ship date`
SELECT .id, .`FROM` AS source
```

Turkish letters work too: `.İl == "İzmir"`.

---

## 17. Text, null and number functions

*Spec §5.3.1.* Built-ins can take several arguments, and some arguments are optional. A `null` argument gives `null`, except in `COALESCE`, `GREATEST` and `LEAST`.

```
// Text
LENGTH(TRIM(.tracking_code)) >= 5
STARTS_WITH(.tracking_code, "BR-") OR ENDS_WITH(.tracking_code, "-X")
CONTAINS(.status, "%")               // a plain character: no wildcard
SUBSTRING(.tracking_code, 1, 3)
REPLACE(LOWER(.status), " ", "")
```

```
// Null
COALESCE(.customer.country, .customer.city)   // same type as .customer.city; not null
GREATEST(.total, 10)
LEAST(.total, 10, 100)
```

```
// Numbers
ROUND(.total * 1.09, 2)              // half away from zero, exact decimals
ABS(.total - 100)
FLOOR(.total)
CEIL(.total)
```

---

## 18. Dates, times and time zones

*Spec §5.3.1 and §7.2.* A run has a clock and a time zone from the host. `NOW()` is the instant the run started; `TODAY()` is its date in the run's time zone. The unit of `DATE_ADD` and `DATE_DIFF` is a text literal.

```
// A DATETIME column (an instant)
.placed_at < NOW()
YEAR(.placed_at) == 2026
HOUR(.placed_at) >= 9 AND HOUR(.placed_at) < 17    // in the run's time zone
DATE_DIFF(NOW(), .placed_at, "hour") > 48
DATE_ADD(.placed_at, 1, "day") > NOW()             // keeps the wall-clock time across daylight saving
CAST(.placed_at AS DATE) == TODAY()                // the date in the run's time zone
```

```
// A DATE column
.start_date < TODAY()
DATE_DIFF(TODAY(), .start_date, "day") > 30
DATE_ADD(.start_date, 1, "month") > .end_date      // Jan 31 + 1 month is Feb 28 (Feb 29 in a leap year)
DATE_DIFF(.end_date, .start_date, "week") <= 2
YEAR(.start_date) == 2026 AND MONTH(.start_date) == 10
```

```
// An unknown unit is an error: this is wrong on purpose
DATE_ADD(.start_date, 1, "fortnight")
```

---

## Keeping this in sync

Every construct shown here traces back to a specific section of `query-language-spec.md`. When the grammar changes — a new keyword, a new clause, a resolved open question — both files get updated in the same pass: the spec gets the grammar and rationale, this file gets a runnable example exercising it.

The runnable, tested counterparts of these snippets live in `examples/` (one directory per program, each with the config it runs against); `test/examples.test.ts` keeps them working. The showcase snippets themselves are parse-tested by `test/parsing.test.ts`, and are written against an implied schema — the examples are the ones you can actually `minab run`.
