/**
 * Brewline — the playground's demo world: an online coffee-gear shop with a
 * meeting-room annex. Small enough to read in the Data tab, rich enough
 * that every example gives an answer worth looking at:
 *
 *  - customers on both sides of the `HAVING SUM(.total) > 1000` line;
 *  - one customer (Donald) with five cancelled orders, so the
 *    cancelled-orders filter actually excludes someone;
 *  - shipped orders in and outside the US, delivered ones with shipments;
 *  - bookings that leave a free slot in room-7, and two in room-3 that
 *    already overlap;
 *  - a nullable country, a CITEXT email, a TEXT[] and a JSON column.
 *
 * It is a superset of every runnable repo example's schema, so those
 * programs run here unchanged. Order totals are computed from their lines,
 * so the numbers add up whichever way a query slices them.
 */

import type { Row } from '../../engine/protocol.js';
import type { Dataset } from './types.js';

const schema = {
    tables: [
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                name: 'TEXT',
                email: 'CITEXT',
                country: 'TEXT?',
                tier: 'TEXT',
                credit_limit: 'DECIMAL',
                joined_on: 'DATE',
                orders: { collection: 'Order', foreignKey: 'customer_id' },
                payments: { collection: 'Payment', foreignKey: 'customer_id' }
            }
        },
        {
            name: 'Order',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                customer: { ref: 'Customer', foreignKey: 'customer_id' },
                status: 'TEXT',
                total: 'DECIMAL',
                placed_on: 'DATE',
                tracking_code: 'TEXT?',
                lines: { collection: 'OrderLine', foreignKey: 'order_id' }
            }
        },
        {
            name: 'OrderLine',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                order: { ref: 'Order', foreignKey: 'order_id' },
                product: { ref: 'Product', foreignKey: 'product_id' },
                quantity: 'INTEGER',
                unit_price: 'DECIMAL'
            }
        },
        {
            name: 'Product',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                name: 'TEXT',
                category: 'TEXT',
                price: 'DECIMAL',
                in_stock: 'BOOLEAN',
                tags: 'TEXT[]',
                specs: 'JSON'
            }
        },
        {
            name: 'Shipment',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                tracking_code: 'TEXT',
                carrier: 'TEXT',
                status: 'TEXT',
                delivered_at: 'DATETIME?'
            }
        },
        {
            name: 'Payment',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                customer: { ref: 'Customer', foreignKey: 'customer_id' },
                amount: 'DECIMAL',
                paid_on: 'DATE',
                method: 'TEXT'
            }
        },
        {
            name: 'Room',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                name: 'TEXT',
                capacity: 'INTEGER',
                bookings: { collection: 'Booking', foreignKey: 'room_id' }
            }
        },
        {
            name: 'Booking',
            primaryKey: 'id',
            columns: {
                id: 'UUID',
                room_id: 'UUID',
                booked_by: { ref: 'Customer', foreignKey: 'customer_id' },
                purpose: 'TEXT',
                start_date: 'DATE',
                end_date: 'DATE'
            }
        }
    ]
};

const customers: Row[] = [
    { id: 'cus-ada', name: 'Ada Lovelace', email: 'Ada.Lovelace@Example.com', country: 'US', tier: 'gold', credit_limit: 5000, joined_on: '2024-02-11' },
    { id: 'cus-grace', name: 'Grace Hopper', email: 'grace@example.com', country: 'US', tier: 'gold', credit_limit: 4000, joined_on: '2024-03-02' },
    { id: 'cus-alan', name: 'Alan Turing', email: 'alan@example.co.uk', country: 'GB', tier: 'silver', credit_limit: 2500, joined_on: '2024-05-19' },
    { id: 'cus-edsger', name: 'Edsger Dijkstra', email: 'edsger@example.nl', country: 'NL', tier: 'silver', credit_limit: 2000, joined_on: '2024-06-07' },
    { id: 'cus-barbara', name: 'Barbara Liskov', email: 'barbara@example.com', country: 'US', tier: 'silver', credit_limit: 2500, joined_on: '2024-09-23' },
    { id: 'cus-donald', name: 'Donald Knuth', email: 'don@example.com', country: 'US', tier: 'bronze', credit_limit: 1000, joined_on: '2025-01-14' },
    { id: 'cus-margaret', name: 'Margaret Hamilton', email: 'margaret@example.com', country: 'US', tier: 'gold', credit_limit: 3000, joined_on: '2025-03-30' },
    { id: 'cus-ken', name: 'Ken Thompson', email: 'ken@example.com', country: null, tier: 'bronze', credit_limit: 800, joined_on: '2025-07-01' },
    { id: 'cus-radia', name: 'Radia Perlman', email: 'radia@example.com', country: 'US', tier: 'bronze', credit_limit: 1200, joined_on: '2025-11-12' },
    { id: 'cus-tim', name: 'Tim Berners-Lee', email: 'tim@example.ch', country: 'CH', tier: 'bronze', credit_limit: 1000, joined_on: '2026-04-08' }
];

