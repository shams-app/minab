`let` declares a typed variable; `fn` declares a function with typed parameters and a typed result. A function's **last expression is its value** — there's no `return`.

User functions are called with **`&`**: `&discounted(200, 15)`. Bare names are reserved for the built-ins (`COUNT`, `SUM`, …), so the two can never collide.

### Your turn

Declare `let rate: DECIMAL = 20;` and use it to compute the price of a **1302.5** order with a 20% discount.
