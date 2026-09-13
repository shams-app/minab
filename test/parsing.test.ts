import { EmptyFileSystem } from 'langium';
import { expandToString } from 'langium/generate';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinabServices } from '../src/language/minab-module.js';
import type { Model } from '../src/language/generated/ast.js';

let parse: ReturnType<typeof parseHelper<Model>>;

beforeAll(async () => {
    const services = createMinabServices(EmptyFileSystem);
    parse = parseHelper<Model>(services.Minab);
});

async function expectNoErrors(input: string): Promise<Model> {
    const doc = await parse(input);
    const errors = doc.parseResult.parserErrors;
    const lexErrors = doc.parseResult.lexerErrors;
    expect(lexErrors, expandToString`Lexer errors:\n${lexErrors.map(e => e.message).join('\n')}`).toHaveLength(0);
    expect(errors, expandToString`Parser errors:\n${errors.map(e => e.message).join('\n')}`).toHaveLength(0);
    return doc.parseResult.value;
}

// This suite is built from docs/showcase.md, section by section. Every
// example there is meant to be syntactically valid against
// docs/query-language-spec.md §11's grammar — some are flagged in the
// showcase as *semantic* errors, which must still parse cleanly (that
// distinction is only checkable once a Validator exists). Those cases
// are grouped at the end instead of skipped.

describe('§1 validation rules — bare expressions', () => {
    test('record-level rule', async () => {
        await expectNoErrors(`.end_date > .start_date`);
    });

    test('field-level rule', async () => {
        await expectNoErrors(`$ >= 0 AND $ <= .customer.credit_limit`);
    });

    test('built-in aggregate in a rule', async () => {
        await expectNoErrors(`COUNT(.orders[.status == "cancelled"]) < 5`);
    });
});

describe('§2 correlated cross-table rule', () => {
    test('inline #Table with NOT EXISTS and parent-record traversal', async () => {
        await expectNoErrors(`
            .end_date > .start_date AND NOT EXISTS(
                #Booking[. != ^ AND .room_id == ^.room_id
                         AND .start_date < ^.end_date AND .end_date > ^.start_date]
            )
        `);
    });
});

describe('§3 a first query', () => {
    test('filter, project, sort, limit', async () => {
        await expectNoErrors(`
            FROM Order
            WHERE .status == "shipped" AND .customer.country == "US"
            SELECT .id, .total, .customer.name AS customer_name
            ORDERBY .total DESC
            LIMIT 20
        `);
    });

    test('SELECT * with no projection list', async () => {
        await expectNoErrors(`
            FROM Customers
            SELECT *
        `);
    });

    test('SELECT DISTINCT', async () => {
        await expectNoErrors(`
            FROM Order
            SELECT DISTINCT .customer.country
        `);
    });
});

describe('§4 joins', () => {
    test('JOIN ... ON', async () => {
        await expectNoErrors(`
            FROM Order AS o
            JOIN Shipment AS s ON o.tracking_code == s.tracking_code
            WHERE s.status == "delivered"
            SELECT o.id, o.total, s.delivered_at AS shipped_at
            ORDERBY o.total DESC
            LIMIT 20
        `);
    });

    test('CROSSJOIN as a single compound keyword', async () => {
        await expectNoErrors(`
            FROM Product AS p
            CROSSJOIN Warehouse AS w
            SELECT p.name, w.name, p.id == w.default_product_id AS is_default
        `);
    });
});

describe('§5 grouping and aggregation', () => {
    test('GROUPBY, KEY, HAVING, aliased aggregate in ORDERBY', async () => {
        await expectNoErrors(`
            FROM Order
            GROUPBY .customer
            HAVING SUM(.total) > 1000
            SELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count
            ORDERBY total_spent DESC
        `);
    });
});

describe('§6 variables', () => {
    test('typed let declarations used in a query', async () => {
        await expectNoErrors(`
            let min_amount: DECIMAL = 100.00;
            let flagged_statuses: TEXT[] = ["flagged", "under_review"];

            FROM Order
            WHERE .total >= min_amount AND .status IN flagged_statuses
            SELECT .id, .total
        `);
    });

    test('let initialized from a subquery', async () => {
        await expectNoErrors(`
            let top_customer_id: UUID = (
                FROM Order
                GROUPBY .customer
                SELECT KEY.id
                ORDERBY SUM(.total) DESC
                LIMIT 1
            );

            .customer == top_customer_id
        `);
    });
});