const products: Row[] = [
    { id: 'prd-espresso', name: 'Lever Espresso Machine', category: 'machines', price: 890, in_stock: true, tags: ['espresso', 'manual'], specs: { weight_kg: 12.5, voltage: 230, boiler_ml: 800 } },
    { id: 'prd-grinder', name: 'Conical Burr Grinder', category: 'grinders', price: 389, in_stock: true, tags: ['espresso', 'filter'], specs: { burr_mm: 64, settings: 40 } },
    { id: 'prd-kettle', name: 'Gooseneck Kettle', category: 'brewing', price: 79, in_stock: true, tags: ['filter'], specs: { capacity_l: 0.9, temperature_control: true } },
    { id: 'prd-scale', name: 'Brew Scale', category: 'accessories', price: 23.5, in_stock: false, tags: ['espresso', 'filter'], specs: { precision_g: 0.1 } },
    { id: 'prd-tamper', name: 'Calibrated Tamper', category: 'accessories', price: 45, in_stock: true, tags: ['espresso'], specs: { diameter_mm: 58 } },
    { id: 'prd-dripper', name: 'Ceramic Dripper', category: 'brewing', price: 32, in_stock: true, tags: ['filter'], specs: { cups: [1, 4] } },
    { id: 'prd-beans', name: 'Single-Origin Beans 1 kg', category: 'coffee', price: 38, in_stock: true, tags: ['espresso', 'filter', 'fresh'], specs: { origin: 'Ethiopia', process: 'washed' } },
    { id: 'prd-filters', name: 'Paper Filters ×100', category: 'brewing', price: 6.5, in_stock: true, tags: ['filter'], specs: {} },
    { id: 'prd-cups', name: 'Cupping Set', category: 'accessories', price: 120, in_stock: false, tags: ['tasting'], specs: { pieces: 12 } }
];

const priceOf = new Map(products.map(p => [p.id as string, p.price as number]));

type Line = [product: string, quantity: number];

