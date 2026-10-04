/**
 * The example gallery.
 *
 * The first eleven are the repository's own `examples/` — imported as raw
 * text, so the gallery can never drift from what `minab check` and the
 * repo's tests exercise. They run here against the Brewline demo database
 * instead of their canned fixtures, so the answers are real (and
 * different). The rest are written for the playground from the showcase
 * sections that execute today.
 *
 * Every entry's `expect` is asserted by `test/content.test.ts`.
 */

import bookingOverlap from '../../../../examples/booking-overlap/booking-overlap.minab?raw';
import cancelledOrdersLimit from '../../../../examples/cancelled-orders-limit/cancelled-orders-limit.minab?raw';
import customerExists from '../../../../examples/customer-exists/customer-exists.minab?raw';
import discountedTotal from '../../../../examples/discounted-total/discounted-total.minab?raw';
import firstQuery from '../../../../examples/first-query/first-query.minab?raw';
import orderDml from '../../../../examples/order-dml/order-dml.minab?raw';
import orderDmlConfig from '../../../../examples/order-dml/minab.config.json';
import orderStatusSwitch from '../../../../examples/order-status-switch/order-status-switch.minab?raw';
import overdueLoop from '../../../../examples/overdue-loop/overdue-loop.minab?raw';
import reconcile from '../../../../examples/reconcile-overdue-accounts/reconcile-overdue-accounts.minab?raw';
import reconcileConfig from '../../../../examples/reconcile-overdue-accounts/minab.config.json';
import shippingReport from '../../../../examples/shipping-report/shipping-report.minab?raw';
import topCustomers from '../../../../examples/top-customers/top-customers.minab?raw';
import type { Example, ExampleTag } from '../types.js';

const repo = (name: string) => `examples/${name}/${name}.minab`;

