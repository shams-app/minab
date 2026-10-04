import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { demoDataset } from '../src/content/datasets/demo.js';
import { explainRefusal } from '../src/engine/program.js';
import { Engine } from '../src/engine/engine.js';
import type { EngineStatus, HostSettings } from '../src/engine/protocol.js';

/**
 * The engine as the UI sees it: reports, editor intelligence, the database
 * console. `content.test.ts` covers the programs the site ships; this
 * covers the machinery around them.
 */

let engine: Engine;
const statuses: EngineStatus[] = [];

const demo = (extra: Record<string, unknown> = {}): HostSettings => ({
    config: { schema: demoDataset.schema, seed: demoDataset.seed, ...extra },
    dataSource: 'postgres'
});

beforeAll(() => {
    engine = new Engine(status => statuses.push(status));
    engine.start();
});
afterAll(() => engine.close());

describe('analysis', () => {
    test('reports kind, type and compiled SQL without touching the database', async () => {
        await engine.setHost(demo());
        const report = await engine.analyze('FROM Order WHERE .total > 500 SELECT .id');
        expect(report.program.kind).toBe('query');
        expect(report.diagnostics).toEqual([]);
        expect(report.compiled).toMatchObject({ ok: true, params: [500] });
    });

    test('a type error is a diagnostic with a range, and there is no SQL', async () => {
        const report = await engine.analyze('FROM Order\nWHERE .status == 5\nSELECT .id');
        expect(report.diagnostics).toHaveLength(1);
        expect(report.diagnostics[0]).toMatchObject({ severity: 1, source: 'minab', code: 'type.implicitCoercion', range: { start: { line: 1 } } });
        expect(report.compiled.ok).toBe(false);
    });

    test('a syntax error is tagged as such', async () => {
        const report = await engine.analyze('FROM Order WHERE');
        expect(report.diagnostics[0]?.source).toBe('syntax');
        expect(report.diagnostics[0]?.code).toBe('syntax.parser');
    });

    test('a rule explains why it has no single statement', async () => {
        await engine.setHost(demo({ rule: { recordTable: 'Order' }, record: { id: 'ord-200', customer_id: 'cus-ken', total: 900 } }));
        const report = await engine.analyze('.total <= .customer.credit_limit');
        expect(report.program.kind).toBe('record-rule');
        expect(report.program.resultType).toBe('BOOLEAN');
        expect(report.compiled).toMatchObject({ ok: false, pushesDown: true });
    });

    test('table writes are not check-only any more (X5): they run as a dry run and show in the Execution tab', async () => {
        await engine.setHost(demo());
        const source = 'DELETE #Order[.total > 1];\nUPDATE #Order SET { status: "x" };\ntrue';
        const report = await engine.analyze(source);
        expect(report.diagnostics).toEqual([]);
        expect(report.program.checkOnly).toBe(false);
        const run = await engine.run(source, 9);
        expect(run.stage).toBe('done');
        expect(run.result).toMatchObject({ kind: 'value', value: true });
        expect(run.trace.map(entry => [entry.dryRun, entry.text.split(' ')[0]])).toEqual([
            [true, 'DELETE'],
            [true, 'UPDATE']
        ]);
        expect(run.trace[0]).toMatchObject({ rowCount: 0, params: [1], origin: { type: 'DeleteStatement' } });
        // Nothing changed: no row has the new status.
        const changed = await engine.sql('SELECT count(*)::int AS n FROM "Order" WHERE status = \'x\'');
        expect(changed.statements[0]?.rows).toEqual([{ n: 0 }]);
    });

    test('loops, .$index and tuples are not check-only any more (X4)', async () => {
        await engine.setHost(demo());
        const source = 'let n: INTEGER = 0;\nloop x in [10, 20, 30] where .$index > 0 { n += x; }\nlet t: (INTEGER, INTEGER) = (n, 1);\nt[0]';
        const report = await engine.analyze(source);
        expect(report.diagnostics).toEqual([]);
        expect(report.program.checkOnly).toBe(false);
        const run = await engine.run(source, 6);
        expect(run.stage).toBe('done');
        expect(run.result).toMatchObject({ kind: 'value', value: 50 });
    });

    test('assignment and if! are not check-only any more (X3)', async () => {
        await engine.setHost(demo());
        const report = await engine.analyze('fn f(n: INTEGER): INTEGER { n += 1; if! n > 1 { n *= 2; } n }\nf(1)');
        expect(report.diagnostics).toEqual([]);
        expect(report.program.checkOnly).toBe(false);
        const run = await engine.run('fn f(n: INTEGER): INTEGER { n += 1; if! n > 1 { n *= 2; } n }\nf(1)', 5);
        expect(run.stage).toBe('done');
        expect(run.result).toMatchObject({ kind: 'value', value: 4 });
    });

    test('lists declared symbols', async () => {
        const report = await engine.analyze('fn twice(x: DECIMAL): DECIMAL { x * 2 }\nlet a: DECIMAL = 1;\ntwice(a)');
        expect(report.program.symbols.map(s => `${s.kind}:${s.name}`)).toEqual(['function:twice', 'variable:a']);
        expect(report.program.symbols[0].detail).toBe('fn twice(x: DECIMAL): DECIMAL');
    });
});

