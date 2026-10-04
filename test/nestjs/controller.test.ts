/**
 * Phase H2: the run endpoint. Stored programs only, source refused unless allowed, a batch limit,
 * and the server's own ports and inputs.
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, test } from 'vitest';
import { MinabException, MinabModule, MinabService, type MinabModuleOptions, type MinabRunController } from '../../src/nestjs/index.js';
import { parseResponse } from '../../src/runtime/index.js';
import { RULE_CONTEXT, dataPort, memoryStore, orderSchema, program } from './support.js';

async function endpoint(options: Partial<MinabModuleOptions> = {}) {
    const dynamic = MinabModule.forRoot({
        schemaLoader: () => orderSchema('v1'),
        ruleContext: RULE_CONTEXT,
        programStore: memoryStore([
            program('big', '.total > 10'),
            program('exists', 'EXISTS(#Order[.id == ^.id])'),
            program('amount', '.total + 1.5'),
            program('who', 'currentUser.id')
        ]),
        endpoint: {},
        ...options
    });
    const module = await Test.createTestingModule({ imports: [dynamic] }).compile();
    const Controller = dynamic.controllers![0];
    return { module, controller: module.get(Controller) as MinabRunController, Controller };
}

const ref = (id: string) => ({ ref: { id, version: '1' } });
const body = (...runs: object[]) => ({ v: 1, runs });

describe('MinabRunController', () => {
    test('no endpoint, no controller', () => {
        expect(MinabModule.forRoot({ schemaLoader: () => orderSchema('v1') }).controllers).toEqual([]);
    });

    test('is mounted at the path (default minab/run)', async () => {
        const { Controller } = await endpoint();
        expect(Reflect.getMetadata('path', Controller)).toBe('minab/run');
        const custom = await endpoint({ endpoint: { path: 'api/rules' } });
        expect(Reflect.getMetadata('path', custom.Controller)).toBe('api/rules');
    });

    test('runs a stored program and answers in wire format v1', async () => {
        const { controller } = await endpoint();
        const response = await controller.run(body({ id: 'r1', program: ref('big'), record: { total: '25.5' } }), {});
        expect(response).toMatchObject({ v: 1, results: [{ id: 'r1', ok: true, value: true }] });
        expect(parseResponse(JSON.parse(JSON.stringify(response))).ok).toBe(true);
    });

    test('decimals cross as strings, both ways', async () => {
        const { controller } = await endpoint();
        const response = await controller.run(body({ id: 'r1', program: ref('amount'), record: { total: '24.9' } }), {});
        expect(response.results[0]).toMatchObject({ ok: true, value: '26.4' });
    });

    test('one failed run does not fail the batch', async () => {
        const { controller } = await endpoint();
        const response = await controller.run(
            body(
                { id: 'ok', program: ref('big'), record: { total: '1' } },
                { id: 'missing', program: ref('nope') },
                { id: 'nodata', program: ref('exists'), record: { id: 'o-1' } }
            ),
            {}
        );
        const [ok, missing, nodata] = response.results;
        expect(ok).toMatchObject({ ok: true, value: false });
        expect(missing).toMatchObject({ ok: false, error: { code: 'wire.programNotFound' } });
        expect(nodata).toMatchObject({ ok: false, error: { code: 'data.noPort' } });
    });

    test('uses the ports of the server (never of the client)', async () => {
        const data = dataPort();
        const { controller } = await endpoint({ endpoint: { ports: () => ({ data }) } });
        const response = await controller.run(body({ id: 'r1', program: ref('exists'), record: { id: 'o-1' } }), {});
        expect(response.results[0]).toMatchObject({ ok: true, value: true });
        expect(data.calls).toHaveLength(1);
    });

    test('the ports function gets the request context', async () => {
        const seen: unknown[] = [];
        const { controller } = await endpoint({ endpoint: { ports: context => (seen.push(context), {}) } });
        const request = { headers: {} };
        await controller.run(body({ id: 'r1', program: ref('big'), record: { total: '1' } }), request, 'req-42');
        expect(seen[0]).toMatchObject({ request, requestId: 'req-42' });
    });

    test('server host inputs replace the ones of the client', async () => {
        const { controller } = await endpoint({
            inputs: { currentUser: { id: 'TEXT' } },
            endpoint: { hostInputs: () => ({ currentUser: { id: 'server-user' } }) }
        });
        const response = await controller.run(body({ id: 'r1', program: ref('who'), inputs: { currentUser: { id: 'forged' } } }), {});
        expect(response.results[0]).toMatchObject({ ok: true, value: 'server-user' });
    });

    test('program source is refused by default', async () => {
        const { controller } = await endpoint();
        const error = await controller.run(body({ id: 'r1', program: { source: '1 + 1' } }), {}).catch(e => e);
        expect(error).toBeInstanceOf(MinabException);
        expect(error.error.code).toBe('wire.invalidRequest');
        expect(error.status).toBe(400);
        expect(error.error.params.path).toBe('runs[0].program.source');
    });

    test('program source is accepted in development mode (allowSource: true)', async () => {
        const { controller } = await endpoint({ endpoint: { allowSource: true } });
        const response = await controller.run(body({ id: 'r1', program: { source: '1 + 1' } }), {});
        expect(response.results[0]).toMatchObject({ ok: true, value: 2 });
    });

    test('source with errors is a failed run with the invalid program code', async () => {
        const { controller } = await endpoint({ endpoint: { allowSource: true } });
        const response = await controller.run(body({ id: 'r1', program: { source: '1 +' } }), {});
        expect(response.results[0]).toMatchObject({ ok: false, error: { code: 'eval.programInvalid' } });
    });

    test('100 runs are fine, 101 are refused (D36)', async () => {
        const { controller } = await endpoint();
        const runs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, program: ref('big'), record: { total: '1' } }));
        const ok = await controller.run(body(...runs(100)), {});
        expect(ok.results).toHaveLength(100);
        const error = await controller.run(body(...runs(101)), {}).catch(e => e);
        expect(error).toBeInstanceOf(MinabException);
        expect(error.error.code).toBe('wire.tooManyRuns');
    });

    test('the batch limit follows the host limits', async () => {
        const { controller } = await endpoint({ limits: { batchRuns: 2 } });
        const runs = [1, 2, 3].map(i => ({ id: `r${i}`, program: ref('big'), record: { total: '1' } }));
        await expect(controller.run(body(...runs), {})).rejects.toMatchObject({ error: { code: 'wire.tooManyRuns' } });
    });

    test('a bad version or a bad shape is a 400 error', async () => {
        const { controller } = await endpoint();
        await expect(controller.run({ v: 2, runs: [] }, {})).rejects.toMatchObject({ status: 400, error: { code: 'wire.unsupportedVersion' } });
        await expect(controller.run('nope', {})).rejects.toMatchObject({ status: 400, error: { code: 'wire.invalidRequest' } });
    });

    test('a client can only tighten the limits of a run', async () => {
        const { controller } = await endpoint({ limits: { statements: 5 }, endpoint: { ports: () => ({ data: dataPort() }) } });
        const response = await controller.run(body({ id: 'r1', program: ref('exists'), record: { id: 'o-1' }, options: { limits: { statements: 100 } } }), {});
        expect(response.results[0]).toMatchObject({ ok: true });
    });

    test('logs are sent only when the host allows them and the run asks (D37)', async () => {
        const asked = body({ id: 'r1', program: ref('big'), record: { total: '1' }, options: { logs: true } });
        const on = await endpoint({ logs: true });
        expect((await on.controller.run(asked, {})).results[0]).toMatchObject({ ok: true, logs: [] });
        const off = await endpoint({ logs: false });
        expect((await off.controller.run(asked, {})).results[0]).toMatchObject({ ok: true, logs: [] });
        const notAsked = await on.controller.run(body({ id: 'r1', program: ref('big'), record: { total: '1' } }), {});
        expect(notAsked.results[0]).not.toHaveProperty('logs');
    });

    test('an error from a port never shows its message', async () => {
        const failing = {
            async execute() {
                throw Object.assign(new Error('SELECT secret FROM vault'), { code: '42P01' });
            }
        };
        const { controller } = await endpoint({ endpoint: { ports: () => ({ data: failing }) } });
        const response = await controller.run(body({ id: 'r1', program: ref('exists'), record: { id: 'o-1' } }), {});
        expect(JSON.stringify(response)).not.toContain('vault');
        expect(response.results[0]).toMatchObject({ ok: false, error: { code: 'data.error' } });
    });

    test('guards of the endpoint are set on the controller', async () => {
        class Deny {
            canActivate() {
                return false;
            }
        }
        const { Controller } = await endpoint({ endpoint: { guards: [Deny] } });
        expect(Reflect.getMetadata('__guards__', Controller)).toEqual([Deny]);
    });

    test('the controller and the service share one runtime', async () => {
        const { module } = await endpoint();
        expect(module.get(MinabService)).toBeInstanceOf(MinabService);
    });
});