describe('§7 casting and nullable types', () => {
    test('CAST in a comparison', async () => {
        await expectNoErrors(`CAST(.id AS TEXT) == rawIdParam`);
    });

    test('CAST of a variable to a different type', async () => {
        await expectNoErrors(`
            let thresholdInt: INTEGER = 500;

            .total > CAST(thresholdInt AS DECIMAL)
        `);
    });

    test('nullable base type, array type, and both independently', async () => {
        await expectNoErrors(`
            let age: INTEGER? = null;
            let scores: INTEGER[]? = null;
            let scores2: INTEGER[]? = [1, 2, 3];
            let scores3: INTEGER?[]? = [1, null, 3];
        `);
    });

    test('compound and null-coalescing assignment', async () => {
        await expectNoErrors(`
            let total: INTEGER = 0;
            total += 5;
            total -= 2;
            total *= 4;
            total /= 3;

            let label: TEXT = "order";
            label += "-42";

            let discount: DECIMAL? = null;
            discount ?= 0.10;
            discount ?= 0.20;

            discount
        `);
    });

    test('null propagation through a field path', async () => {
        await expectNoErrors(`.customer.country`);
    });

    test('null equality via == and isnot', async () => {
        await expectNoErrors(`.customer.country == null`);
        await expectNoErrors(`.total isnot null AND .total > 0`);
    });

    test('IN list containing null', async () => {
        await expectNoErrors(`.status IN [null, "flagged"]`);
    });
});

describe('§8 tuples', () => {
    test('tuple type, literal, and positional access', async () => {
        await expectNoErrors(`
            let point: (INTEGER, INTEGER) = (3, 4);

            point[0] + point[1]
        `);
    });

    test('mixed-type tuple', async () => {
        await expectNoErrors(`
            let labeled: (TEXT, DECIMAL) = ("shipping", 12.50);

            labeled[0] == "shipping" AND labeled[1] > 10
        `);
    });
});

describe('§9 JSON values, shape testing, array access', () => {
    test('JSON object literal and is-object test', async () => {
        await expectNoErrors(`
            let config: JSON = { theme: "dark", retries: 3, tags: ["a", "b"] };

            if config is object { config } else { {} }
        `);
    });

    test('shorthand JSON properties', async () => {
        await expectNoErrors(`
            let someField: INTEGER = 5;
            let someObject: JSON = { someField, anotherField: 10 };
        `);
    });

    test('positional access into a JSON array, and isnot/is shape tests', async () => {
        await expectNoErrors(`
            let tags: JSON = ["alpha", "beta", "gamma"];

            tags[0]
        `);
        await expectNoErrors(`
            let tags: JSON = ["alpha", "beta", "gamma"];

            tags isnot null AND tags is array
        `);
    });

    test('positional filter and its $index-based equivalent', async () => {
        await expectNoErrors(`.customers[2]`);
        await expectNoErrors(`
            FROM .customers
            WHERE .$index == 2
            SELECT .
        `);
    });
});

describe('§10 functions', () => {
    test('declaration with a subquery-backed body, called with &', async () => {
        await expectNoErrors(`
            fn discountedTotal(orderId: UUID, rate: DECIMAL): DECIMAL {
                let base: DECIMAL = (
                    FROM Order
                    WHERE .id == orderId
                    SELECT .total
                );
                base - (base * rate / 100)
            }

            FROM Customer
            SELECT .id, &discountedTotal(.id, .discount_rate) AS discounted
        `);
    });

    test('function whose tail is a Query (table-valued)', async () => {
        await expectNoErrors(`
            fn cancelledOrdersFor(customerId: UUID): UUID {
                FROM Order
                WHERE .customer == customerId AND .status == "cancelled"
                SELECT .id
            }
        `);
    });

    test('tuple return type and multi-let bodies', async () => {
        await expectNoErrors(`
            fn swap(a: INTEGER, b: INTEGER): (INTEGER, INTEGER) {
                (b, a)
            }

            fn processOrder(orderId: UUID): BOOLEAN {
                let valid: BOOLEAN = (
                    FROM Order WHERE .id == orderId SELECT .status == "pending"
                );
                valid
            }
        `);
    });
});

describe('§11 if/else expression, if! statement, switch', () => {
    test('if/else-if/else expression assigned to a let', async () => {
        await expectNoErrors(`
            let tier: TEXT = if .total > 1000 { "gold" } else if .total > 100 { "silver" } else { "bronze" };
        `);
    });

    test('else-less if expression is nullable', async () => {
        await expectNoErrors(`
            let discount: DECIMAL? = if .tier == "gold" { 0.20 };
        `);
    });

    test('if! as a mid-block statement, not the block tail', async () => {
        await expectNoErrors(`
            if! .status == "flagged" {
                let notified: BOOLEAN = &notifyManager(.customer_id);
            }

            .total > 0
        `);
    });

    test('switch expression with multi-value cases and mandatory default', async () => {
        await expectNoErrors(`
            let priority: INTEGER = switch .status {
                "urgent" => 1,
                "high" => 2,
                "normal", "low" => 3,
                _ => 0
            };
        `);
    });

    test('if expression branch with statements before its tail (assignment/tail disambiguation, §12 Q18)', async () => {
        await expectNoErrors(`
            if .total > 1000 {
                total = total + 100;
                let notified: BOOLEAN = &notifyManager(.customer_id);
                "flagged"
            } else {
                "ok"
            }
        `);
    });

    test('switch with a block arm containing its own let and nested if', async () => {
        await expectNoErrors(`
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
        `);
    });
});