describe('running', () => {
    test('a record rule that never needs the database answers from the record', async () => {
        await engine.setHost(demo({ rule: { recordTable: 'Booking' }, record: { id: 'b', start_date: '2026-10-01', end_date: '2026-10-05' } }));
        const report = await engine.run('.end_date > .start_date', 1);
        expect(report.result).toEqual({ kind: 'verdict', value: true });
        expect(report.trace).toEqual([]);
    });

    test('each statement carries the source span it came from', async () => {
        await engine.setHost(demo({ rule: { recordTable: 'Order' }, record: { id: 'ord-200', customer_id: 'cus-ken', total: 900 } }));
        const source = '.total <= .customer.credit_limit';
        const report = await engine.run(source, 2);
        expect(report.trace).toHaveLength(1);
        const origin = report.trace[0].origin!;
        expect(origin.text).toBe('.customer.credit_limit');
        expect(source.slice(origin.range.start.character, origin.range.end.character)).toBe('.customer.credit_limit');
        expect(report.trace[0].preview).toEqual([{ value: 800 }]);
    });

    test('a query returns columns in SELECT order, even with no rows', async () => {
        await engine.setHost(demo());
        const report = await engine.run('FROM Customer WHERE .name == "Nobody" SELECT .name, .country', 3);
        expect(report.result).toEqual({ kind: 'rows', columns: ['name', 'country'], rows: [] });
    });

    test('a broken host config stops the run at the config stage', async () => {
        const set = await engine.setHost({ config: { schema: { tables: [{ name: 'T', columns: { x: 'NUMBER' } }] } }, dataSource: 'postgres' });
        expect(set).toMatchObject({ ok: false });
        const report = await engine.run('1 == 1', 4);
        expect(report.stage).toBe('config');
        expect(report.error?.message).toMatch(/unknown type "NUMBER"/);
    });

    test('a seed row for a column that does not exist is reported with its path', async () => {
        const set = await engine.setHost({ config: { schema: demoDataset.schema, seed: { Room: [{ id: 'r', nope: 1 }] } }, dataSource: 'postgres' });
        expect(set).toEqual({ ok: false, error: 'seed.Room: "nope" is not a column of Room' });
    });

    test('a statement the fixtures cannot answer is a data source error that names the statement', async () => {
        await engine.setHost({
            config: { schema: demoDataset.schema, data: [{ match: 'NEVER_MATCHES', value: true }] },
            dataSource: 'fixtures'
        });
        const report = await engine.run('COUNT(#Customer)', 6);
        expect(report.stage).toBe('run');
        expect(report.error).toMatchObject({ kind: 'datasource', sql: expect.stringContaining('Customer') });
        expect(report.trace).toHaveLength(1);
        expect(report.trace[0].error).toBe(report.error?.message);
    });

    test('a statement Postgres rejects keeps the database message and the failed statement', async () => {
        await engine.setHost(demo());
        const report = await engine.run('FROM Order SELECT .total / 0 AS x', 7);
        expect(report.stage).toBe('run');
        expect(report.error?.kind).toBe('datasource');
        expect(report.error?.message).toMatch(/^Postgres rejected this statement: .*division by zero/i);
        expect(report.error).toMatchObject({ sql: expect.stringContaining('SELECT') });
        expect(report.trace[0].error).toBe(report.error?.message);
    });

    test('a refusal of the interpreter ("not executed yet") is explained, and a real failure is not (X5: table writes now run)', () => {
        expect(explainRefusal('"SomeStatement" is not executed yet')).toMatchObject({ construct: 'SomeStatement' });
        expect(explainRefusal('division by zero')).toBeUndefined();
    });

    test('a program that needs no data runs while the database has not booted', async () => {
        const fresh = new Engine();
        try {
            await fresh.setHost(demo());
            const report = await fresh.run('1 + 1', 9);
            expect(report.result).toMatchObject({ kind: 'value', value: 2 });
            expect(fresh['database'].state).toBe('idle');
        } finally {
            await fresh.close();
        }
    });

    test('fixtures mode answers from data.responses, like the CLI', async () => {
        await engine.setHost({
            config: {
                schema: demoDataset.schema,
                rule: { recordTable: 'Booking' },
                record: { id: 'b', room_id: 'room-7', start_date: '2026-10-01', end_date: '2026-10-05' },
                data: [{ match: 'EXISTS', value: true }]
            },
            dataSource: 'fixtures'
        });
        const report = await engine.run('NOT EXISTS(#Booking[. != ^ AND .room_id == ^.room_id])', 5);
        expect(report.result).toEqual({ kind: 'verdict', value: false });
        expect(report.dataSource).toBe('fixtures');
    });

    test('a snippet run leaves the current host alone', async () => {
        await engine.setHost(demo({ rule: { recordTable: 'Booking' }, record: { id: 'b', start_date: '2026-10-01', end_date: '2026-10-05' } }));
        const snippet = await engine.runSnippet(demo(), 'FROM Room SELECT .name ORDERBY .name');
        expect(snippet.result).toMatchObject({ kind: 'rows', rows: [{ name: 'Atlas' }, { name: 'Harbor' }, { name: 'Lighthouse' }] });
        const report = await engine.run('.end_date > .start_date', 6);
        expect(report.program.kind).toBe('record-rule');
    });

    test('analysis is not held up by a run waiting on the database', async () => {
        await engine.setHost(demo());
        const run = engine.run('FROM Order WHERE .total > 1000 SELECT .id ORDERBY .id', 7);
        const analysis = await engine.analyze('FROM Order SELECT .id');
        expect(analysis.program.kind).toBe('query');
        expect((await run).result).toMatchObject({ kind: 'rows', rows: [{ id: 'ord-150' }, { id: 'ord-185' }, { id: 'ord-190' }] });
    });
});

