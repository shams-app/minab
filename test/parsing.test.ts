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

describe('Minab grammar — smoke tests from the spec', () => {
    test('pipeline: filter, project, sort (spec §4.3)', async () => {
        await expectNoErrors(`
            FROM Order
            WHERE .status == "shipped" AND .customer.country == "US"
            SELECT .id, .total, .customer.name AS customer_name
            ORDER BY .total DESC
            LIMIT 20
        `);
    });

    test('pipeline: join on declared relation (spec §4.3)', async () => {
        await expectNoErrors(`
            FROM Order AS o
            JOIN Shipment AS s ON o.tracking_code == s.tracking_code
            WHERE s.status == "delivered"
            SELECT o.id, o.total, s.delivered_at AS shipped_at
            ORDER BY o.total DESC
            LIMIT 20
        `);
    });

    test('pipeline: group, aggregate, having (spec §4.3)', async () => {
        await expectNoErrors(`
            FROM Order
            GROUP BY .customer
            HAVING SUM(.total) > 1000
            SELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count
            ORDER BY total_spent DESC
        `);
    });

    test('pipeline: cross join (spec §4.3)', async () => {
        await expectNoErrors(`
            FROM Product AS p
            CROSS JOIN Warehouse AS w
            SELECT p.name, w.name, p.id == w.default_product_id AS is_default
        `);
    });

    test('validation: record-level rule with correlated subquery (spec §6.1)', async () => {
        await expectNoErrors(`
            VALIDATE .end_date > .start_date AND NOT EXISTS(
                @Booking[. != ^ AND .room_id == ^.room_id
                         AND .start_date < ^.end_date AND .end_date > ^.start_date]
            )
        `);
    });

    test('validation: field-level rules (spec §6.2)', async () => {
        await expectNoErrors(`
            field status:
                $ IN ["pending", "shipped", "cancelled"]
        `);
        await expectNoErrors(`
            field total:
                $ >= 0 AND $ <= .customer.credit_limit
        `);
        await expectNoErrors(`
            field customer_id:
                EXISTS(@Customer[.id == $])
        `);
    });

    // §5.1/§6.2: IN's right-hand side accepts any collection-valued
    // expression, not just a list literal — a collection field on the
    // current record, or a field on another table opened via @Table.
    test('validation: IN against a collection-valued expression (spec §5.1, §6.2)', async () => {
        await expectNoErrors(`
            field status:
                $ IN .allowed_statuses
        `);
        await expectNoErrors(`
            field category:
                $ IN @CategoryConfig.valid_categories
        `);
    });

    test('expression: subquery as expression (spec §5.4)', async () => {
        await expectNoErrors(`
            FROM Customer
            WHERE .id IN (FROM Order WHERE .status == "flagged" SELECT .customer_id)
        `);
    });
});
