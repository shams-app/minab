import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { formatDiagnostic } from '../src/cli/diagnostics.js';
import { parseConfig } from '../src/host/config.js';
import { ALL_KEYWORDS } from './support/keywords.js';
import { openTestDatabase, type TestDatabase } from './support/database.js';
import { loadSchema, type SchemaSpec } from './support/minab.js';
import type { Row } from '../src/language/minab-executor.js';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { Model } from '../src/language/generated/ast.js';
import { createMinabServices } from '../src/language/minab-module.js';

/**
 * L3: names in any language, backtick names, physical names (`sqlName`).
 * Parse tests need no database. Run tests use PGlite (or the database in
 * `MINAB_TEST_DATABASE_URL`).
 */

let db: TestDatabase;
beforeAll(async () => {
    db = await openTestDatabase();
}, 60000);
afterAll(async () => {
    await db?.close();
});

const PERSIAN: SchemaSpec = {
    tables: [{ name: 'سفارش', primaryKey: 'شناسه', columns: { شناسه: 'INTEGER', وضعیت: 'TEXT', مبلغ: 'DECIMAL' } }]
};

async function run(spec: SchemaSpec, source: string, rows: Record<string, Row[]>) {
    const loaded = loadSchema(spec);
    return await db.isolated(loaded.script(rows), async () => {
        const program = await loaded.parse(source);
        if (program.errors.length > 0) return { errors: program.errors };
        const result = await loaded.run(program.model, db.executor);
        return { errors: [], result };
    });
}

describe('plain names in any language', () => {
    test('a Persian query parses, checks and runs', async () => {
        const out = await run(PERSIAN, 'FROM سفارش WHERE .وضعیت == "ارسال‌شده" SELECT .مبلغ AS مبلغ_کل', {
            سفارش: [
                { شناسه: 1, وضعیت: 'ارسال‌شده', مبلغ: 150 },
                { شناسه: 2, وضعیت: 'جدید', مبلغ: 20 }
            ]
        });
        expect(out.errors).toEqual([]);
        expect(out.result).toMatchObject({ ok: true });
        const rows = (out.result as { value: Row[] }).value;
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0])).toEqual(['مبلغ_کل']);
    });

    test('Turkish letters work, including dotted İ and dotless ı', async () => {
        const spec: SchemaSpec = { tables: [{ name: 'Adres', primaryKey: 'id', columns: { id: 'INTEGER', İl: 'TEXT', ılçe: 'TEXT' } }] };
        const out = await run(spec, 'FROM Adres WHERE .İl == "İzmir" SELECT .ılçe', {
            Adres: [
                { id: 1, İl: 'İzmir', ılçe: 'Konak' },
                { id: 2, İl: 'Ankara', ılçe: 'Çankaya' }
            ]
        });
        expect(out.errors).toEqual([]);
        expect((out.result as { value: Row[] }).value).toEqual([{ ılçe: 'Konak' }]);
    });

    test('a zero-width non-joiner is allowed inside a name', async () => {
        const loaded = loadSchema({ tables: [{ name: 'T', primaryKey: 'id', columns: { id: 'INTEGER', می‌خواهم: 'TEXT' } }] });
        expect((await loaded.parse('FROM T SELECT .می‌خواهم')).errors).toEqual([]);
    });

    test('a zero-width non-joiner at the start of a name is a syntax error', async () => {
        const loaded = loadSchema({ tables: [{ name: 'T', primaryKey: 'id', columns: { id: 'INTEGER' } }] });
        expect((await loaded.parse('FROM T SELECT .‌x')).errors.length).toBeGreaterThan(0);
    });

    test('a digit cannot start a name', async () => {
        const loaded = loadSchema({ tables: [{ name: 'T', primaryKey: 'id', columns: { id: 'INTEGER' } }] });
        expect((await loaded.parse('FROM T SELECT .1x')).errors.length).toBeGreaterThan(0);
    });
});