export const examples: Example[] = [
    // ---- the repository's examples ---------------------------------------
    {
        id: 'first-query',
        title: 'A first pipeline query',
        summary: 'Filter, walk a relation, sort and limit — no JOIN written.',
        notes: '`.customer.name` walks the `customer` **ref** from each order to its customer. The schema says how the tables link, so the source never spells out a join. Open **SQL** to see the correlated subquery the compiler wrote instead.',
        source: firstQuery,
        tags: ['query'],
        level: 'beginner',
        specRef: '§4',
        repoPath: repo('first-query'),
        host: { dataset: 'demo' },
        focus: 'sql',
        expect: { kind: 'rows', count: 4, first: { id: 'ord-190', total: 1302.5, customer_name: 'Margaret Hamilton' } }
    },
    {
        id: 'top-customers',
        title: 'Top customers',
        summary: '`GROUPBY` a relation, filter groups with `HAVING`, read the group through `KEY`.',
        notes: 'Grouping by `.customer` groups by the related **row**, so `KEY.name` reads a column straight off the customer — Minab turns that into a lookup on the foreign key, without a join in the source.',
        source: topCustomers,
        tags: ['query', 'aggregates'],
        level: 'intermediate',
        specRef: '§4.3',
        repoPath: repo('top-customers'),
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 5, first: { customer_name: 'Ada Lovelace', total_spent: 1863, order_count: 5 } }
    },
    {
        id: 'shipping-report',
        title: 'Shipping report',
        summary: 'An explicit `JOIN … ON` for tables the schema doesn’t relate.',
        notes: 'Orders and shipments share a `tracking_code`, but no `ref` connects them — so this one *does* need a join, and says so. Aliases (`o`, `s`) name each side.',
        source: shippingReport,
        tags: ['query', 'joins'],
        level: 'intermediate',
        specRef: '§4.3',
        repoPath: repo('shipping-report'),
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 9, first: { id: 'ord-185', total: 1010 } }
    },
    {
        id: 'cancelled-orders-limit',
        title: 'Fewer than five cancellations',
        summary: 'Filter a relation inline, then reduce it with `COUNT`.',
        notes: '`.orders[.status == "cancelled"]` narrows the orders of the customer being validated; `COUNT` turns the collection into a number you can compare. The whole count is one statement. Donald Knuth has five cancelled orders, so he fails.',
        source: cancelledOrdersLimit,
        tags: ['record-rule', 'aggregates'],
        level: 'beginner',
        specRef: '§3.4',
        repoPath: repo('cancelled-orders-limit'),
        host: { dataset: 'demo', rule: { recordTable: 'Customer' }, record: { id: 'cus-donald', name: 'Donald Knuth', tier: 'bronze' } },
        presets: [
            {
                id: 'donald',
                label: 'Donald',
                expect: false,
                note: 'Five cancelled orders.',
                record: { id: 'cus-donald', name: 'Donald Knuth', tier: 'bronze' }
            },
            { id: 'ada', label: 'Ada', expect: true, note: 'One cancellation.', record: { id: 'cus-ada', name: 'Ada Lovelace', tier: 'gold' } }
        ],
        focus: 'execution',
        expect: { kind: 'verdict', value: false, statements: 1 }
    },
    {
        id: 'booking-overlap',
        title: 'No double bookings',
        summary: 'A record-level rule with a correlated check against every other booking.',
        notes: 'The rule validates **one booking** the host is about to save. `.end_date > .start_date` is answered from that record in memory; only `EXISTS(#Booking[…])` needs the table, so only it becomes SQL — one indexed lookup. Open **Execution** and hover the statement to see which part of the source it came from, then try the presets.',
        source: bookingOverlap,
        tags: ['record-rule'],
        level: 'intermediate',
        specRef: '§6.1',
        repoPath: repo('booking-overlap'),
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Booking' },
            record: { id: 'bkg-new', room_id: 'room-7', customer_id: 'cus-barbara', purpose: 'Board meeting', start_date: '2026-10-01', end_date: '2026-10-05' }
        },
        presets: [
            {
                id: 'free',
                label: 'Free slot',
                expect: true,
                note: 'Room 7 is free from Oct 1 to Oct 5 — the next booking starts on the 6th.',
                record: {
                    id: 'bkg-new',
                    room_id: 'room-7',
                    customer_id: 'cus-barbara',
                    purpose: 'Board meeting',
                    start_date: '2026-10-01',
                    end_date: '2026-10-05'
                }
            },
            {
                id: 'overlap',
                label: 'Overlaps bkg-12',
                expect: false,
                note: 'Oct 4–8 collides with the espresso workshop (Oct 6–9) in the same room.',
                record: {
                    id: 'bkg-new',
                    room_id: 'room-7',
                    customer_id: 'cus-barbara',
                    purpose: 'Board meeting',
                    start_date: '2026-10-04',
                    end_date: '2026-10-08'
                }
            },
            {
                id: 'backwards',
                label: 'Ends before it starts',
                expect: false,
                note: 'The local half fails first, so the database is never asked — zero statements.',
                record: {
                    id: 'bkg-new',
                    room_id: 'room-7',
                    customer_id: 'cus-barbara',
                    purpose: 'Board meeting',
                    start_date: '2026-10-10',
                    end_date: '2026-10-08'
                }
            }
        ],
        focus: 'execution',
        expect: { kind: 'verdict', value: true, statements: 1 }
    },
    {
        id: 'customer-exists',
        title: 'The customer must exist',
        summary: 'A field-level rule: `$` is the value being validated.',
        notes: 'Field rules check one value — here the `customer_id` of an order being saved. The host says what `$` is and its type (`UUID`). The whole rule is one relational question, so it goes to the database as a single `EXISTS`.',
        source: customerExists,
        tags: ['field-rule'],
        level: 'beginner',
        specRef: '§6.2',
        repoPath: repo('customer-exists'),
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Order', fieldType: 'UUID' },
            record: { id: 'ord-new', customer_id: 'cus-ada', status: 'pending', total: 120 },
            fieldValue: 'cus-ada'
        },
        presets: [
            { id: 'known', label: 'cus-ada', expect: true, note: 'Ada Lovelace is a customer.', fieldValue: 'cus-ada' },
            { id: 'unknown', label: 'cus-404', expect: false, note: 'No customer has this id.', fieldValue: 'cus-404' }
        ],
        focus: 'execution',
        expect: { kind: 'verdict', value: true, statements: 1 }
    },
    {
        id: 'discounted-total',
        title: 'A user function',
        summary: 'Typed parameters, a typed return, called by name.',
        notes: 'The body’s last expression is the result — there is no `return`. A user function is called by its name, like a built-in. Its name needs a lowercase letter, which keeps ALL-CAPS names free for the built-ins (`COUNT`, `SUM`, …). Nothing here touches a table, so nothing reaches the database.',
        source: discountedTotal,
        tags: ['functions'],
        level: 'beginner',
        specRef: '§8',
        repoPath: repo('discounted-total'),
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'value', value: '170', statements: 0 }
    },
    {
        id: 'order-status-switch',
        title: 'Priority by status',
        summary: '`switch` is an expression — each arm is a rule of its own.',
        notes: 'Case values are literals; `_` is the default. Try the presets: the same order passes or fails depending on which arm its status selects.',
        source: orderStatusSwitch,
        tags: ['record-rule', 'control-flow'],
        level: 'intermediate',
        specRef: '§9.2',
        repoPath: repo('order-status-switch'),
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Order' },
            record: { id: 'ord-new', customer_id: 'cus-grace', status: 'high', total: 750 }
        },
        presets: [
            {
                id: 'high-750',
                label: 'high · 750',
                expect: true,
                note: '"high" needs a total over 500.',
                record: { id: 'ord-new', customer_id: 'cus-grace', status: 'high', total: 750 }
            },
            {
                id: 'high-400',
                label: 'high · 400',
                expect: false,
                note: '400 is under the "high" threshold.',
                record: { id: 'ord-new', customer_id: 'cus-grace', status: 'high', total: 400 }
            },
            {
                id: 'low-750',
                label: 'low · 750',
                expect: false,
                note: '"low" orders need a total over 5000.',
                record: { id: 'ord-new', customer_id: 'cus-grace', status: 'low', total: 750 }
            },
            {
                id: 'other',
                label: 'archived · 9000',
                expect: false,
                note: 'No arm matches, so `_ => false` decides.',
                record: { id: 'ord-new', customer_id: 'cus-grace', status: 'archived', total: 9000 }
            }
        ],
        focus: 'result',
        expect: { kind: 'verdict', value: true, statements: 0 }
    },
    {
        id: 'overdue-loop',
        title: 'Loops',
        summary: 'A `for-in` loop over a customer’s orders, with a guard.',
        notes: 'The orders are read once, then the loop runs in memory. Hover `order` to see its type. Each step counts toward the loop limit.',
        source: overdueLoop,
        tags: ['control-flow'],
        level: 'advanced',
        specRef: '§9.4',
        repoPath: repo('overdue-loop'),
        host: { dataset: 'demo', rule: { recordTable: 'Customer' }, record: { id: 'cus-donald', name: 'Donald Knuth', tier: 'bronze' } },
        focus: 'result',
        expect: { kind: 'verdict', value: false, statements: 1 }
    },
    {
        id: 'order-dml',
        title: 'Declarative writes',
        summary: '`UPDATE` with an inline filter and a compound `+:`, then `INSERT … VALUES`.',
        notes: 'Writes run as a dry run here: the Execution tab lists both statements and the tables stay as they are. Change `+: 10` to `+: "ten"` and watch the checker object. `minab run --apply` writes them in one transaction.',
        source: orderDml,
        tags: ['writes'],
        level: 'advanced',
        specRef: '§10',
        repoPath: repo('order-dml'),
        host: { dataset: { schema: orderDmlConfig.schema } },
        focus: 'result',
        expect: { kind: 'value', value: true, statements: 2 }
    },
    {
        id: 'reconcile-overdue-accounts',
        title: 'Everything together',
        summary: 'Functions, loops, `if`/`else if`, `is`, and writes in one program.',
        notes: 'The showcase’s finale. Every construct here type-checks against the host schema and runs. Writes are a dry run in the playground. This host has no rows, so the loop does not reach a write.',
        source: reconcile,
        tags: ['functions', 'control-flow', 'json', 'writes'],
        level: 'advanced',
        specRef: 'showcase §14',
        repoPath: repo('reconcile-overdue-accounts'),
        host: { dataset: { schema: reconcileConfig.schema } },
        focus: 'result',
        expect: { kind: 'value', value: 0, statements: 1 }
    },

    // ---- written for the playground ---------------------------------------
    {
        id: 'path-assignment',
        title: 'Assign through a relation',
        summary: 'Set a field of a related record from a loop: `.customer.tier = "gold"`.',
        notes: 'The path walks the `customer` ref of each delivered order and sets one column. It is a dry run here, so the Execution tab lists one `UPDATE` for each delivered order (nine of them) after the one read. A `null` ref would make the step a no-op; write `.customer!.tier` to create the missing record first, or `.customer |= { tier: "gold" }` to merge fields.',
        source: '// Assign through a path (spec §9.3). The loop\'s order is `.`.\nloop order in #Order where .status == "delivered" {\n    .customer.tier = "gold";\n}\ntrue\n',
        tags: ['writes', 'control-flow'],
        level: 'advanced',
        specRef: '§9.3',
        host: { dataset: 'demo' },
        focus: 'execution',
        expect: { kind: 'value', value: true, statements: 10 }
    },
    {
        id: 'statements-in-function',
        title: 'Statements in a function',
        summary: '`let`, `+=` and `if!` inside a function body.',
        notes: 'A body can hold statements before its last expression. `+=` changes a local name, `if!` runs a block for its effect, and the block has its own scope. Nothing here touches a table, so nothing reaches the database. Change `points` to `3` to take the `else` branch.',
        source: '// Bonus points: more for a big order, a little less for a small one.\nfn bonus(points: INTEGER): INTEGER {\n    let total: INTEGER = points;\n    if! points > 10 {\n        total += 5;\n    } else if points > 5 {\n        total += 2;\n    } else {\n        total -= 1;\n    }\n    total\n}\n\nbonus(12)\n',
        tags: ['functions', 'control-flow'],
        level: 'intermediate',
        specRef: '§9.1.1',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'value', value: 17, statements: 0 }
    },
    {
        id: 'debug-with-log',
        title: 'Debug with LOG',
        summary: '`LOG(value, label)` prints a value and gives it back.',
        notes: 'Open the **Console** tab. `LOG` records the value with its label and returns the value unchanged, so you can wrap any part of a rule. Click a line to select the call in the editor. A `LOG` inside a query runs in the database and prints nothing (you get a warning).',
        source: '// Bonus points, with the steps in the Console tab.\nfn bonus(points: INTEGER): INTEGER {\n    let total: INTEGER = LOG(points, "points");\n    if! points > 10 {\n        total += 5;\n    }\n    LOG(total, "total");\n    total\n}\n\nLOG(bonus(12), "bonus(12)")\n',
        tags: ['functions'],
        level: 'beginner',
        specRef: '§5.3.1',
        host: { dataset: 'demo' },
        focus: 'console',
        expect: { kind: 'value', value: 17, statements: 0, logs: ['points: 12', 'total: 17', 'bonus(12): 17'] }
    },
    {
        id: 'credit-limit',
        title: 'Within the credit limit',
        summary: 'A rule that walks from the record to a related row.',
        notes: '`.customer.credit_limit` isn’t on the order being validated — it lives on the customer. The interpreter pushes just that traversal down (looked up through the order’s key) and compares in memory. Ken’s limit is 800.',
        source: "// An order may not exceed its customer's credit limit.\n.total <= .customer.credit_limit\n",
        tags: ['record-rule'],
        level: 'beginner',
        specRef: '§6.1',
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Order' },
            record: { id: 'ord-200', customer_id: 'cus-ken', status: 'pending', total: 900 }
        },
        presets: [
            {
                id: 'over',
                label: 'total 900',
                expect: false,
                note: 'Over Ken’s 800 limit.',
                record: { id: 'ord-200', customer_id: 'cus-ken', status: 'pending', total: 900 }
            },
            {
                id: 'under',
                label: 'total 500',
                expect: true,
                note: 'Comfortably inside the limit.',
                record: { id: 'ord-200', customer_id: 'cus-ken', status: 'pending', total: 500 }
            }
        ],
        focus: 'execution',
        expect: { kind: 'verdict', value: false, statements: 1 }
    },
    {
        id: 'order-amount',
        title: 'A valid order amount',
        summary: 'A field rule mixing a local check with a relational one.',
        notes: '`$ >= 0` is settled from the value alone; `.customer.credit_limit` needs the database. Try **−5**: `AND` short-circuits, and no statement is sent at all.',
        source: '// The total being entered must be positive and within credit.\n$ >= 0 AND $ <= .customer.credit_limit\n',
        tags: ['field-rule'],
        level: 'intermediate',
        specRef: '§6.2',
        host: {
            dataset: 'demo',
            rule: { recordTable: 'Order', fieldType: 'DECIMAL' },
            record: { id: 'ord-200', customer_id: 'cus-ken', status: 'pending', total: 500 },
            fieldValue: 500
        },
        presets: [
            { id: 'ok', label: '500', expect: true, note: 'Positive and under 800.', fieldValue: 500 },
            { id: 'over', label: '950', expect: false, note: 'Above the customer’s limit.', fieldValue: 950 },
            { id: 'negative', label: '−5', expect: false, note: 'Fails locally — the database is never asked.', fieldValue: -5 }
        ],
        focus: 'execution',
        expect: { kind: 'verdict', value: true, statements: 1 }
    },
    {
        id: 'tiered-credit',
        title: 'Credit caps by tier',
        summary: '`let` with an `if` / `else if` expression, then a rule over it.',
        notes: '`if` is an expression that yields a value, so a variable can be computed from the record. Everything here is local — zero statements.',
        source: '// Each tier has a ceiling on the credit it may be granted.\nlet cap: DECIMAL = if .tier == "gold" {\n    5000\n} else if .tier == "silver" {\n    2500\n} else {\n    1000\n};\n\n.credit_limit <= cap\n',
        tags: ['record-rule', 'control-flow'],
        level: 'intermediate',
        specRef: '§9.1',
        host: { dataset: 'demo', rule: { recordTable: 'Customer' }, record: { id: 'cus-barbara', tier: 'silver', credit_limit: 2500 } },
        presets: [
            {
                id: 'silver-ok',
                label: 'silver · 2500',
                expect: true,
                note: 'Exactly at the silver cap.',
                record: { id: 'cus-barbara', tier: 'silver', credit_limit: 2500 }
            },
            {
                id: 'silver-over',
                label: 'silver · 3000',
                expect: false,
                note: 'Above the silver cap.',
                record: { id: 'cus-barbara', tier: 'silver', credit_limit: 3000 }
            },
            { id: 'gold', label: 'gold · 4000', expect: true, note: 'Gold allows up to 5000.', record: { id: 'cus-barbara', tier: 'gold', credit_limit: 4000 } }
        ],
        focus: 'result',
        expect: { kind: 'verdict', value: true, statements: 0 }
    },
    {
        id: 'with-tax',
        title: 'A function inside a rule',
        summary: 'Declare a `fn`, call it on the record by name.',
        notes: 'Functions run in the interpreter, next to the record — `withTax(.total, 21)` never becomes SQL.',
        source: 'fn withTax(amount: DECIMAL, rate: DECIMAL): DECIMAL {\n    amount + amount * rate / 100\n}\n\n// Orders over 1500 including VAT need approval.\nwithTax(.total, 21) <= 1500\n',
        tags: ['record-rule', 'functions'],
        level: 'intermediate',
        specRef: '§8',
        host: { dataset: 'demo', rule: { recordTable: 'Order' }, record: { id: 'ord-new', customer_id: 'cus-ada', status: 'pending', total: 980 } },
        presets: [
            {
                id: 'small',
                label: 'total 980',
                expect: true,
                note: '980 + 21% = 1185.80.',
                record: { id: 'ord-new', customer_id: 'cus-ada', status: 'pending', total: 980 }
            },
            {
                id: 'large',
                label: 'total 1302.50',
                expect: false,
                note: '1302.50 + 21% = 1576.03.',
                record: { id: 'ord-new', customer_id: 'cus-ada', status: 'pending', total: 1302.5 }
            }
        ],
        focus: 'result',
        expect: { kind: 'verdict', value: true, statements: 0 }
    },
    {
        id: 'never-ordered',
        title: 'Customers who never ordered',
        summary: '`COUNT` over a relation, compared with zero.',
        notes: 'A `collection` column (`.orders`) is a whole set of rows; `COUNT` is how you ask how many.',
        source: 'FROM Customer\nWHERE COUNT(.orders) == 0\nSELECT .name, .joined_on\n',
        tags: ['query', 'aggregates'],
        level: 'beginner',
        specRef: '§3.4',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 1, first: { name: 'Tim Berners-Lee' } }
    },
    {
        id: 'overlapping-bookings',
        title: 'Bookings that already collide',
        summary: 'A correlated `EXISTS` inside a query, using an alias.',
        notes: 'The same overlap test as the rule, turned into a report: `b` names the outer booking, `.` is each candidate inside the filter.',
        source: 'FROM Booking AS b\nWHERE EXISTS(#Booking[.id != b.id AND .room_id == b.room_id\n                     AND .start_date < b.end_date AND .end_date > b.start_date])\nSELECT b.id, b.room_id, b.purpose\nORDERBY b.id\n',
        tags: ['query'],
        level: 'advanced',
        specRef: '§4.2',
        host: { dataset: 'demo' },
        focus: 'sql',
        expect: { kind: 'rows', count: 2, first: { id: 'bkg-20' } }
    },
    {
        id: 'best-sellers',
        title: 'Best-selling products',
        summary: 'Group order lines by product; sum the quantities.',
        notes: '`GROUPBY .product` groups by a related row, so `KEY.name` is the product’s name.',
        source: 'FROM OrderLine\nGROUPBY .product\nSELECT KEY.name AS product, SUM(.quantity) AS units\nORDERBY units DESC\nLIMIT 5\n',
        tags: ['query', 'aggregates'],
        level: 'intermediate',
        specRef: '§4.3',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 5, first: { product: 'Single-Origin Beans 1 kg', units: 20 } }
    },
    {
        id: 'category-prices',
        title: 'Price by category',
        summary: 'Group by a plain column; `AVG` and `COUNT(.)`.',
        notes: 'Grouping by a scalar makes `KEY` that value itself. `COUNT(.)` counts the rows in each group.',
        source: 'FROM Product\nGROUPBY .category\nSELECT KEY AS category, AVG(.price) AS avg_price, COUNT(.) AS products\nORDERBY category\n',
        tags: ['query', 'aggregates'],
        level: 'beginner',
        specRef: '§4.3',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 5, first: { category: 'accessories', products: 3 } }
    },
    {
        id: 'order-items',
        title: 'Items per shipped order',
        summary: 'Aggregate a relation per row — `SUM(.lines.quantity)`.',
        notes: '`.lines.quantity` spreads one column across a collection; `SUM` reduces it, per order, in one query.',
        source: 'FROM Order\nWHERE .status == "shipped"\nSELECT .id, SUM(.lines.quantity) AS items, .total\nORDERBY .total DESC\n',
        tags: ['query', 'aggregates'],
        level: 'intermediate',
        specRef: '§3.4',
        host: { dataset: 'demo' },
        focus: 'sql',
        expect: { kind: 'rows', count: 6, first: { id: 'ord-190', items: 3 } }
    },
    {
        id: 'persian-names',
        title: 'Names in Persian',
        summary: 'Tables and fields with Persian names, and a backtick name when a name needs spaces.',
        notes: 'Plain names can use any language: here the table `سفارش` and its fields are Persian, and `AS خریدار` names a result column. A name with spaces or symbols goes in backticks, like `.`Order date``. The row keys of the result are the Minab names.',
        source: '// سفارش‌های ارسال‌شده، از گران به ارزان\nFROM سفارش\nWHERE .وضعیت == "ارسال‌شده"\nSELECT .شناسه, .مشتری.نام AS خریدار, .مبلغ AS مبلغ_کل\nORDERBY .مبلغ DESC\n',
        tags: ['query'],
        level: 'beginner',
        specRef: '§2.3',
        host: { dataset: 'persian' },
        focus: 'result',
        expect: { kind: 'rows', count: 3, first: { شناسه: 102, خریدار: 'علی رضایی', مبلغ_کل: 1250 } }
    },
    {
        id: 'email-lookup',
        title: 'Case-insensitive lookup',
        summary: 'A `CITEXT` column and an explicit `CAST` — no implicit coercion.',
        notes: '`email` is `CITEXT`, so comparing it to a plain `TEXT` literal is a type error: Minab never coerces silently. `CAST` states the intent, and Postgres matches regardless of case. Delete the `CAST` to see the diagnostic.',
        source: 'FROM Customer\nWHERE .email == CAST("ADA.LOVELACE@EXAMPLE.COM" AS CITEXT)\nSELECT .name, .email\n',
        tags: ['query', 'types'],
        level: 'intermediate',
        specRef: '§5.5',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 1, first: { name: 'Ada Lovelace' } }
    },
    {
        id: 'strict-types',
        title: 'Strict types, on purpose',
        summary: 'Comparing TEXT with a number is caught before anything runs.',
        notes: 'This program is **broken on purpose**. The checker reports exactly where, and nothing reaches the database. Fix it by comparing with a string: `.status == "paid"`.',
        source: 'FROM Order\nWHERE .status == 5\nSELECT .id, .total\n',
        tags: ['query', 'types'],
        level: 'beginner',
        specRef: '§7.2',
        host: { dataset: 'demo' },
        focus: 'problems',
        expect: { kind: 'diagnostics', message: /requires an explicit CAST/ }
    },
    {
        id: 'recent-orders',
        title: 'Orders this month',
        summary: 'Dates compare with dates — a `CAST` turns the literal into one.',
        notes: 'There is no date literal; `CAST("2026-09-01" AS DATE)` is how a string becomes a `DATE`.',
        source: 'FROM Order\nWHERE .placed_on >= CAST("2026-09-01" AS DATE)\nSELECT .id, .status, .placed_on\nORDERBY .placed_on\n',
        tags: ['query', 'types'],
        level: 'beginner',
        specRef: '§5.5',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 10, first: { id: 'ord-140' } }
    },
    {
        id: 'biggest-order',
        title: 'A query as a value',
        summary: 'A parenthesized query becomes a variable.',
        notes: 'A subquery that selects one value can initialize a `let`. The query is pushed down; the variable lives in memory.',
        source: 'let biggest: DECIMAL = (FROM Order SELECT .total ORDERBY .total DESC LIMIT 1);\n\nbiggest\n',
        tags: ['query'],
        level: 'intermediate',
        specRef: '§5.4',
        host: { dataset: 'demo' },
        focus: 'execution',
        expect: { kind: 'value', value: '1302.5', statements: 1 }
    },
    {
        id: 'room-occupancy',
        title: 'Room occupancy',
        summary: 'Count a relation per row, sort by the alias.',
        notes: '`ORDERBY` can use an output alias (`bookings`) as well as an expression.',
        source: 'FROM Room\nSELECT .name, .capacity, COUNT(.bookings) AS bookings\nORDERBY bookings DESC\n',
        tags: ['query', 'aggregates'],
        level: 'beginner',
        specRef: '§4',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 3, first: { name: 'Harbor', bookings: 3 } }
    },
    {
        id: 'order-statuses',
        title: 'Distinct statuses',
        summary: '`SELECT DISTINCT` — one row per value.',
        notes: 'The simplest way to see what values a column holds.',
        source: 'FROM Order\nSELECT DISTINCT .status\nORDERBY .status\n',
        tags: ['query'],
        level: 'beginner',
        specRef: '§4',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'rows', count: 5, first: { status: 'cancelled' } }
    },
    {
        id: 'json-shape',
        title: 'JSON values and shape tests',
        summary: 'A JSON literal with `is object`.',
        notes: '`is` tests a JSON value’s shape (`object`, `array`, `string`, …) — a question SQL can’t ask directly, so it’s evaluated in memory.',
        source: 'let specs: JSON = { weight_kg: 12.5, voltage: 230 };\n\nspecs is object\n',
        tags: ['json', 'types'],
        level: 'beginner',
        specRef: '§5.6',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'value', value: true, statements: 0 }
    },
    {
        id: 'tuples',
        title: 'Tuples',
        summary: 'Typed tuples and positional access.',
        notes: 'Hover `point` to see `(INTEGER, INTEGER)`. A tuple holds a fixed number of values, and `point[0]` reads the first one.',
        source: 'let point: (INTEGER, INTEGER) = (3, 4);\n\npoint[0]\n',
        tags: ['types'],
        level: 'intermediate',
        specRef: '§7.6',
        host: { dataset: 'demo' },
        focus: 'result',
        expect: { kind: 'value', value: 3, statements: 0 }
    }
];

export const featuredExampleIds = ['booking-overlap', 'top-customers', 'credit-limit', 'email-lookup'];

export function exampleById(id: string): Example | undefined {
    return examples.find(e => e.id === id);
}

export const TAG_LABELS: Record<ExampleTag, string> = {
    query: 'Query',
    'record-rule': 'Record rule',
    'field-rule': 'Field rule',
    aggregates: 'Aggregates',
    joins: 'Joins',
    functions: 'Functions',
    'control-flow': 'Control flow',
    types: 'Types',
    json: 'JSON',
    writes: 'Writes',
    'check-only': 'Check-only'
};