/** status · placed_on · tracking code (shipped and delivered orders only) · lines */
const orderSpecs: Array<[id: string, customer: string, status: string, placedOn: string, tracking: string | null, lines: Line[]]> = [
    ['ord-104', 'cus-ada', 'shipped', '2026-08-28', 'TRK-1042', [['prd-espresso', 1], ['prd-tamper', 2]]],
    ['ord-112', 'cus-ada', 'delivered', '2026-06-03', 'TRK-0981', [['prd-grinder', 1], ['prd-beans', 3]]],
    ['ord-121', 'cus-ada', 'delivered', '2026-07-15', 'TRK-1003', [['prd-cups', 1], ['prd-beans', 2], ['prd-filters', 4]]],
    ['ord-133', 'cus-ada', 'paid', '2026-09-12', null, [['prd-kettle', 1], ['prd-dripper', 1]]],
    ['ord-140', 'cus-ada', 'cancelled', '2026-09-01', null, [['prd-scale', 2]]],
    ['ord-87', 'cus-grace', 'shipped', '2026-09-05', 'TRK-1051', [['prd-grinder', 1], ['prd-scale', 1]]],
    ['ord-91', 'cus-grace', 'delivered', '2026-05-20', 'TRK-0950', [['prd-espresso', 1]]],
    ['ord-95', 'cus-grace', 'delivered', '2026-08-02', 'TRK-1020', [['prd-beans', 4], ['prd-filters', 2]]],
    ['ord-150', 'cus-alan', 'shipped', '2026-09-10', 'TRK-1060', [['prd-espresso', 1], ['prd-grinder', 1]]],
    ['ord-151', 'cus-alan', 'pending', '2026-09-17', null, [['prd-beans', 2]]],
    ['ord-160', 'cus-edsger', 'delivered', '2026-04-11', 'TRK-0902', [['prd-kettle', 1], ['prd-dripper', 2], ['prd-filters', 3]]],
    ['ord-161', 'cus-edsger', 'shipped', '2026-09-14', 'TRK-1066', [['prd-cups', 2]]],
    ['ord-170', 'cus-barbara', 'delivered', '2026-07-01', 'TRK-0990', [['prd-grinder', 1], ['prd-kettle', 1], ['prd-scale', 1]]],
    ['ord-171', 'cus-barbara', 'shipped', '2026-09-16', 'TRK-1070', [['prd-beans', 5]]],
    ['ord-172', 'cus-barbara', 'paid', '2026-09-18', null, [['prd-tamper', 1], ['prd-dripper', 1]]],
    ['ord-180', 'cus-donald', 'cancelled', '2026-02-02', null, [['prd-beans', 1]]],
    ['ord-181', 'cus-donald', 'cancelled', '2026-03-09', null, [['prd-filters', 2]]],
    ['ord-182', 'cus-donald', 'cancelled', '2026-04-21', null, [['prd-scale', 1]]],
    ['ord-183', 'cus-donald', 'cancelled', '2026-05-30', null, [['prd-dripper', 1]]],
    ['ord-184', 'cus-donald', 'cancelled', '2026-06-18', null, [['prd-kettle', 1]]],
    ['ord-185', 'cus-donald', 'delivered', '2026-08-20', 'TRK-1030', [['prd-espresso', 1], ['prd-cups', 1]]],
    ['ord-190', 'cus-margaret', 'shipped', '2026-09-11', 'TRK-1062', [['prd-espresso', 1], ['prd-grinder', 1], ['prd-scale', 1]]],
    ['ord-191', 'cus-margaret', 'delivered', '2026-06-25', 'TRK-0985', [['prd-cups', 1], ['prd-beans', 3]]],
    ['ord-200', 'cus-ken', 'delivered', '2026-05-05', 'TRK-0930', [['prd-dripper', 1], ['prd-filters', 2]]],
    ['ord-201', 'cus-ken', 'cancelled', '2026-07-09', null, [['prd-kettle', 1]]],
    ['ord-210', 'cus-radia', 'paid', '2026-09-15', null, [['prd-grinder', 1]]]
];

const orders: Row[] = [];
const orderLines: Row[] = [];
for (const [id, customer, status, placedOn, tracking, lines] of orderSpecs) {
    let total = 0;
    lines.forEach(([product, quantity], index) => {
        const unitPrice = priceOf.get(product)!;
        total += unitPrice * quantity;
        orderLines.push({
            id: `${id.replace('ord', 'lin')}-${index + 1}`,
            order_id: id,
            product_id: product,
            quantity,
            unit_price: unitPrice
        });
    });
    orders.push({
        id,
        customer_id: customer,
        status,
        total: Math.round(total * 100) / 100,
        placed_on: placedOn,
        tracking_code: tracking
    });
}

const deliveredAt: Record<string, string> = {
    'TRK-0981': '2026-06-06T14:20:00Z',
    'TRK-1003': '2026-07-18T09:05:00Z',
    'TRK-0950': '2026-05-23T16:45:00Z',
    'TRK-1020': '2026-08-05T11:30:00Z',
    'TRK-0902': '2026-04-15T10:10:00Z',
    'TRK-0990': '2026-07-04T13:55:00Z',
    'TRK-1030': '2026-08-24T08:40:00Z',
    'TRK-0985': '2026-06-28T17:25:00Z',
    'TRK-0930': '2026-05-08T12:00:00Z'
};