describe('backtick names', () => {
    const SPEC: SchemaSpec = {
        tables: [
            {
                name: 'Order',
                primaryKey: 'id',
                columns: { id: 'INTEGER', 'Order date': 'DATE?', 'Ship date': 'DATE?', FROM: 'TEXT?', 'a`b': 'INTEGER?', 'back\\slash': 'INTEGER?' }
            }
        ]
    };

    test('spaces and symbols', async () => {
        const out = await run(SPEC, 'FROM Order WHERE .`Order date` <= .`Ship date` SELECT .id', {
            Order: [
                { id: 1, 'Order date': '2026-01-01', 'Ship date': '2026-01-05' },
                { id: 2, 'Order date': '2026-02-09', 'Ship date': '2026-02-01' }
            ]
        });
        expect(out.errors).toEqual([]);
        expect((out.result as { value: Row[] }).value).toEqual([{ id: 1 }]);
    });

    test('a keyword inside backticks is a plain name', async () => {
        const out = await run(SPEC, 'FROM Order SELECT .`FROM` AS kind', { Order: [{ id: 1, FROM: 'x' }] });
        expect(out.errors).toEqual([]);
        expect((out.result as { value: Row[] }).value).toEqual([{ kind: 'x' }]);
    });

    test('an escaped backtick and an escaped backslash', async () => {
        const out = await run(SPEC, 'FROM Order SELECT .`a\\`b` AS x, .`back\\\\slash` AS y', { Order: [{ id: 1, 'a`b': 7, 'back\\slash': 8 }] });
        expect(out.errors).toEqual([]);
        expect((out.result as { value: Row[] }).value).toEqual([{ x: 7, y: 8 }]);
    });

    test('a backtick name can be a table, an alias and a select alias', async () => {
        const loaded = loadSchema({ tables: [{ name: 'Line items', primaryKey: 'id', columns: { id: 'INTEGER', qty: 'INTEGER' } }] });
        const program = await loaded.parse('FROM `Line items` AS `the item` WHERE `the item`.qty > 1 SELECT .qty AS `how many`');
        expect(program.errors).toEqual([]);
    });

    test('an unknown backtick field is reported with its name, without backticks', async () => {
        const loaded = loadSchema(SPEC);
        const { errors } = await loaded.parse('FROM Order SELECT .`No such field`');
        expect(errors.join('\n')).toContain('No such field');
        expect(errors.join('\n')).not.toContain('`No such field`');
    });

    test('an unclosed backtick is a syntax error', async () => {
        const loaded = loadSchema(SPEC);
        expect((await loaded.parse('FROM Order SELECT .`oops')).errors.length).toBeGreaterThan(0);
    });
});

describe('keywords stay keywords', () => {
    const services = createMinabServices(EmptyFileSystem);
    const parse = parseHelper<Model>(services.Minab);

    test('a Unicode name that starts like a keyword is a name', async () => {
        const doc = await parse('let FROMا: INTEGER = 1; FROMا');
        expect(doc.parseResult.parserErrors).toEqual([]);
    });

    test('every keyword still parses as a keyword, not as a name', async () => {
        // `let <kw>: INTEGER` must fail for each keyword that is a reserved word of the grammar.
        for (const keyword of ALL_KEYWORDS) {
            const doc = await parse(`let ${keyword}: INTEGER = 1;`);
            expect(doc.parseResult.parserErrors.length, keyword).toBeGreaterThan(0);
        }
    });

    test('the same words in backticks are names', async () => {
        for (const keyword of ALL_KEYWORDS) {
            const doc = await parse(`let \`${keyword}\`: INTEGER = 1;`);
            expect(doc.parseResult.parserErrors, keyword).toEqual([]);
        }
    });
});