describe('editor intelligence', () => {
    beforeAll(async () => {
        await engine.setHost(demo({ rule: { recordTable: 'Booking' } }));
    });

    test('hover shows a column’s type', async () => {
        const source = 'FROM Order WHERE .total > 5 SELECT .id';
        const hover = await engine.hover(source, source.indexOf('.total') + 2);
        expect(hover?.contents).toContain('**type** `DECIMAL`');
    });

    test('hover on a keyword defers to the cheat sheet', async () => {
        const hover = await engine.hover('FROM Order SELECT .id', 1);
        expect(hover).toMatchObject({ keyword: 'FROM' });
    });

    test('hover on a #Table explains the fallback and lists columns', async () => {
        const source = 'EXISTS(#Room[.capacity > 4])';
        const hover = await engine.hover(source, source.indexOf('#Room') + 2);
        expect(hover?.contents).toContain('every row of table `Room`');
        expect(hover?.contents).toContain('`capacity`');
    });

    test('completion after a dot offers the related table’s columns', async () => {
        const source = 'FROM Order WHERE .customer.';
        const report = await engine.complete(source, source.length);
        expect(report.entries.map(e => e.label)).toEqual(expect.arrayContaining(['name', 'country', 'credit_limit']));
        expect(report.entries.every(e => e.kind === 'column')).toBe(true);
    });

    test('completion after ^. uses the record under validation', async () => {
        const source = 'EXISTS(#Booking[.room_id == ^.';
        const report = await engine.complete(source, source.length);
        expect(report.entries.map(e => e.label)).toContain('start_date');
    });

    test('completion after # and FROM offers tables', async () => {
        const hash = await engine.complete('EXISTS(#', 8);
        expect(hash.entries.map(e => e.label)).toContain('Booking');
        const from = await engine.complete('FROM ', 5);
        expect(from.entries.map(e => e.label)).toEqual(expect.arrayContaining(['Order', 'Customer']));
    });

    test('where an expression can start, the program’s functions are offered as snippets, next to the built-ins', async () => {
        const source = 'fn twice(x: DECIMAL): DECIMAL { x * 2 }\n';
        const report = await engine.complete(source, source.length);
        expect(report.entries).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'twice', kind: 'function', insertText: 'twice(${1:x})' })]));
        expect(report.entries.map(e => e.label)).toContain('COUNT');
    });

    test('hover on a called function shows its signature', async () => {
        const source = 'fn twice(x: DECIMAL): DECIMAL { x * 2 }\ntwice(2)';
        const hover = await engine.hover(source, source.indexOf('twice(2)') + 2);
        expect(hover?.contents).toContain('fn twice(x: DECIMAL): DECIMAL');
    });

    test('keywords come from the grammar, and built-ins only where an expression can start', async () => {
        const afterSource = await engine.complete('FROM Order ', 11);
        expect(afterSource.entries.map(e => e.label)).toEqual(expect.arrayContaining(['WHERE', 'SELECT', 'GROUPBY']));
        expect(afterSource.entries.map(e => e.label)).not.toContain('COUNT');
        const inWhere = await engine.complete('FROM Order WHERE ', 17);
        expect(inWhere.entries.map(e => e.label)).toContain('COUNT');
    });

    test('the AST view carries inferred types', async () => {
        const tree = await engine.ast('FROM Order WHERE .total > 5 SELECT .id');
        const json = JSON.stringify(tree);
        expect(tree?.type).toBe('Model');
        expect(json).toContain('"inferredType":"DECIMAL"');
        expect(json).toContain('"feature":"whereClause"');
    });
});

