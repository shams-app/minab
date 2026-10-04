import 'reflect-metadata';
import { createDataSource } from './data-source';

async function main(): Promise<void> {
    const dataSource = createDataSource();
    await dataSource.initialize();
    const ran = await dataSource.runMigrations();
    console.log(`migrations run: ${ran.length}`);
    await dataSource.destroy();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
