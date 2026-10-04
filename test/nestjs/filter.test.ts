/**
 * Phase H2: the exception filter (code to HTTP status) and the logger adapter.
 */

import type { ArgumentsHost, LoggerService } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MinabException, MinabExceptionFilter, MinabLogger, minabHttpStatus, oneLine } from '../../src/nestjs/index.js';
import { runError } from '../../src/runtime/errors.js';
import { WireError } from '../../src/runtime/wire.js';

function reply(exception: MinabException | WireError): { status: number; body: any } {
    const sent: { status?: number; body?: unknown } = {};
    const adapter = { reply: (_res: unknown, body: unknown, status: number) => Object.assign(sent, { body, status }) };
    const filter = new MinabExceptionFilter({ httpAdapter: adapter } as unknown as HttpAdapterHost);
    filter.catch(exception, { switchToHttp: () => ({ getResponse: () => ({}) }) } as unknown as ArgumentsHost);
    return sent as { status: number; body: any };
}

describe('MinabExceptionFilter', () => {
    test('a program with errors is 422 with the codes and ranges of its diagnostics', () => {
        const diagnostic = {
            severity: 'error' as const,
            code: 'type.unexpectedResultType',
            message: 'x',
            range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
            params: {}
        };
        const { status, body } = reply(MinabException.invalidProgram([diagnostic]));
        expect(status).toBe(422);
        expect(body.v).toBe(1);
        expect(body.error.code).toBe('eval.programInvalid');
        expect(body.diagnostics).toEqual([diagnostic]);
    });

    test('limits are 422', () => {
        expect(reply(new MinabException(runError('limit.timeout', undefined, { limit: 1000 }))).status).toBe(422);
        expect(reply(new MinabException(runError('limit.tooManyRows', undefined, { limit: 10 }))).status).toBe(422);
    });

    test('cancelled is 499', () => {
        expect(reply(new MinabException(runError('cancelled', undefined))).status).toBe(499);
    });

    test('data.error is 500 and shows no SQL, no driver message and no stack', () => {
        const error = {
            ...runError('data.error', undefined),
            message: 'relation "secret_table" does not exist: SELECT * FROM secret_table',
            params: { sqlstate: '42P01' }
        };
        const exception = new MinabException(error);
        const { status, body } = reply(exception);
        expect(status).toBe(500);
        const text = JSON.stringify(body);
        expect(text).not.toMatch(/secret_table|SELECT/);
        expect(text).not.toMatch(/\bat \w+.*:\d+/); // no stack frame
        expect(body.error).toEqual({ code: 'data.error', message: 'the data source failed', params: { sqlstate: '42P01' } });
    });

    test('wire errors are 400, from a MinabException or a WireError', () => {
        expect(reply(new MinabException(runError('wire.invalidRequest', undefined, { path: 'runs', reason: 'must be a list' }))).status).toBe(400);
        expect(reply(new WireError(runError('wire.tooManyRuns', undefined, { limit: 100, used: 101 }))).status).toBe(400);
    });

    test('an unknown program is 404', () => {
        const { status, body } = reply(MinabException.programNotFound('p', '1'));
        expect(status).toBe(404);
        expect(body.error.code).toBe('wire.programNotFound');
    });

    test('a code from no known area is 500 without detail', () => {
        const { status, body } = reply(new MinabException({ code: 'mystery.bug', message: 'secret internals', params: { a: 1 } }));
        expect(status).toBe(500);
        expect(body.error).toEqual({ code: 'mystery.bug', message: 'internal error', params: {} });
    });

    test('minabHttpStatus covers the registry areas', () => {
        expect(minabHttpStatus('eval.divisionByZero')).toBe(422);
        expect(minabHttpStatus('type.implicitCoercion')).toBe(422);
        expect(minabHttpStatus('compile.notSql')).toBe(422);
        expect(minabHttpStatus('data.noPort')).toBe(500);
    });
});

function fakeLogger(): LoggerService & { lines: string[]; debugLines: string[]; warnings: string[] } {
    const out = {
        lines: [] as string[],
        debugLines: [] as string[],
        warnings: [] as string[],
        log: (m: string) => void out.lines.push(m),
        debug: (m: string) => void out.debugLines.push(m),
        warn: (m: string) => void out.warnings.push(m),
        error: () => undefined
    };
    return out;
}

