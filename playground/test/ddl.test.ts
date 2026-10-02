import { describe, expect, test } from 'vitest';
import { parseConfig } from '../../src/host/config.js';
import { createTableSql, databaseScript, physicalTables, sqlLiteral } from '../src/engine/ddl.js';

const schema = parseConfig({
    schema: {
        tables: [
            {
                name: 'Customer',
                primaryKey: 'id',
                columns: { id: 'UUID', email: 'CITEXT', tags: 'TEXT[]?', orders: { collection: 'Order', foreignKey: 'customer_id' } }
            },
            {
                name: 'Order',
                primaryKey: 'id',
                columns: { id: 'UUID', customer: { ref: 'Customer', foreignKey: 'customer_id' }, total: 'DECIMAL', meta: 'JSON?' }
            },
            { name: 'Line', columns: { order_id: 'UUID', qty: 'INTEGER' } }
        ]
    }
}).schema;

describe('physical tables', () => {
    test('a ref becomes its foreign key, typed like the target’s primary key', () => {
        const order = physicalTables(schema).find(t => t.name === 'Order')!;
        expect(order.columns.map(c => `${c.name}:${c.sqlType}:${c.nullable}`)).toEqual([
            'id:text:false',
            'total:numeric:false',
            'meta:jsonb:true',
            'customer_id:text:true'
        ]);
    });

    test('a collection adds nothing when the other side already declares the key', () => {
        const order = physicalTables(schema).find(t => t.name === 'Order')!;
        expect(order.columns.filter(c => c.name === 'customer_id')).toHaveLength(1);
    });

    test('array nullability is the column’s nullability', () => {
        const customer = physicalTables(schema).find(t => t.name === 'Customer')!;
        expect(createTableSql(customer)).toBe('CREATE TABLE "Customer" (\n  "id" text PRIMARY KEY,\n  "email" citext NOT NULL,\n  "tags" text[]\n);');
    });
});

describe('literals', () => {
    test.each([
        [null, 'text', 'NULL'],
        ["it's", 'text', "'it''s'"],
        [12.5, 'numeric', '12.5'],
        [true, 'boolean', 'TRUE'],
        ['2026-10-01', 'date', "'2026-10-01'::date"],
        [{ a: [1, "b'c"] }, 'jsonb', `'{"a":[1,"b''c"]}'::jsonb`],
        [['x', 'y'], 'text[]', "ARRAY['x', 'y']::text[]"]
    ])('%j as %s', (value, type, expected) => {
        expect(sqlLiteral(value, type)).toBe(expected);
    });

    test('rejects a value of the wrong kind', () => {
        expect(() => sqlLiteral('ten', 'numeric')).toThrow('expected a number');
    });
});

test('the script loads the citext extension only when a column needs it', () => {
    expect(databaseScript(schema)).toMatch(/^CREATE EXTENSION IF NOT EXISTS citext;/);
    const plain = parseConfig({ schema: { tables: [{ name: 'T', columns: { id: 'TEXT' } }] } }).schema;
    expect(databaseScript(plain)).not.toContain('citext');
});

test('seed rows for unknown tables are rejected', () => {
    expect(() => databaseScript(schema, { Nope: [] })).toThrow('seed: "Nope" is not a table in the schema');
});
