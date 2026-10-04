import { randomUUID } from 'node:crypto';
import { LoggerService, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createDataSource } from '../src/data-source';

export interface Booted {
    app: INestApplication;
    dataSource: DataSource;
    /** Every line Nest's logger was given. */
    lines: string[];
}

/** Drops everything and runs the migration again, so each test file starts from the seeded programs. */
export async function resetDatabase(): Promise<void> {
    const dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.query('DROP SCHEMA public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await dataSource.runMigrations();
    await dataSource.destroy();
}

export async function boot(env: Record<string, string | undefined> = {}): Promise<Booted> {
    const before = new Map(Object.keys(env).map(key => [key, process.env[key]]));
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    const lines: string[] = [];
    const logger: LoggerService = {
        log: message => void lines.push(String(message)),
        error: message => void lines.push(String(message)),
        warn: message => void lines.push(String(message)),
        debug: message => void lines.push(String(message)),
        verbose: message => void lines.push(String(message))
    };
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication({ logger });
    await app.init();
    // The module reads some settings per request (NODE_ENV), so the environment stays set until the app closes.
    const close = app.close.bind(app);
    app.close = async () => {
        await close();
        for (const [key, value] of before) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };
    return { app, dataSource: app.get(DataSource), lines };
}

export async function addCustomer(dataSource: DataSource, name: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(`INSERT INTO "Customer" (id, name) VALUES ($1, $2)`, [id, name]);
    return id;
}

export async function addOrders(dataSource: DataSource, customerId: string, count: number, status = 'open', total = '10.00'): Promise<void> {
    for (let i = 0; i < count; i++) {
        await dataSource.query(`INSERT INTO "Order" (id, customer_id, status, total) VALUES ($1, $2, $3, $4)`, [randomUUID(), customerId, status, total]);
    }
}

export async function orderCount(dataSource: DataSource, customerId: string): Promise<number> {
    const rows = await dataSource.query(`SELECT COUNT(*)::int AS n FROM "Order" WHERE customer_id = $1`, [customerId]);
    return rows[0].n;
}
