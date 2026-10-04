import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tables, and the stored programs (`minab_program`). The table names are the ones the
 * schema in `schema.ts` gives to Minab: "Customer" and "Order" (quoted, as the compiler writes them).
 *
 * A program with an id and a version never changes. A new rule is a new version.
 */
export class Init1700000000000 implements MigrationInterface {
    name = 'Init1700000000000';

    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE "Customer" (id uuid PRIMARY KEY, name text NOT NULL)`);
        await runner.query(
            `CREATE TABLE "Order" (id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES "Customer"(id), status text NOT NULL, total numeric(12, 2) NOT NULL)`
        );
        await runner.query(
            `CREATE TABLE minab_program (id text NOT NULL, version text NOT NULL, source text NOT NULL, language_version text NOT NULL, PRIMARY KEY (id, version))`
        );
        const programs: [string, string, string][] = [
            ['order-limit', '1', 'COUNT(#Order[.customer == ^.customer AND .status == "open"]) <= 5'],
            [
                'top-customers',
                '1',
                'FROM Order\nGROUPBY .customer\nHAVING SUM(.total) > 1000\nSELECT KEY.name AS customer_name, SUM(.total) AS total_spent, COUNT(.) AS order_count\nORDERBY total_spent DESC'
            ]
        ];
        for (const [id, version, source] of programs) {
            await runner.query(`INSERT INTO minab_program (id, version, source, language_version) VALUES ($1, $2, $3, $4)`, [id, version, source, '0.3']);
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(`DROP TABLE minab_program`);
        await runner.query(`DROP TABLE "Order"`);
        await runner.query(`DROP TABLE "Customer"`);
    }
}
