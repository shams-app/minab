/**
 * Phase H2: the module, `MinabService` (prepare, run, runStored and its cache), per-tenant schemas.
 */

import { Test } from '@nestjs/testing';
import { Injectable, Module } from '@nestjs/common';
import { describe, expect, test, vi } from 'vitest';
import { MinabException, MinabModule, MinabService, MINAB_OPTIONS } from '../../src/nestjs/index.js';
import { RULE_CONTEXT, boot, dataPort, memoryStore, orderSchema, program } from './support.js';

describe('MinabModule', () => {
    test('forRoot provides the service and the options', async () => {
        const { module, service } = await boot();
        expect(service).toBeInstanceOf(MinabService);
        expect(module.get(MINAB_OPTIONS)).toBeDefined();
        await module.close();
    });

    test('forRootAsync builds the options from a factory with injected providers', async () => {
        @Injectable()
        class Config {
            readonly version = 'async-v1';
        }
        @Module({ providers: [Config], exports: [Config] })
        class ConfigModule {}
        const module = await Test.createTestingModule({
            imports: [
                MinabModule.forRootAsync({
                    imports: [ConfigModule],
                    inject: [Config],
                    useFactory: ((config: Config) => ({ schemaLoader: () => orderSchema(config.version), ruleContext: RULE_CONTEXT })) as never
                })
            ]
        }).compile();
        const prepared = await module.get(MinabService).prepare('.total > 10');
        expect(prepared.ok).toBe(true);
        await module.close();
    });
});

describe('MinabService prepare and run', () => {
    test('prepare gives diagnostics for a bad program and does not throw', async () => {
        const { service } = await boot();
        const prepared = await service.prepare('.nope > 1');
        expect(prepared.ok).toBe(false);
        expect(prepared.diagnostics.length).toBeGreaterThan(0);
    });

    test('run uses the ports of the request', async () => {
        const { service } = await boot();
        const prepared = await service.prepare('EXISTS(#Order[.id == ^.id])');
        const data = dataPort();
        const result = await service.run(prepared, { record: { id: 'o-1' } }, { data });
        expect(result).toMatchObject({ ok: true, value: true });
        expect(data.calls).toHaveLength(1);
    });

    test('run gives a failed result, not an exception', async () => {
        const { service } = await boot();
        const prepared = await service.prepare('EXISTS(#Order[.id == ^.id])');
        const result = await service.run(prepared, { record: { id: 'o-1' } }, {});
        expect(result).toMatchObject({ ok: false, error: { code: 'data.noPort' } });
    });

    test('the limits of the module reach the runtime', async () => {
        const { service } = await boot({ limits: { statements: 1 } });
        const prepared = await service.prepare('EXISTS(#Order[.id == ^.id]) AND EXISTS(#Order[.id == ^.id])');
        const result = await service.run(prepared, { record: { id: 'o-1' } }, { data: dataPort() });
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.tooManyStatements' } });
    });

    test('a schema without a version is refused', async () => {
        const { service } = await boot({ schemaLoader: () => ({ tables: [] }) as never });
        await expect(service.prepare('1 + 1')).rejects.toThrow(/version/);
    });
});

describe('MinabService runStored', () => {
    test('runs a stored program', async () => {
        const store = memoryStore([program('rule-1', '.total > 10')]);
        const { service } = await boot({ programStore: store });
        const result = await service.runStored('rule-1', '1', { record: { total: 25 } });
        expect(result).toMatchObject({ ok: true, value: true });
    });

    test('caches the prepared program by id and version', async () => {
        const store = memoryStore([program('rule-1', '.total > 10'), program('rule-1', '.total > 100', '2')]);
        const { service } = await boot({ programStore: store });
        await service.runStored('rule-1', '1', { record: { total: 25 } });
        await service.runStored('rule-1', '1', { record: { total: 5 } });
        expect(store.calls).toBe(1);
        // Another version is another program.
        const v2 = await service.runStored('rule-1', '2', { record: { total: 25 } });
        expect(store.calls).toBe(2);
        expect(v2).toMatchObject({ ok: true, value: false });
    });

    test('concurrent calls for one program ask the store once', async () => {
        const store = memoryStore([program('rule-1', '.total > 10')]);
        const { service } = await boot({ programStore: store });
        await Promise.all([1, 2, 3].map(() => service.runStored('rule-1', '1', { record: { total: 25 } })));
        expect(store.calls).toBe(1);
    });

    test('an unknown program is wire.programNotFound, and is not cached', async () => {
        const programs = [program('rule-1', '.total > 10')];
        const store = memoryStore(programs);
        const { service } = await boot({ programStore: store });
        await expect(service.runStored('missing', '1')).rejects.toMatchObject({
            error: { code: 'wire.programNotFound', params: { id: 'missing', version: '1' } }
        });
        programs.push(program('missing', '.total > 1'));
        await expect(service.runStored('missing', '1', { record: { total: 5 } })).resolves.toMatchObject({ ok: true, value: true });
    });

    test('a stored program with errors throws with its diagnostics', async () => {
        const { service } = await boot({ programStore: memoryStore([program('bad', '.nope > 1')]) });
        const error = await service.runStored('bad', '1').catch(e => e);
        expect(error).toBeInstanceOf(MinabException);
        expect(error.error.code).toBe('eval.programInvalid');
        expect(error.diagnostics.length).toBeGreaterThan(0);
    });

    test('without a store it fails with a clear message', async () => {
        const { service } = await boot();
        await expect(service.runStored('a', '1')).rejects.toThrow(/programStore/);
    });
});

describe('schemas for each request', () => {
    test('two tenants get different schemas, the loader runs for each request, and a runtime is cached by version', async () => {
        const loader = vi.fn((context: { tenant?: unknown }) => (context.tenant === 'b' ? orderSchema('tenant-b', 'note') : orderSchema('tenant-a')));
        const store = memoryStore([program('uses-note', '.note == "x"')]);
        const { service } = await boot({ schemaLoader: loader, programStore: store });

        const a = await service.runStored('uses-note', '1', { record: { note: 'x' } }, {}, { context: { tenant: 'a' } }).catch(e => e);
        expect(a).toBeInstanceOf(MinabException); // tenant A has no "note" column: the program has errors
        const b = await service.runStored('uses-note', '1', { record: { note: 'x' } }, {}, { context: { tenant: 'b' } });
        expect(b).toMatchObject({ ok: true, value: true });

        expect(loader).toHaveBeenCalledTimes(2);
        await service.runStored('uses-note', '1', { record: { note: 'y' } }, {}, { context: { tenant: 'b' } });
        expect(loader).toHaveBeenCalledTimes(3);
        // The same version gives the same runtime and the same prepared program: the store was asked once for each tenant.
        expect(store.calls).toBe(2);
    });
});
