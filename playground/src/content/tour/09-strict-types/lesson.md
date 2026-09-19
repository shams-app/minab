Minab **never converts types behind your back**. Comparing a `DATE` with a string is an error, reported before anything runs — with the exact span, in the editor and in **Problems**.

There is no date literal; `CAST("2026-09-01" AS DATE)` states the conversion explicitly. The same rule catches `TEXT` vs `CITEXT`, and `TEXT` vs numbers.

### Your turn

Fix the error so the query lists the orders placed on or after September 1st, 2026.
