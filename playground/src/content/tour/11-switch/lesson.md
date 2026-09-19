`if` and `switch` are **expressions**: they produce a value, so they can initialize a variable or sit inside a rule. `switch` compares one subject against literal cases; several values can share an arm (`"normal", "low" =>`), and `_` is the default.

This rule decides the minimum total an order needs, based on its priority.

### Your turn

Rewrite `minimum` with **`switch`**: `"urgent"` → 0, `"high"` → 500, `"normal"` or `"low"` → 5000, anything else → 100000.