describe('MinabLogger', () => {
    const original = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = original;
    });

    test('writes log events tagged with the program id and the request id', () => {
        process.env.NODE_ENV = 'development';
        const logger = fakeLogger();
        new MinabLogger(undefined, { programId: 'view:1', requestId: 'req-9' }, logger).emit({ kind: 'log', message: 'hello' });
        expect(logger.lines).toEqual(['[program=view:1 request=req-9] hello']);
    });

    test('is off by default when NODE_ENV is production (D37)', () => {
        process.env.NODE_ENV = 'production';
        const logger = fakeLogger();
        const sink = new MinabLogger(undefined, {}, logger);
        sink.emit({ kind: 'log', message: 'secret' });
        sink.emit({ kind: 'statement', sql: 'SELECT 1', params: [] });
        expect(sink.isEnabled).toBe(false);
        expect(logger.lines).toEqual([]);
        expect(logger.debugLines).toEqual([]);
    });

    test('a host can turn it on in production', () => {
        process.env.NODE_ENV = 'production';
        const logger = fakeLogger();
        new MinabLogger({ enabled: true }, {}, logger).emit({ kind: 'log', message: 'on' });
        expect(logger.lines).toHaveLength(1);
    });

    test('a newline in a value cannot forge a second log line', () => {
        process.env.NODE_ENV = 'development';
        const logger = fakeLogger();
        new MinabLogger(true, { requestId: 'r' }, logger).emit({ kind: 'log', message: 'ok\n[program=evil request=x] forged\r\u2028end' });
        expect(logger.lines).toHaveLength(1);
        expect(logger.lines[0]).not.toMatch(/[\n\r\u2028]/);
        expect(logger.lines[0]).toContain('ok\\n[program=evil');
    });

    test('tags are on one line too', () => {
        const logger = fakeLogger();
        new MinabLogger(true, { programId: 'a\nb', requestId: 'c\rd' }, logger).emit({ kind: 'log', message: 'x' });
        expect(logger.lines[0]).toBe('[program=a\\nb request=c\\rd] x');
    });

    test('is capped, and says how many entries it dropped', () => {
        const logger = fakeLogger();
        const sink = new MinabLogger({ enabled: true, maxEntries: 3 }, {}, logger);
        for (let i = 0; i < 10; i++) sink.emit({ kind: 'log', message: `m${i}` });
        sink.finish();
        expect(logger.lines).toHaveLength(3);
        expect(sink.droppedCount).toBe(7);
        expect(logger.warnings[0]).toContain('7 log entries dropped');
    });

    test('the default cap is the logEntries limit (100)', () => {
        const logger = fakeLogger();
        const sink = new MinabLogger(true, {}, logger);
        for (let i = 0; i < 150; i++) sink.emit({ kind: 'log', message: 'x' });
        expect(logger.lines).toHaveLength(100);
    });

    test('statements go to debug level only when asked, without parameter values', () => {
        const logger = fakeLogger();
        const off = new MinabLogger(true, {}, logger);
        off.emit({ kind: 'statement', sql: 'SELECT $1', params: ['ali@example.com'] });
        expect(logger.debugLines).toEqual([]);
        const on = new MinabLogger({ enabled: true, statements: true }, {}, logger);
        on.emit({ kind: 'statement', sql: 'SELECT $1', params: ['ali@example.com'] });
        expect(logger.debugLines).toHaveLength(1);
        expect(logger.debugLines[0]).toContain('SELECT $1');
        expect(logger.debugLines[0]).not.toContain('ali@example.com');
    });

    test('oneLine escapes backslashes, so an escape cannot be faked', () => {
        expect(oneLine('a\\nb')).toBe('a\\\\nb');
        expect(oneLine('x'.repeat(5000)).length).toBeLessThan(2100);
    });
});

test('a sink that throws does not break a run (the runtime drops it)', async () => {
    const { boot } = await import('./support.js');
    const { service } = await boot({ logs: true });
    const prepared = await service.prepare('.total > 10');
    const sink = {
        emit: vi.fn(() => {
            throw new Error('boom');
        })
    };
    const result = await service.run(prepared, { record: { total: 25 } }, { events: sink });
    expect(result).toMatchObject({ ok: true, value: true });
});