describe('the database', () => {
    beforeAll(async () => {
        await engine.setHost(demo());
    });

    test('table previews come from Postgres, with Minab types', async () => {
        const preview = await engine.tablePreview('Customer', 3);
        expect(preview.total).toBe(10);
        expect(preview.rows).toHaveLength(3);
        expect(preview.columns).toContainEqual({ name: 'email', type: 'CITEXT' });
        const orders = await engine.tablePreview('Order', 1);
        expect(orders.columns).toContainEqual({ name: 'customer_id', type: 'UUID?' });
    });

    test('the SQL console changes data until a reset', async () => {
        const changed = await engine.sql(`DELETE FROM "Room" WHERE id = 'room-3'`);
        expect(changed.error).toBeUndefined();
        expect((await engine.tablePreview('Room', 10)).total).toBe(2);
        await engine.resetDatabase();
        expect((await engine.tablePreview('Room', 10)).total).toBe(3);
    });

    test('a console error is reported, not thrown', async () => {
        const result = await engine.sql('SELEC 1');
        expect(result.error).toMatch(/syntax error/);
    });

    test('seed.sql rebuilds the same database', async () => {
        const script = await engine.seedSql();
        expect(script).toContain('CREATE EXTENSION IF NOT EXISTS citext;');
        expect(script).toContain('CREATE TABLE "Order" (');
        expect(script).toContain(`'Ada.Lovelace@Example.com'`);
    });

    test('status events report the database booting and ready', () => {
        const phases = statuses.map(s => (s.phase === 'ready' ? s.database : s.phase));
        expect(phases).toContain('booting');
        expect(phases.at(-1)).toBe('ready');
    });
});
