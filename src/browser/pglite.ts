/**
 * `@shamsine/minab/browser/pglite`: a data port over PGlite, Postgres in WebAssembly (phase H5).
 *
 * For demos, offline playgrounds and tests only. A production app sends data programs to the server
 * (decision D30). `@electric-sql/pglite` is an optional peer dependency: it is loaded when the port is made,
 * so an app that does not use this entry never fetches the WASM bundle.
 *
 * The tables come from a Minab schema (`src/host/ddl.ts`), the same way the playground makes them.
 * Nothing here may touch Node or the DOM.
 */

import { createTableSql, databaseScript, physicalTables } from '../host/ddl.js';
import type { Row } from '../language/minab-executor.js';
import type { MinabSchema } from '../language/schema.js';
import type { DataPort } from '../runtime/ports.js';

export interface PgliteDataPortOptions {
    schema: MinabSchema;
    /** Rows to insert, by table name. */
    seed?: Record<string, Row[]>;
    /** Extra SQL to run after the tables are made (for example more `INSERT`s). */
    script?: string;
}

export interface PgliteDataPort extends DataPort {
    /** Runs SQL as it is, for example to look at the demo tables. */
    exec(sql: string): Promise<void>;
    /** Closes the database. */
    close(): Promise<void>;
}

/** The tables of a schema, as `CREATE TABLE` text. Handy for a demo that makes its own database. */
export function schemaDdl(schema: MinabSchema): string {
    return physicalTables(schema).map(createTableSql).join('\n');
}

/**
 * Makes an in-memory PGlite database with `citext`, creates the tables of `schema`, inserts `seed`,
 * and returns a `DataPort`. `numeric` and `bigint` come back as numbers, dates and times as text,
 * so a row looks like one from a fixture.
 */
export async function createPgliteDataPort(options: PgliteDataPortOptions): Promise<PgliteDataPort> {
    const [{ PGlite, types }, { citext }] = await Promise.all([import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/citext')]);
    const asNumber = (value: string) => Number(value);
    const asText = (value: string) => value;
    const db = await PGlite.create({
        extensions: { citext },
        parsers: {
            [types.NUMERIC]: asNumber,
            [types.INT8]: asNumber,
            [types.DATE]: asText,
            [types.TIME]: asText,
            [types.TIMESTAMP]: asText,
            [types.TIMESTAMPTZ]: asText
        }
    });
    try {
        await db.exec(`SET TIME ZONE 'UTC'`);
        await db.exec(`${databaseScript(options.schema, options.seed)}\n${options.script ?? ''}`);
    } catch (error) {
        await db.close();
        throw new Error(`could not create the demo tables: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
    return {
        async execute(query) {
            const result = await db.query<Row>(query.text, query.params, { rowMode: 'object' });
            return result.rows;
        },
        async exec(sql) {
            await db.exec(sql);
        },
        close: () => db.close()
    };
}