describe('§12 loops', () => {
    test('range loop with a step, assignment inside the body (§12 Q18)', async () => {
        await expectNoErrors(`
            let sumEven: INTEGER = 0;

            loop n from 0 to 20 by 2 {
                sumEven = sumEven + n;
            }

            sumEven
        `);
    });

    test('range loop with a where guard instead of a step', async () => {
        await expectNoErrors(`
            let sumOdd: INTEGER = 0;

            loop n from 1 to 20 where n % 2 != 0 {
                sumOdd = sumOdd + n;
            }

            sumOdd
        `);
    });

    test('for-in loop over a relational collection with a where guard', async () => {
        await expectNoErrors(`
            let shippedTotal: DECIMAL = 0;

            loop order in .orders where .status == "shipped" AND order.total > 0 {
                shippedTotal = shippedTotal + order.total;
            }

            shippedTotal > 500
        `);
    });

    test('bare-condition (while-style) loop', async () => {
        await expectNoErrors(`
            fn countUntilOver(limit: INTEGER): INTEGER {
                let count: INTEGER = 0;
                let runningTotal: INTEGER = 0;

                loop runningTotal <= limit {
                    count = count + 1;
                    runningTotal = runningTotal + count;
                }

                count
            }
        `);
    });

    test('unlabeled break/continue inside if! statements', async () => {
        await expectNoErrors(`
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
        `);
    });

    test('labeled nested loops with labeled break/continue', async () => {
        await expectNoErrors(`
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
        `);
    });
});

describe('§13 data manipulation — INSERT / DELETE / UPDATE', () => {
    test('INSERT: literal row, whole table, filtered table, full query', async () => {
        await expectNoErrors(`
            INSERT .customers
            VALUES {name: 'hamed', surename: 'zakeri'};

            INSERT .customers
            VALUES #Customers;

            INSERT .customers
            VALUES #Customers[.city == 'Istanbul'];

            INSERT .customers
            VALUES FROM #Customers WHERE .city == 'Istanbul' SELECT .;
        `);
    });

    test('DELETE: by position, inline filter, WHERE, compound condition, ORDERBY/LIMIT', async () => {
        await expectNoErrors(`
            DELETE .customers[2];
            DELETE .customers[.city == 'Istanbul'];
            DELETE .customers WHERE .city == 'Istanbul';
            DELETE .customers[.city == 'Istanbul' AND ^.marked == true];
            DELETE .customers WHERE .orders_total < 1000 ORDERBY .orders_total DESC LIMIT 10;
        `);
    });

    test('UPDATE: plain SET, compound operators, $index targeting, merge operator', async () => {
        await expectNoErrors(`
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
        `);
    });

    test('path-based assignment with vivify (§12 Q17)', async () => {
        await expectNoErrors(`
            .doctor.id = 21;
            .doctor!.id = 21;
            .a!.b.c!.d.e! = { name: 'x' };
        `);
    });

    test('path-based assignment with a mid-path filter, and merge assignment', async () => {
        await expectNoErrors(`
            .doctor.patients[.city == 'Istanbul'].activate = true;

            .doctor |= { name: 'Dr. Smith' };
            .doctor.patients[.city == 'Istanbul'] |= { checked: true };
        `);
    });
});

describe('§14 everything together', () => {
    test('reconcileOverdueAccounts: functions, loops, nested if/if!, UPDATE, INSERT, &-calls', async () => {
        await expectNoErrors(`
            fn reconcileOverdueAccounts(cutoff: DECIMAL, graceDays: INTEGER): INTEGER {
                let flaggedCount: INTEGER = 0;

                loop customer in #Customers where .balance > cutoff {
                    let daysLate: INTEGER = &daysSincePayment(.id);

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
        `);
    });
});

// These are flagged in docs/showcase.md as *semantic* errors — rejected
// only once a Validator exists, not by the grammar. They must still
// parse cleanly; that's the property under test here, not their meaning.
describe('semantic errors that must still parse (no Validator yet)', () => {
    test('non-nullable type initialized with null', async () => {
        await expectNoErrors(`let age: INTEGER = null;`);
    });

    test('relational comparison against null', async () => {
        await expectNoErrors(`.total < null`);
    });

    test('else-less if assigned to a non-nullable type', async () => {
        await expectNoErrors(`let discount: DECIMAL = if .tier == "gold" { 0.20 };`);
    });
});
