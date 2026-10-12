/**
 * Phase H8: endpoint guards with `forRootAsync`, and one runtime for each schema (not for each `version`).
 *
 * A guard runs only through Nest's pipeline: calling the controller method by hand skips it. The guard
 * tests run the route handler through `ExternalContextCreator` (from `@nestjs/core`). It applies the
 * controller's guards the way the HTTP router does, and throws the same `ForbiddenException` (403).
 * No HTTP adapter is needed, so the tests do not depend on `@nestjs/platform-express`.
 */

import 'reflect-metadata';
import { ForbiddenException, Injectable, type CanActivate } from '@nestjs/common';
import { ExternalContextCreator, type NestContainer } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, test } from 'vitest';
import type { MinabSchema } from '../../src/language/schema.js';
import { MinabException, MinabModule, MinabService, type MinabModuleOptions, type MinabRunController } from '../../src/nestjs/index.js';
import { RULE_CONTEXT, dataPort, memoryStore, orderSchema, program } from './support.js';

@Injectable()
class DenyGuard implements CanActivate {
    canActivate(): boolean {
        return false;
    }
}

const modules: TestingModule[] = [];
afterEach(async () => {
    for (const module of modules.splice(0)) await module.close();
});

/** Compiles the module and gives the run handler, wrapped with the controller's guards by Nest's own pipeline. */
async function guardedRun(module: ReturnType<typeof MinabModule.forRootAsync>): Promise<(body: unknown) => Promise<unknown>> {
    const testing = await Test.createTestingModule({ imports: [module] }).compile();
    modules.push(testing);
    const controller = testing.get<MinabRunController>(module.controllers![0]);
    const container = (testing as unknown as { container: NestContainer }).container;
    const handler = ExternalContextCreator.fromContainer(container).create(
        controller,
        controller.run.bind(controller) as (...args: unknown[]) => unknown,
        'run'
    );
    return body => handler(body, {}, undefined);
}

const runBody = { v: 1, runs: [{ id: 'r1', program: { ref: { id: 'big', version: '1' } }, record: { total: '50' } }] };

function asyncOptions(extra: Partial<MinabModuleOptions> = {}) {
    const store = memoryStore([program('big', '.total > 10')]);
    const factory = (): MinabModuleOptions => ({
        schemaLoader: () => orderSchema('v1'),
        ruleContext: RULE_CONTEXT,
        programStore: store,
        endpoint: {},
        ...extra
    });
    return { store, factory };
}

describe('forRootAsync guards the run endpoint', () => {
    test('with guards next to endpointPath, a request is 403 and no program runs', async () => {
        const { store, factory } = asyncOptions();
        // An object guard: the pipeline uses it as it is. (It resolves a class guard from a module's providers only.)
        const deny: CanActivate = { canActivate: () => false };
        const run = await guardedRun(MinabModule.forRootAsync({ endpointPath: 'minab/run', guards: [deny], useFactory: factory }));
        const error = await run(runBody).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getStatus()).toBe(403);
        expect(store.calls).toBe(0);
    });

    test('without a guard, the same request runs (so the 403 above is the guard)', async () => {
        const { store, factory } = asyncOptions();
        const run = await guardedRun(MinabModule.forRootAsync({ endpointPath: 'minab/run', useFactory: factory }));
        expect(await run(runBody)).toMatchObject({ v: 1, results: [{ id: 'r1', ok: true, value: true }] });
        expect(store.calls).toBe(1);
    });

    test('the guards are set on the controller', () => {
        const dynamic = MinabModule.forRootAsync({ endpointPath: 'minab/run', guards: [DenyGuard], useFactory: asyncOptions().factory });
        expect(Reflect.getMetadata('__guards__', dynamic.controllers![0])).toEqual([DenyGuard]);
    });

    test('endpoint.guards in the factory stops the app at startup, with the fix in the message', async () => {
        const { factory } = asyncOptions({ endpoint: { guards: [DenyGuard] } });
        const compiling = Test.createTestingModule({ imports: [MinabModule.forRootAsync({ endpointPath: 'minab/run', useFactory: factory })] }).compile();
        await expect(compiling).rejects.toThrow(/factory returned "endpoint\.guards".*Move them to "guards" in the forRootAsync options/);
    });

    test('endpoint.guards in the factory stops the app also when there is no endpointPath', async () => {
        const { factory } = asyncOptions({ endpoint: { guards: [DenyGuard] } });
        await expect(Test.createTestingModule({ imports: [MinabModule.forRootAsync({ useFactory: factory })] }).compile()).rejects.toThrow(/endpoint\.guards/);
    });

    test('endpoint.path in the factory stops the app at startup', async () => {
        const { factory } = asyncOptions({ endpoint: { path: 'api/rules' } });
        await expect(Test.createTestingModule({ imports: [MinabModule.forRootAsync({ useFactory: factory })] }).compile()).rejects.toThrow(
            /factory returned "endpoint\.path".*"endpointPath"/
        );
    });

    test('guards without endpointPath are refused at once', () => {
        expect(() => MinabModule.forRootAsync({ guards: [DenyGuard], useFactory: asyncOptions().factory })).toThrow(/"guards" needs "endpointPath"/);
    });
});

describe('one runtime for each schema', () => {
    /** The order schema, plus a `Note` table when `withNote` is set. Same version either way. */
    function schema(withNote: boolean): MinabSchema & { version: string } {
        const base = orderSchema('shared');
        if (!withNote) return base;
        return { ...base, tables: [...base.tables, { name: 'Note', primaryKey: 'id', columns: base.tables[0].columns.slice(0, 1) }] };
    }

    test('two schemas with the same version never share a runtime: each request runs on its own schema', async () => {
        const schemas = { a: schema(false), b: schema(true) };
        const store = memoryStore([program('has-notes', 'EXISTS(#Note)')]);
        const testing = await Test.createTestingModule({
            imports: [
                MinabModule.forRoot({
                    schemaLoader: context => schemas[context.tenant as 'a' | 'b'],
                    ruleContext: RULE_CONTEXT,
                    programStore: store
                })
            ]
        }).compile();
        const service = testing.get(MinabService);
        const data = dataPort([{ value: true }]);

        // Tenant B first, so a runtime keyed by version alone would hand B's schema to A.
        expect(await service.runStored('has-notes', '1', {}, { data }, { context: { tenant: 'b' } })).toMatchObject({ ok: true, value: true });
        const a = await service.runStored('has-notes', '1', {}, { data }, { context: { tenant: 'a' } }).catch((e: unknown) => e);
        expect(a).toBeInstanceOf(MinabException);
        expect((a as MinabException).error.code).toBe('eval.programInvalid');
        expect(JSON.stringify((a as MinabException).diagnostics)).toContain('Note');
        // And back to B: still its own schema.
        expect(await service.runStored('has-notes', '1', {}, { data }, { context: { tenant: 'b' } })).toMatchObject({ ok: true, value: true });
        await testing.close();
    });

    test('a loader that returns the same content (a new object each time) reuses one runtime and one prepared program', async () => {
        const store = memoryStore([program('big', '.total > 10')]);
        const testing = await Test.createTestingModule({
            imports: [MinabModule.forRoot({ schemaLoader: () => orderSchema('v1'), ruleContext: RULE_CONTEXT, programStore: store })]
        }).compile();
        const service = testing.get(MinabService);
        for (let i = 0; i < 3; i++) expect(await service.runStored('big', '1', { record: { total: 50 } })).toMatchObject({ ok: true, value: true });
        expect(store.calls).toBe(1);
        await testing.close();
    });
});