const carriers = ['DHL', 'UPS', 'PostNL'];
const shipments: Row[] = orders
    .filter(o => o.tracking_code !== null)
    .map((o, index) => ({
        id: `shp-${String(o.tracking_code).slice(4)}`,
        tracking_code: o.tracking_code,
        carrier: carriers[index % carriers.length],
        status: o.status === 'delivered' ? 'delivered' : 'in_transit',
        delivered_at: deliveredAt[o.tracking_code as string] ?? null
    }));

const payments: Row[] = [
    { id: 'pay-01', customer_id: 'cus-ada', amount: 503, paid_on: '2026-06-03', method: 'card' },
    { id: 'pay-02', customer_id: 'cus-ada', amount: 222, paid_on: '2026-07-15', method: 'card' },
    { id: 'pay-03', customer_id: 'cus-ada', amount: 980, paid_on: '2026-08-28', method: 'card' },
    { id: 'pay-04', customer_id: 'cus-grace', amount: 890, paid_on: '2026-05-20', method: 'invoice' },
    { id: 'pay-05', customer_id: 'cus-grace', amount: 165, paid_on: '2026-08-02', method: 'card' },
    { id: 'pay-06', customer_id: 'cus-grace', amount: 412.5, paid_on: '2026-09-05', method: 'card' },
    { id: 'pay-07', customer_id: 'cus-alan', amount: 1279, paid_on: '2026-09-10', method: 'invoice' },
    { id: 'pay-08', customer_id: 'cus-edsger', amount: 162.5, paid_on: '2026-04-11', method: 'paypal' },
    { id: 'pay-09', customer_id: 'cus-barbara', amount: 491.5, paid_on: '2026-07-01', method: 'card' },
    { id: 'pay-10', customer_id: 'cus-donald', amount: 1010, paid_on: '2026-08-20', method: 'invoice' },
    { id: 'pay-11', customer_id: 'cus-margaret', amount: 234, paid_on: '2026-06-25', method: 'card' },
    { id: 'pay-12', customer_id: 'cus-ken', amount: 45, paid_on: '2026-05-05', method: 'paypal' }
];

const rooms: Row[] = [
    { id: 'room-3', name: 'Lighthouse', capacity: 4 },
    { id: 'room-7', name: 'Harbor', capacity: 8 },
    { id: 'room-12', name: 'Atlas', capacity: 12 }
];

const bookings: Row[] = [
    { id: 'bkg-10', room_id: 'room-7', customer_id: 'cus-grace', purpose: 'Team offsite', start_date: '2026-09-28', end_date: '2026-09-30' },
    { id: 'bkg-12', room_id: 'room-7', customer_id: 'cus-alan', purpose: 'Espresso workshop', start_date: '2026-10-06', end_date: '2026-10-09' },
    { id: 'bkg-15', room_id: 'room-7', customer_id: 'cus-ada', purpose: 'Cupping class', start_date: '2026-10-20', end_date: '2026-10-22' },
    { id: 'bkg-20', room_id: 'room-3', customer_id: 'cus-edsger', purpose: 'Reading group', start_date: '2026-10-02', end_date: '2026-10-04' },
    { id: 'bkg-21', room_id: 'room-3', customer_id: 'cus-ken', purpose: 'Hack day', start_date: '2026-10-03', end_date: '2026-10-05' },
    { id: 'bkg-30', room_id: 'room-12', customer_id: 'cus-margaret', purpose: 'Launch review', start_date: '2026-11-02', end_date: '2026-11-03' }
];

export const demoDataset: Dataset = {
    id: 'demo',
    title: 'Brewline',
    description: 'An online coffee-gear shop with a meeting-room annex: customers, orders and their lines, products, shipments, payments, rooms and bookings.',
    schema,
    seed: {
        Customer: customers,
        Order: orders,
        OrderLine: orderLines,
        Product: products,
        Shipment: shipments,
        Payment: payments,
        Room: rooms,
        Booking: bookings
    }
};
