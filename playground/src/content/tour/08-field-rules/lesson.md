A **field-level rule** validates a single value: **`$`**. The host decides which field and what type — here, the `total` (a `DECIMAL`) of an order being entered. The rest of the record is still reachable through `.`, including its relations.

### Your turn

Also require `$` to be **within the customer's credit limit** (`.customer.credit_limit`). The current value, 950, should then fail — Ken's limit is 800. Try the other presets too: `−5` fails without asking the database at all.
