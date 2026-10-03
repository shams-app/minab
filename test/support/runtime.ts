import { parseConfig } from '../../src/host/config.js';
import type { MinabSchema } from '../../src/language/schema.js';

/** A small schema, with a version, for the runtime tests. */
export function orderSchema(version = 'v1'): MinabSchema {
    const { schema } = parseConfig({
        schema: {
            tables: [
                { name: 'Customer', primaryKey: 'id', columns: { id: 'UUID', name: 'TEXT' } },
                { name: 'Order', primaryKey: 'id', columns: { id: 'UUID', customer_id: 'UUID', total: 'DECIMAL', status: 'TEXT' } }
            ]
        }
    });
    return { ...schema, version };
}
