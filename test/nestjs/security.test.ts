/**
 * Phase Q3: what a NestJS host exposes. The schema, the ports and the programs belong to the
 * server. The client sends ids and data. Error bodies and logs do not leak.
 *
 * H2 tests the same module for behavior (`test/nestjs/`). These tests state the security claims.
 */

import 'reflect-metadata';
import type { LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, test } from 'vitest';
import { MinabException, MinabLogger, MinabModule, MinabService, type MinabModuleOptions, type MinabRunController } from '../../src/nestjs/index.js';
import { RULE_CONTEXT, dataPort, memoryStore, orderSchema, program } from './support.js';

async function endpoint(options: Partial<MinabModuleOptions> = {}) {
    const dynamic = MinabModule.forRoot({
        schemaLoader: () => orderSchema('v1'),
        ruleContext: RULE_CONTEXT,
        programStore: memoryStore([
            program('big', '.total > 10'),
            program('exists', 'EXISTS(#Order[.id == ^.id])'),
            program('secret', 'EXISTS(#Secret[.id == ^.id])')
        ]),
        endpoint: {},
        ...options
    });
    const module = await Test.createTestingModule({ imports: [dynamic] }).compile();
    return { module, controller: module.get(dynamic.controllers![0]) as MinabRunController, service: module.get(MinabService) };
}

const ref = (id: string) => ({ ref: { id, version: '1' } });
const body = (...runs: object[]) => ({ v: 1, runs });

describe('the schema comes from the server', () => {
    test('a program that reads #Secret fails: the schema has no such table', async () => {
        const { service } = await endpoint();
        await expect(service.runStored('secret', '1', { record: { id: 'o-1' } }, { data: dataPort() })).rejects.toBeInstanceOf(MinabException);
    });

    test('a schema (or tables, ports, host functions) sent by the client changes nothing', async () => {
        const { controller } = await endpoint();
        const port = dataPort();
        const withSecret = { ...orderSchema('v1'), tables: [...orderSchema('v1').tables, { name: 'Secret', primaryKey: 'id', columns: [] }] };
        const sneaky = {
            v: 1,
            schema: withSecret,
            ports: { data: 'x' },
            runs: [{ id: 'r1', program: ref('secret'), schema: withSecret, record: { id: 'o-1' } }]
        };
        let outcome: unknown;
        try {
            outcome = await controller.run(sneaky as never, {});
        } catch (error) {
            outcome = error;
        }
        // Either the request is refused, or the run fails. It never runs against the client's schema.
        expect(JSON.stringify(outcome)).not.toMatch(/"ok":true/);
        expect(port.calls).toHaveLength(0);
    });

    test('the loader is asked for the request and its answer is the schema of that request', async () => {
        const seen: unknown[] = [];
        const { service } = await endpoint({
            schemaLoader: ctx => {
                seen.push(ctx);
                // The runtime is cached by `version`: a schema that differs must have its own version.
                return (ctx as { tenant?: string }).tenant === 'a' ? orderSchema('tenant-a', 'extra_a') : orderSchema('tenant-b');
            }
        });
        const forA = await service.prepare('FROM Order SELECT .extra_a', { context: { tenant: 'a' } });
        const forB = await service.prepare('FROM Order SELECT .extra_a', { context: { tenant: 'b' } });
        expect(forA.ok).toBe(true);
        expect(forB.ok).toBe(false);
        expect(seen).toHaveLength(2);
    });
});

describe('the run endpoint', () => {
    test('refuses source text by default, and an id next to a source does not smuggle it in', async () => {
        const { controller } = await endpoint();
        for (const program of [{ source: '1 + 1' }, { ...ref('big'), source: 'EXISTS(#Order)' }]) {
            await expect(Promise.resolve().then(() => controller.run(body({ id: 'r1', program }) as never, {}))).rejects.toBeInstanceOf(MinabException);
        }
    });

    test('refuses a batch over the limit and runs nothing', async () => {
        const port = dataPort();
        const { controller } = await endpoint({ limits: { batchRuns: 3 }, endpoint: { ports: () => ({ data: port }) } });
        const run = (i: number) => ({ id: `r${i}`, program: ref('exists'), record: { id: 'o-1' } });
        await expect(Promise.resolve().then(() => controller.run(body(run(1), run(2), run(3), run(4)) as never, {}))).rejects.toBeInstanceOf(MinabException);
        expect(port.calls).toHaveLength(0);
    });

    test('error bodies hold no SQL text, no driver message and no stack, for any failing run', async () => {
        const leak = 'SELECT secret_column FROM vault_table WHERE token = $1';
        const failing = {
            async execute() {
                const error = Object.assign(new Error(leak), { code: '42P01', stack: `Error: ${leak}\n    at /srv/app/db.js:10:5` });
                throw error;
            }
        };
        const { controller } = await endpoint({ endpoint: { ports: () => ({ data: failing }) } });
        const response = await controller.run(body({ id: 'r1', program: ref('exists'), record: { id: 'o-1' } }), {});
        const text = JSON.stringify(response);
        expect(response.results[0]).toMatchObject({ ok: false });
        expect(text).not.toMatch(/vault_table|secret_column|SELECT|\/srv\/app|\bat \S+:\d+/);
    });
});

describe('logs', () => {
    const original = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = original;
    });

    function fakeLogger(): LoggerService & { lines: string[] } {
        const lines: string[] = [];
        return {
            lines,
            log: (m: string) => lines.push(m),
            warn: (m: string) => lines.push(m),
            error: (m: string) => lines.push(m),
            debug: () => {},
            verbose: () => {}
        } as never;
    }

    test('off by default in production: nothing is written, even for a log entry with personal data', () => {
        process.env.NODE_ENV = 'production';
        const logger = fakeLogger();
        new MinabLogger(undefined, { requestId: 'r' }, logger).emit({ kind: 'log', message: 'email: a@b.example' });
        expect(logger.lines).toEqual([]);
    });

    test('a value cannot forge a log line, whatever line break it holds', () => {
        process.env.NODE_ENV = 'development';
        const logger = fakeLogger();
        const sink = new MinabLogger(true, { requestId: 'r' }, logger);
        for (const brk of ['\n', '\r\n', '\r', '\u2028', '\u2029', '\u0085', '\v', '\f']) sink.emit({ kind: 'log', message: `a${brk}[program=evil] forged` });
        expect(logger.lines).toHaveLength(8);
        for (const line of logger.lines) expect(line).not.toMatch(/[\n\r\u2028\u2029\u0085\v\f]/);
    });

    test('the cap holds: 1,000 entries write at most 100 lines (D36) plus a note', () => {
        process.env.NODE_ENV = 'development';
        const logger = fakeLogger();
        const sink = new MinabLogger(true, {}, logger);
        for (let i = 0; i < 1_000; i++) sink.emit({ kind: 'log', message: `line ${i}` });
        expect(logger.lines.length).toBeLessThanOrEqual(101);
        expect(logger.lines.length).toBeGreaterThanOrEqual(100);
    });
});
