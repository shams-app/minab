import { afterAll, beforeAll } from 'vitest';
import { openTestDatabase, type TestDatabase } from '../support/database.js';
import { defineQueryCases, type QueryCase } from './harness.js';

/**
 * Every `cases/*.cases.ts` file is loaded here. To add cases, add a file:
 * no shared file changes. See `README.md`.
 */
const files = (import.meta as ImportMeta & { glob(pattern: string, options: { eager: true }): Record<string, { cases: QueryCase[] }> }).glob(
    './cases/*.cases.ts',
    { eager: true }
);

let db: TestDatabase;

beforeAll(async () => {
    db = await openTestDatabase();
}, 60000);

afterAll(async () => {
    await db?.close();
});

for (const [path, module] of Object.entries(files)) {
    defineQueryCases(path.replace('./cases/', ''), module.cases, () => db);
}