describe('physical names (sqlName)', () => {
    const SPEC: SchemaSpec = {
        tables: [
            {
                name: 'Customer',
                sqlName: 'tbl_cust',
                primaryKey: 'شناسه',
                columns: {
                    شناسه: { type: 'INTEGER', sqlName: 'fld_id' },
                    نام: { type: 'TEXT', sqlName: 'fld_ab12' },
                    'we"ird': { type: 'INTEGER', sqlName: 'bad"name' }
                }
            }
        ]
    };
    const ROWS = {
        Customer: [
            { شناسه: 1, نام: 'Ada', 'we"ird': 5 },
            { شناسه: 2, نام: 'Bob', 'we"ird': 6 }
        ]
    };

    test('the SQL uses the physical names and the row keys are Minab names', async () => {
        const loaded = loadSchema(SPEC);
        let sql = '';
        const out = await db.isolated(loaded.script(ROWS), async () => {
            const program = await loaded.parse('FROM Customer WHERE .شناسه == 2 SELECT .نام');
            expect(program.errors).toEqual([]);
            return await loaded.run(program.model, {
                execute: async q => {
                    sql = q.text;
                    return await db.executor.execute(q);
                }
            });
        });
        expect(sql).toContain('"tbl_cust"');
        expect(sql).toContain('"fld_ab12"');
        expect(sql).toContain('"fld_id"');
        expect(sql).toContain('AS "نام"');
        expect(out).toMatchObject({ ok: true, value: [{ نام: 'Bob' }] });
    });

    test('a sqlName with a double quote is quoted safely', async () => {
        const out = await run(SPEC, 'FROM Customer WHERE .`we"ird` == 6 SELECT .نام', ROWS);
        expect(out.errors).toEqual([]);
        expect((out.result as { value: Row[] }).value).toEqual([{ نام: 'Bob' }]);
    });

    test('SELECT * keeps Minab names as row keys', async () => {
        const out = await run(SPEC, 'FROM Customer WHERE .شناسه == 1', ROWS);
        expect(out.errors).toEqual([]);
        expect((out.result as { value: Row[] }).value).toEqual([{ شناسه: 1, نام: 'Ada', 'we"ird': 5 }]);
    });

    test('primaryKey is a schema name, mapped through sqlName; foreignKey is a physical name', async () => {
        const spec: SchemaSpec = {
            tables: [
                {
                    name: 'Team',
                    sqlName: 't_team',
                    primaryKey: 'key',
                    columns: {
                        key: { type: 'INTEGER', sqlName: 'k' },
                        title: { type: 'TEXT', sqlName: 'ttl' },
                        members: { collection: 'Member', foreignKey: 'team_k' }
                    }
                },
                {
                    name: 'Member',
                    sqlName: 't_member',
                    primaryKey: 'id',
                    columns: { id: 'INTEGER', team: { ref: 'Team', foreignKey: 'team_k' } }
                }
            ]
        };
        const out = await run(spec, 'FROM Member WHERE .team.title == "Red" SELECT .id', {
            Team: [{ key: 1, title: 'Red' }],
            Member: [
                { id: 10, team_k: 1 },
                { id: 11, team_k: 2 }
            ]
        });
        expect(out.errors).toEqual([]);
        expect((out.result as { value: Row[] }).value).toEqual([{ id: 10 }]);
    });

    test('parseSchema accepts sqlName and rejects a bad one', () => {
        const ok = parseConfig({ schema: SPEC }).schema;
        expect(ok.tables[0].sqlName).toBe('tbl_cust');
        expect(ok.tables[0].columns.find(c => c.name === 'نام')?.sqlName).toBe('fld_ab12');
        expect(() => parseConfig({ schema: { tables: [{ name: 'T', sqlName: 3, columns: {} }] } })).toThrow(/sqlName/);
        expect(() => parseConfig({ schema: { tables: [{ name: 'T', columns: { a: { type: 'TEXT', sqlName: '' } } }] } })).toThrow(/sqlName/);
    });
});

describe('positions', () => {
    test('the caret sits under the right character after Persian text', async () => {
        const loaded = loadSchema(PERSIAN);
        const source = 'FROM سفارش WHERE .وضعیت == 5';
        const program = await loaded.parse(source);
        expect(program.errors.length).toBeGreaterThan(0);
        // Find the diagnostic through the services for its range.
        const services = createMinabServices(EmptyFileSystem, parseConfig({ schema: PERSIAN }).schema);
        const document = await parseHelper<Model>(services.Minab)(source, { validation: true });
        const diagnostic = (document.diagnostics ?? []).find(d => d.severity === 1)!;
        const text = formatDiagnostic(diagnostic, source, 'x.minab').split('\n');
        const line = text[1].slice(text[1].indexOf('|') + 2);
        const caret = text[2].slice(text[2].indexOf('|') + 2);
        const underlined = [...line].slice(caret.indexOf('^'), caret.lastIndexOf('^') + 1).join('');
        expect(underlined).toContain('وضعیت');
    });
});
