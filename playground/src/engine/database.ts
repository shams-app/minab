/**
 * The in-browser Postgres (PGlite): real SQL, real answers, no server.
 *
 * Minab's compiler emits PostgreSQL, so running what it produces against
 * an actual Postgres — compiled to WebAssembly and living in this worker —
 * is the honest demo: edit a query and the rows change, because a database
 * computed them. PGlite is imported lazily, so the WASM bundle is only
 * fetched once a program actually needs data.
 *
 * Results are normalized to what a JSON config would hold: `numeric` and
 * `bigint` become numbers, dates and times stay as the strings Postgres
 * prints. That keeps a row from the database and a row from a fixture
 * indistinguishable to the interpreter and to the UI.
 */

import type { PGlite } from '@electric-sql/pglite';
import type { MinabSchema } from '../../../src/language/schema.js';
import { physicalTables, quoteIdent } from './ddl.js';
import type { Row, SqlConsoleResult, TablePreview } from './protocol.js';

/** What the database should hold: a host's schema, its rows, and the script that builds them. */
export interface DatabaseContents {
    schema: MinabSchema;
    seed: Record<string, Row[]>;
    script: string;
}

export interface QueryOutcome {
    rows: Row[];
    columns: string[];
    affectedRows?: number;
}

export type DatabaseState = 'idle' | 'booting' | 'ready' | 'failed';

export class Database {
    private db?: PGlite;
    private booting?: Promise<PGlite>;
    private loadedScript?: string;
    state: DatabaseState = 'idle';
    error?: string;

    constructor(private readonly onState: (state: DatabaseState, error?: string) => void = () => {}) {}

    private setState(state: DatabaseState, error?: string): void {
        this.state = state;
        this.error = error;
        this.onState(state, error);
    }

    private async boot(): Promise<PGlite> {
        if (this.db) return this.db;
        if (!this.booting) {
            this.setState('booting');
            this.booting = (async () => {
                const [{ PGlite, types }, { citext }] = await Promise.all([
                    import('@electric-sql/pglite'),
                    import('@electric-sql/pglite/contrib/citext')
                ]);
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
                // Timestamps print in the session time zone; pin it so every visitor sees the same rows.
                await db.exec(`SET TIME ZONE 'UTC'`);
                this.db = db;
                return db;
            })().catch(e => {
                this.booting = undefined;
                this.setState('failed', (e as Error).message);
                throw e;
            });
        }
        return this.booting;
    }

    /** Boots if needed and makes the tables match `contents`, rebuilding them only when they differ. */
    async load(contents: DatabaseContents): Promise<PGlite> {
        const db = await this.boot();
        if (this.loadedScript !== contents.script) {
            try {
                await db.exec(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;\n${contents.script}`);
            } catch (e) {
                // A schema the host config allows but Postgres rejects (a reserved word, say) is the user's to fix, not a crash.
                this.loadedScript = undefined;
                throw new Error(`could not create the demo tables: ${(e as Error).message}`);
            }
            this.loadedScript = contents.script;
        }
        if (this.state !== 'ready') this.setState('ready');
        return db;
    }

    /** Restores the seed rows, undoing anything the SQL console changed. */
    async reset(contents: DatabaseContents): Promise<void> {
        this.loadedScript = undefined;
        await this.load(contents);
    }

    async query(contents: DatabaseContents, text: string, params: unknown[]): Promise<QueryOutcome> {
        const db = await this.load(contents);
        const result = await db.query<Row>(text, params, { rowMode: 'object' });
        return { rows: result.rows, columns: result.fields.map(f => f.name), affectedRows: result.affectedRows };
    }

    async preview(contents: DatabaseContents, table: string, limit: number): Promise<TablePreview> {
        const physical = physicalTables(contents.schema).find(t => t.name === table);
        if (!physical) throw new Error(`unknown table "${table}"`);
        const db = await this.load(contents);
        const order = physical.columns.find(c => c.primaryKey) ?? physical.columns[0];
        const rows = await db.query<Row>(
            `SELECT * FROM ${quoteIdent(table)}${order ? ` ORDER BY ${quoteIdent(order.name)}` : ''} LIMIT ${Math.max(0, Math.floor(limit))}`
        );
        const count = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`);
        return {
            table,
            columns: physical.columns.map(c => ({ name: c.name, type: c.minabType })),
            rows: rows.rows,
            total: count.rows[0]?.n ?? rows.rows.length
        };
    }

    /** The SQL console: any statements, run as-is against the demo database. */
    async console(contents: DatabaseContents, text: string): Promise<SqlConsoleResult> {
        const started = performance.now();
        try {
            const db = await this.load(contents);
            const results = await db.exec(text);
            return {
                statements: results.map(r => ({
                    columns: r.fields.map(f => f.name),
                    rows: r.rows as Row[],
                    affectedRows: r.affectedRows
                })),
                durationMs: performance.now() - started
            };
        } catch (e) {
            return { statements: [], error: (e as Error).message, durationMs: performance.now() - started };
        }
    }

    async close(): Promise<void> {
        await this.db?.close();
        this.db = undefined;
        this.booting = undefined;
        this.loadedScript = undefined;
    }
}
