import type { VersionedSchema } from '@shamsine/minab/nestjs';

type Base = 'UUID' | 'TEXT' | 'DECIMAL';

const scalar = (base: Base) => ({ kind: 'scalar' as const, type: { kind: 'scalar' as const, base, nullable: false, array: false, arrayNullable: false } });

/**
 * The schema Minab programs may read. It is the read surface: a program can see these tables and
 * columns and nothing else. The tables are the ones the migration makes.
 * Change it, and you must change `version`: prepared programs are cached by it.
 */
export const schema: VersionedSchema = {
    version: 'shop-1',
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
                { name: 'total', type: scalar('DECIMAL') }
            ]
        }
    ]
};
