import { DataSource, type DataSourceOptions } from 'typeorm';
import { Init1700000000000 } from './migrations/1700000000000-init';

export const DEFAULT_DATABASE_URL = 'postgresql://minab:minab@localhost:5432/minab_example';

/** The TypeORM options: one place for the app, the migration script and the tests. */
export function dataSourceOptions(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): DataSourceOptions {
    return { type: 'postgres', url, migrations: [Init1700000000000], migrationsRun: false };
}

export function createDataSource(url?: string): DataSource {
    return new DataSource(dataSourceOptions(url));
}
