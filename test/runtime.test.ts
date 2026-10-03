/**
 * Production plan phase R2 — the runtime API core (`src/runtime/`).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { loadConfigFile } from '../src/cli/config.js';
import { FixtureExecutor } from '../src/host/fixture-executor.js';
import { DIAGNOSTICS } from '../src/language/diagnostics/codes.js';
import { createMinab } from '../src/runtime/index.js';
import { orderSchema } from './support/runtime.js';

const record = { recordTable: 'Order', isFieldRule: false };

describe('prepare', () => {
    test('a valid rule is ok, a record rule, and BOOLEAN', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const program = await minab.prepare('.total > 10');
        expect(program.diagnostics).toEqual([]);
        expect(program.ok).toBe(true);
        expect(program.kind).toBe('record-rule');
        expect(program.resultType).toBe('BOOLEAN');
    });

    test('kinds: query, field rule, value, empty', async () => {
        const minab = createMinab({ schema: orderSchema() });
        expect((await minab.prepare('FROM Order SELECT .id')).kind).toBe('query');
        expect(
            (
                await minab.prepare('$ == 1', {
                    ruleContext: {
                        isFieldRule: true,
                        recordTable: 'Order',
                        fieldType: { kind: 'scalar', base: 'INTEGER', nullable: false, array: false, arrayNullable: false }
                    }
                })
            ).kind
        ).toBe('field-rule');
        expect((await minab.prepare('1 + 1')).kind).toBe('value');
        expect((await minab.prepare('')).kind).toBe('empty');
    });

    test('a broken program gives coded diagnostics with ranges, and does not throw', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const type = await minab.prepare('.status == .total');
        expect(type.ok).toBe(false);
        expect(type.diagnostics[0]).toMatchObject({
            severity: 'error',
            code: 'type.implicitCoercion',
            params: { operator: '==', left: 'TEXT', right: 'DECIMAL' },
            range: { start: { line: 0 }, end: { line: 0 } }
        });
        const syntax = await minab.prepare('FROM');
        expect(syntax.ok).toBe(false);
        expect(syntax.diagnostics.some(d => d.code === 'syntax.parser')).toBe(true);
    });

    test('a bad call rejects: not a string, and a disposed runtime', async () => {
        const minab = createMinab({ schema: orderSchema() });
        await expect(minab.prepare(42 as never)).rejects.toThrow(TypeError);
        minab.dispose();
        await expect(minab.prepare('1')).rejects.toThrow('disposed');
    });

    test('expect: a result type that does not fit is type.unexpectedResultType', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const program = await minab.prepare('.total + 1', { expect: 'boolean' });
        expect(program.ok).toBe(false);
        const diagnostic = program.diagnostics.find(d => d.code === 'type.unexpectedResultType')!;
        expect(diagnostic.params).toEqual({ expected: 'boolean', actual: 'DECIMAL' });
        expect(diagnostic.message).toBe(DIAGNOSTICS['type.unexpectedResultType'].message({ expected: 'boolean', actual: 'DECIMAL' }));
        expect(diagnostic.range.start).toEqual({ line: 0, character: 0 });
    });

    test('expect: the six words and a Minab type name', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const fits = async (source: string, expect_: Parameters<typeof minab.prepare>[1]) => (await minab.prepare(source, expect_)).ok;
        expect(await fits('.total > 1', { expect: 'boolean' })).toBe(true);
        expect(await fits('.total + 1', { expect: 'number' })).toBe(true);
        expect(await fits('.status', { expect: 'text' })).toBe(true);
        expect(await fits('.status', { expect: 'number' })).toBe(false);
        expect(await fits('.total + 1', { expect: { minab: 'DECIMAL' } })).toBe(true);
        expect(await fits('.total + 1', { expect: { minab: 'INTEGER' } })).toBe(false);
        expect(await fits('[1, 2]', { expect: 'list' })).toBe(true);
        expect(await fits('1', { expect: 'list' })).toBe(false);
    });

    test('no expect: the program may return anything (formula fields)', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const cases: [string, string][] = [
            ['.total > 1', 'BOOLEAN'],
            ['.total + 1', 'DECIMAL'],
            ['.status', 'TEXT'],
            ['[1, 2]', 'INTEGER[]']
        ];
        for (const [source, type] of cases) {
            for (const options of [undefined, {}, { expect: undefined }]) {
                const program = await minab.prepare(source, options);
                expect(program.ok, source).toBe(true);
                // The host can still read the type to store it.
                expect(program.resultType).toBe(type);
            }
        }
        expect((await minab.prepare('FROM Order SELECT .id')).ok).toBe(true);
    });

    test('a program with errors is not also checked against expect', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const program = await minab.prepare('.status == .total', { expect: 'number' });
        expect(program.diagnostics.map(d => d.code)).toEqual(['type.implicitCoercion']);
    });
});

describe('compile and run', () => {
    test('compile gives SQL, or a coded refusal', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const query = (await minab.prepare('FROM Order SELECT .id')).compile();
        expect(query.ok && query.query.text).toMatch(/^SELECT /);
        const broken = (await minab.prepare('FROM')).compile();
        expect(broken).toMatchObject({ ok: false, error: { code: 'compile.programHasErrors' } });
        const empty = (await minab.prepare('')).compile();
        expect(empty).toMatchObject({ ok: false, error: { code: 'compile.nothingToCompile' } });
        const interpreted = (await minab.prepare('1 + 1')).compile();
        expect(interpreted.ok || interpreted.error.code).toBeTruthy();
    });

    test('run gives a value, and a program that needs data but gets no port fails with data.noPort', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const pure = await minab.prepare('.total > 10');
        expect(await pure.run({ record: { total: 25 } })).toEqual({ ok: true, value: true });
        expect(await pure.run({ record: { total: 5 } })).toEqual({ ok: true, value: false });

        const needsData = await minab.prepare('EXISTS(#Customer[.id == ^.customer_id])');
        expect(await needsData.run({ record: { customer_id: 'c-1' } })).toMatchObject({ ok: false, error: { code: 'data.noPort' } });
        const withPort = await needsData.run({ record: { customer_id: 'c-1' } }, { data: new FixtureExecutor([{ rows: [{ value: true }] }]) });
        expect(withPort).toEqual({ ok: true, value: true });
    });

    test('run refuses a program with errors', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM');
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'eval.programInvalid' } });
    });

    test('the prepared program keeps working after its document is gone', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        const program = await minab.prepare('.total > 10');
        expect(minab.cacheStats().openDocuments).toBe(0);
        expect(await program.run({ record: { total: 11 } })).toEqual({ ok: true, value: true });
    });
});

describe('the service cache', () => {
    test('the same schema version twice builds services once', async () => {
        const minab = createMinab({ schema: orderSchema('a'), ruleContext: record });
        await minab.prepare('1');
        await minab.prepare('2');
        expect(minab.cacheStats()).toMatchObject({ size: 1, created: 1, hits: 1 });
    });

    test('a different rule context is a different service set', async () => {
        const minab = createMinab({ schema: orderSchema('a') });
        await minab.prepare('1', { ruleContext: record });
        await minab.prepare('1');
        expect(minab.cacheStats().created).toBe(2);
    });

    test('a schema without a version is cached by a hash of its content', async () => {
        const { version: _, ...unversioned } = orderSchema();
        const first = createMinab({ schema: unversioned });
        await first.prepare('1');
        await first.prepare('1');
        expect(first.cacheStats()).toMatchObject({ created: 1, hits: 1 });
        const changed = createMinab({ schema: { ...unversioned, tables: unversioned.tables.slice(1) } });
        await changed.prepare('1');
        expect(changed.cacheStats().created).toBe(1);
    });

    test('17 service sets with a cap of 16: the oldest is dropped', async () => {
        // One runtime has one schema, so the 17 sets differ by rule context (the key holds both).
        const minab = createMinab({ schema: orderSchema('a'), serviceCacheSize: 16 });
        const context = (i: number) => ({ ruleContext: { isFieldRule: false, recordTable: `T${i}` } });
        for (let i = 0; i < 17; i++) await minab.prepare('1', context(i));
        expect(minab.cacheStats()).toMatchObject({ size: 16, created: 17, hits: 0 });
        await minab.prepare('1', context(16)); // the newest is still there
        expect(minab.cacheStats()).toMatchObject({ created: 17, hits: 1 });
        await minab.prepare('1', context(0)); // the oldest was dropped, so it is built again
        expect(minab.cacheStats()).toMatchObject({ size: 16, created: 18 });
    });

    test('a run that holds an evicted service set still works', async () => {
        const minab = createMinab({ schema: orderSchema('a'), serviceCacheSize: 1 });
        const program = await minab.prepare('.total > 10', { ruleContext: record });
        await minab.prepare('1'); // a second rule context: the first set is evicted
        expect(minab.cacheStats()).toMatchObject({ size: 1, created: 2 });
        expect(await program.run({ record: { total: 11 } })).toEqual({ ok: true, value: true });
    });

    test('dispose frees the cache', async () => {
        const minab = createMinab({ schema: orderSchema() });
        await minab.prepare('1');
        minab.dispose();
        expect(minab.cacheStats().size).toBe(0);
    });
});

describe('document lifecycle', () => {
    test('after 1,000 prepare calls the workspace holds no documents', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record });
        for (let i = 0; i < 1000; i++) await minab.prepare(`.total > ${i}`);
        expect(minab.cacheStats().openDocuments).toBe(0);
    });

    test('a failing prepare also leaves nothing behind', async () => {
        const minab = createMinab({ schema: orderSchema() });
        await minab.prepare('@@@ FROM');
        expect(minab.cacheStats().openDocuments).toBe(0);
    });
});

// ---- every example, through the API ---------------------------------------

const EXAMPLES_DIR = fileURLToPath(new URL('../examples/', import.meta.url));
const names = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(EXAMPLES_DIR, entry.name, `${entry.name}.minab`)))
    .map(entry => entry.name)
    .sort();

describe('examples/ give their expected answer through the runtime API', () => {
    test('there are examples', () => expect(names.length).toBeGreaterThan(0));

    test.each(names)('%s', async name => {
        const dir = join(EXAMPLES_DIR, name);
        const config = loadConfigFile(join(dir, 'minab.config.json'));
        const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Record<string, any>;
        const minab = createMinab({ schema: config.schema, ruleContext: config.ruleContext });
        const program = await minab.prepare(readFileSync(join(dir, `${name}.minab`), 'utf8'));
        expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);

        const data = new FixtureExecutor(config.responses);
        const result = await program.run({ record: config.record, fieldValue: config.fieldValue }, { data });
        if (expected.mode === 'run') {
            expect(result.ok).toBe(true);
            expect(JSON.parse(JSON.stringify(result.ok ? (result.value ?? null) : null))).toEqual(expected.json);
            expect(data.statements).toHaveLength(expected.statements);
            expect(program.compile().ok).toBe(expected.compiles);
        } else {
            expect(result.ok).toBe(false);
            expect(!result.ok && result.error.message).toMatch(new RegExp(expected.refusal));
        }
    });
});
