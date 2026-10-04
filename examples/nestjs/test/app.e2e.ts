import request from 'supertest';
import { addCustomer, addOrders, boot, orderCount, resetDatabase, type Booted } from './support';

let ctx: Booted;

beforeAll(async () => {
    await resetDatabase();
    ctx = await boot();
});

afterAll(async () => {
    await ctx.app.close();
});

const server = () => ctx.app.getHttpServer();

describe('POST /orders/validate (a stored rule in the request transaction)', () => {
    test('commits an order the rule allows', async () => {
        const customerId = await addCustomer(ctx.dataSource, 'Ada');
        await addOrders(ctx.dataSource, customerId, 4);
        const answer = await request(server()).post('/orders/validate').send({ customerId, total: '25.50' }).expect(201);
        expect(answer.body).toMatchObject({ ok: true });
        expect(await orderCount(ctx.dataSource, customerId)).toBe(5);
    });

    test('rolls back and answers 422 with the rule id when the rule says false', async () => {
        const customerId = await addCustomer(ctx.dataSource, 'Grace');
        await addOrders(ctx.dataSource, customerId, 5);
        const answer = await request(server()).post('/orders/validate').send({ customerId, total: 10 }).expect(422);
        expect(answer.body).toMatchObject({ ok: false, rule: { id: 'order-limit', version: '1' } });
        // The new order was written, the rule saw it (6 open orders), and the rollback removed it.
        expect(await orderCount(ctx.dataSource, customerId)).toBe(5);
    });

    test('closed orders do not count against the limit', async () => {
        const customerId = await addCustomer(ctx.dataSource, 'Alan');
        await addOrders(ctx.dataSource, customerId, 8, 'closed');
        await request(server()).post('/orders/validate').send({ customerId, total: '1.00' }).expect(201);
        expect(await orderCount(ctx.dataSource, customerId)).toBe(9);
    });

    test('refuses a bad body with 400 and an unknown customer with 400', async () => {
        await request(server()).post('/orders/validate').send({ customerId: 'nope', total: '1' }).expect(400);
        await request(server()).post('/orders/validate').send({ customerId: '6f1d3e7c-1111-4222-8333-444455556666', total: '1' }).expect(400);
    });
});

describe('GET /reports/top-customers (a stored query)', () => {
    test('returns the customers over the threshold, biggest first', async () => {
        const big = await addCustomer(ctx.dataSource, 'Big Spender');
        const bigger = await addCustomer(ctx.dataSource, 'Bigger Spender');
        await addOrders(ctx.dataSource, big, 2, 'closed', '700.00');
        await addOrders(ctx.dataSource, bigger, 3, 'closed', '900.00');
        const answer = await request(server()).get('/reports/top-customers').expect(200);
        const names = (answer.body as { customer_name: string }[]).map(row => row.customer_name);
        expect(names.slice(0, 2)).toEqual(['Bigger Spender', 'Big Spender']);
        expect(answer.body[0]).toMatchObject({ customer_name: 'Bigger Spender' });
        expect(Number(answer.body[0].order_count)).toBe(3);
        expect(Number(answer.body[0].total_spent)).toBe(2700);
    });
});

describe('POST /minab/run (the run endpoint, stored programs only)', () => {
    test('runs a stored program by id and version', async () => {
        const customerId = await addCustomer(ctx.dataSource, 'Run Endpoint');
        const answer = await request(server())
            .post('/minab/run')
            .send({ v: 1, runs: [{ id: 'q', program: { ref: { id: 'top-customers', version: '1' } } }] })
            .expect(200);
        expect(answer.body).toMatchObject({ v: 1, results: [{ id: 'q', ok: true }] });
        expect(Array.isArray(answer.body.results[0].value)).toBe(true);
        expect(customerId).toBeTruthy();
    });

    test('refuses program text from the client', async () => {
        const answer = await request(server())
            .post('/minab/run')
            .send({ v: 1, runs: [{ id: 'x', program: { source: 'EXISTS(#Order)' } }] });
        expect(answer.status).toBe(400);
        expect(JSON.stringify(answer.body)).toMatch(/wire\./);
    });

    test('answers an unknown program in its own result', async () => {
        const answer = await request(server())
            .post('/minab/run')
            .send({ v: 1, runs: [{ id: 'x', program: { ref: { id: 'missing', version: '1' } } }] })
            .expect(200);
        expect(answer.body.results[0]).toMatchObject({ ok: false, error: { code: 'wire.programNotFound' } });
    });
});

describe('a broken stored program', () => {
    test('answers 422 with the diagnostic codes, and rolls back', async () => {
        // A new version holds the fix or the mistake. A version never changes once it is stored.
        await ctx.dataSource.query(`INSERT INTO minab_program (id, version, source, language_version) VALUES ('order-limit', '2', '.nope > 1', '0.3')`);
        const broken = await boot({ ORDER_LIMIT_VERSION: '2' });
        try {
            const customerId = await addCustomer(broken.dataSource, 'Broken');
            const answer = await request(broken.app.getHttpServer()).post('/orders/validate').send({ customerId, total: '5.00' }).expect(422);
            expect(JSON.stringify(answer.body)).toMatch(/"code":"[a-z]+\.[A-Za-z]+/);
            expect(JSON.stringify(answer.body)).not.toMatch(/SELECT|INSERT|stack/);
            expect(await orderCount(broken.dataSource, customerId)).toBe(0);
        } finally {
            await broken.app.close();
        }
    });
});

describe('logs in production mode (D37)', () => {
    const statements = (lines: string[]) => lines.filter(line => /SELECT|COUNT/.test(line));

    test('write the statements of a run in development (the control for the next test)', async () => {
        const development = await boot({ NODE_ENV: 'development' });
        try {
            const customerId = await addCustomer(development.dataSource, 'Chatty');
            await request(development.app.getHttpServer()).post('/orders/validate').send({ customerId, total: '1.00' }).expect(201);
            expect(statements(development.lines).length).toBeGreaterThan(0);
            expect(development.lines.join('\n')).not.toContain(customerId);
        } finally {
            await development.app.close();
        }
    });

    test('write nothing in production, even with statement logging asked for', async () => {
        const production = await boot({ NODE_ENV: 'production' });
        try {
            const customerId = await addCustomer(production.dataSource, 'Quiet');
            await request(production.app.getHttpServer()).post('/orders/validate').send({ customerId, total: '1.00' }).expect(201);
            expect(statements(production.lines)).toEqual([]);
        } finally {
            await production.app.close();
        }
    });
});
