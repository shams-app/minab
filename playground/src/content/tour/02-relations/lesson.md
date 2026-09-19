The schema knows that every order belongs to a customer: `customer` is a **ref** from `Order` to `Customer`. So you can walk it with dots — `.customer.name`, `.customer.country` — and never write a join.

Minab still produces ordinary SQL (a correlated lookup on the foreign key — check the **SQL** tab), but the *source* only says what you mean.

`AS` names an output column.

### Your turn

Add the customer's name as a column called `customer`, and keep only shipped orders from customers in the `"US"`.
