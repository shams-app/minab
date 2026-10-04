import type { MinabRuleContext, MinabSchema } from '@shamsine/minab';

type Base = 'UUID' | 'TEXT' | 'DECIMAL' | 'DATE';

const scalar = (base: Base) => ({ kind: 'scalar' as const, type: { kind: 'scalar' as const, base, nullable: false, array: false, arrayNullable: false } });

/**
 * The schema the browser knows. It is the one of the NestJS example, plus the two dates of the form.
 * The browser uses it to check programs. It never sends it to the server (decision D28).
 */
export const schema: MinabSchema = {
    version: 'browser-1',
    tables: [
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID') },
                { name: 'name', type: scalar('TEXT') },
                { name: 'orders', type: { kind: 'collection', table: 'Order', foreignKey: 'customer_id' } }
            ]
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID') },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: false, foreignKey: 'customer_id' } },
                { name: 'status', type: scalar('TEXT') },
                { name: 'start_date', type: scalar('DATE') },
                { name: 'end_date', type: scalar('DATE') },
                { name: 'total', type: scalar('DECIMAL') }
            ]
        }
    ]
};

/** A rule is attached to an order: a bare `.` is the order under validation. */
export const ruleContext: MinabRuleContext = { isFieldRule: false, recordTable: 'Order' };
