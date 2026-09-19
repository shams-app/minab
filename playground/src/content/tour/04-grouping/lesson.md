`GROUPBY` collects rows into groups; aggregates like `COUNT`, `SUM` and `AVG` then work per group. **`KEY` is the group itself** — and because this program groups by `.customer` (a related row), `KEY.name` reads the customer's name.

`HAVING` filters groups, the way `WHERE` filters rows. `COUNT(.)` counts the rows in a group.

### Your turn

Add each customer's total spend as a column called `spent`, and keep only customers who spent **more than 1000**.
