A **collection** column holds many rows: `.orders` is every order of the current customer. You can't compare a collection to a number directly — Minab makes you say how to reduce it, with `COUNT`, `SUM`, `EXISTS` and friends.

Square brackets **filter** a collection inline: `.orders[.status == "cancelled"]`. Inside the brackets, `.` is each order.

### Your turn

Add a `cancelled` column counting each customer's cancelled orders, and keep only customers with **at least one**.
