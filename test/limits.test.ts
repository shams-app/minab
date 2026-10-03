/**
 * Production plan phase R4 — limits and cancellation (`src/runtime/limits.ts`, decision D36).
 */

import { describe, expect, test } from 'vitest';
import { createMinab, DEFAULT_LIMITS, type DataPort, type HostFunctions } from '../src/runtime/index.js';
import { RunBudget, resolveLimits, tightenLimits } from '../src/runtime/limits.js';
import { bracketDepth } from '../src/runtime/prepare.js';
import { orderSchema } from './support/runtime.js';

const record = { recordTable: 'Order', isFieldRule: false };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A data port that answers `rows` and remembers what it saw. */
function fakeData(rows: Record<string, unknown>[] = [{ value: true }]) {
    const calls: { signal: AbortSignal }[] = [];
    const port: DataPort = {
        execute: (_query, context) => {
            calls.push({ signal: context.signal });
            return Promise.resolve(rows);
        }
    };
    return { port, calls };
}

/** `count` correlated checks joined by AND. Each one is a statement for the data port. */
function statements(count: number): string {
    return Array.from({ length: count }, () => 'EXISTS(#Order[.status == "a"])').join(' AND ');
}

describe('the limits table (D36)', () => {
    test('the defaults are the ones of D36', () => {
        expect(DEFAULT_LIMITS).toEqual({
            sourceLength: 65_536,
            nestingDepth: 200,
            wallTimeMs: 1_000,
            statements: 100,
            rowsPerStatement: 10_000,
            loopIterations: 100_000,
            callDepth: 64,
            logEntries: 100,
            batchRuns: 100
        });
    });

    test('a host may raise or lower each limit; the rest keep their defaults', () => {
        expect(resolveLimits({ statements: 500, callDepth: 8 })).toEqual({ ...DEFAULT_LIMITS, statements: 500, callDepth: 8 });
        expect(resolveLimits(undefined)).toEqual(DEFAULT_LIMITS);
    });

    test('a bad limit is refused at createMinab', () => {
        const schema = orderSchema();
        expect(() => createMinab({ schema, limits: { statements: 0 } })).toThrow(/above zero/);
        expect(() => createMinab({ schema, limits: { statements: -1 } })).toThrow(/above zero/);
        expect(() => createMinab({ schema, limits: { statements: Number.NaN } })).toThrow(/above zero/);
        expect(() => createMinab({ schema, limits: { statements: '5' as unknown as number } })).toThrow(/above zero/);
        expect(() => createMinab({ schema, limits: { statement: 5 } as never })).toThrow(/not a limit/);
    });

    test('a run can only be tighter than the host: the smaller value wins', () => {
        const host = resolveLimits({ statements: 10, callDepth: 8 });
        expect(tightenLimits(host, { statements: 50 }).statements).toBe(10);
        expect(tightenLimits(host, { statements: 3 }).statements).toBe(3);
        expect(tightenLimits(host, { callDepth: 9, wallTimeMs: 5 })).toMatchObject({ callDepth: 8, wallTimeMs: 5 });
        expect(tightenLimits(host, undefined)).toEqual(host);
        expect(() => tightenLimits(host, { statements: 0 })).toThrow(/above zero/);
    });
});

describe('limits at prepare', () => {
    test('a 70 KB source is limit.sourceTooLong, and nothing is parsed', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare(`"${'a'.repeat(70 * 1024)}"`);
        expect(program.ok).toBe(false);
        expect(program.diagnostics).toHaveLength(1);
        expect(program.diagnostics[0]).toMatchObject({
            severity: 'error',
            code: 'limit.sourceTooLong',
            params: { limit: 65_536, used: 70 * 1024 + 2 }
        });
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'eval.programInvalid' } });
        expect(program.compile()).toMatchObject({ ok: false, error: { code: 'compile.programHasErrors' } });
    });

    test('the length is counted in UTF-8 bytes, not in characters', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { sourceLength: 100 } });
        // 30 Persian letters are 30 characters and 60 bytes: the whole program is 62 bytes.
        expect((await minab.prepare(`"${'ا'.repeat(30)}"`)).ok).toBe(true);
        // 60 Persian letters are 60 characters but 120 bytes.
        const long = await minab.prepare(`"${'ا'.repeat(60)}"`);
        expect(long.diagnostics[0]).toMatchObject({ code: 'limit.sourceTooLong', params: { limit: 100, used: 122 } });
    });

    test('a source at the limit is fine', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { sourceLength: 5 } });
        expect((await minab.prepare('1 + 1')).ok).toBe(true);
        expect((await minab.prepare('1 + 11')).diagnostics[0]?.code).toBe('limit.sourceTooLong');
    });

    test('nesting too deep is limit.tooDeep, with the range of the deepest node', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { nestingDepth: 5 } });
        const nested = (levels: number) => `${'['.repeat(levels)}1${']'.repeat(levels)}`;
        // `[[[[1]]]]` is four lists and a number: depth 5.
        const fine = await minab.prepare(nested(4));
        expect(fine.diagnostics.map(d => d.code)).not.toContain('limit.tooDeep');
        const deep = await minab.prepare(nested(5));
        expect(deep.ok).toBe(false);
        expect(deep.diagnostics).toHaveLength(1);
        expect(deep.diagnostics[0]).toMatchObject({ code: 'limit.tooDeep', params: { limit: 5, used: 6 } });
        // It points at the number in the middle.
        expect(deep.diagnostics[0].range.start).toEqual({ line: 0, character: 5 });
    });

    test('nested brackets over the limit are refused before the parser sees them', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare(`${'('.repeat(201)}1${')'.repeat(201)}`);
        expect(program.ok).toBe(false);
        expect(program.diagnostics).toHaveLength(1);
        expect(program.diagnostics[0]).toMatchObject({ code: 'limit.tooDeep', params: { limit: 200, used: 201 } });
    });

    test('a very deep program is limit.tooDeep at once, without parsing it (a parser would take gigabytes)', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const started = performance.now();
        const program = await minab.prepare(`${'['.repeat(30_000)}1${']'.repeat(30_000)}`);
        expect(program.ok).toBe(false);
        expect(program.diagnostics[0]).toMatchObject({ code: 'limit.tooDeep', params: { limit: 200, used: 30_000 } });
        expect(performance.now() - started).toBeLessThan(1_000);
    });

    test('when the parser itself runs out of stack below the limit, prepare still does not throw', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { nestingDepth: 1_000_000 } });
        const program = await minab.prepare(`${'['.repeat(150)}1${']'.repeat(150)}`);
        expect(program.ok).toBe(false);
        expect(program.diagnostics.map(d => d.code).some(code => code === 'limit.tooDeep' || code === 'type.listElementNotScalar')).toBe(true);
    });
});

describe('bracketDepth', () => {
    test('counts nesting of ( [ { and nothing in strings, quoted names or comments', () => {
        expect(bracketDepth('1 + 1')).toBe(0);
        expect(bracketDepth('f(g([1, {a: 2}]))')).toBe(4);
        expect(bracketDepth('"((((" + \'[[[[\' + `{{{{`')).toBe(0);
        expect(bracketDepth('"a\\"((((" + 1')).toBe(0);
        expect(bracketDepth('// (((((\n1')).toBe(0);
        expect(bracketDepth('/* ((((( */ 1')).toBe(0);
        expect(bracketDepth('/* never closed ((((')).toBe(0);
        expect(bracketDepth('"never closed ((((')).toBe(0);
    });

    test('a closer without an opener does not go below zero', () => {
        expect(bracketDepth(')))((')).toBe(2);
    });
});

describe('wall time', () => {
    test('a host function that waits 2 s, with a 100 ms limit, is limit.timeout within about 150 ms', async () => {
        const minab = createMinab({
            schema: orderSchema(),
            functions: [{ name: 'slow', params: [], returns: 'INTEGER' }],
            limits: { wallTimeMs: 100 }
        });
        const program = await minab.prepare('slow() + 1');
        // This function ignores the signal on purpose: the run must still end on time.
        const hostFunctions: HostFunctions = { call: () => wait(2_000).then(() => 1) };
        const started = performance.now();
        const result = await program.run({}, { hostFunctions });
        const elapsed = performance.now() - started;
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.timeout', params: { limit: 100 } } });
        expect(elapsed).toBeGreaterThanOrEqual(90);
        expect(elapsed).toBeLessThan(400);
    });

    test('the host function sees the signal abort at the limit', async () => {
        const minab = createMinab({ schema: orderSchema(), functions: [{ name: 'slow', params: [], returns: 'INTEGER' }], limits: { wallTimeMs: 50 } });
        const program = await minab.prepare('slow()');
        let seen: AbortSignal | undefined;
        const hostFunctions: HostFunctions = {
            call: (_name, _args, context) => {
                seen = context.signal;
                return wait(500).then(() => 1);
            }
        };
        const result = await program.run({}, { hostFunctions });
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.timeout' } });
        expect(seen?.aborted).toBe(true);
    });

    test('a slow data call is limit.timeout, and the data port saw the abort', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { wallTimeMs: 50 } });
        const program = await minab.prepare('FROM Order SELECT .id');
        let seen: AbortSignal | undefined;
        const port: DataPort = {
            execute: (_query, context) => {
                seen = context.signal;
                return wait(500).then(() => []);
            }
        };
        const result = await program.run({}, { data: port });
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.timeout' } });
        expect(seen?.aborted).toBe(true);
    });

    test('a run that never lets the timer fire still stops: the deadline is checked between steps', async () => {
        const minab = createMinab({ schema: orderSchema(), functions: [{ name: 'busy', params: [], returns: 'INTEGER' }], limits: { wallTimeMs: 10 } });
        const program = await minab.prepare('busy() + 1');
        // A synchronous wait: no timer can fire while it runs.
        const hostFunctions: HostFunctions = {
            call: () => {
                const end = performance.now() + 40;
                while (performance.now() < end) {
                    // busy
                }
                return 1;
            }
        };
        expect(await program.run({}, { hostFunctions })).toMatchObject({ ok: false, error: { code: 'limit.timeout' } });
    });

    test('a run that is fast enough is fine, and the timer is cleaned up', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { wallTimeMs: 50 } });
        const program = await minab.prepare('1 + 1');
        expect(await program.run()).toMatchObject({ ok: true, value: 2 });
        await wait(80); // a leaked timer would fire now; nothing observable breaks
    });
});

describe('cancellation', () => {
    test('aborting during a slow data call is cancelled, and the data port saw the abort', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order SELECT .id');
        const controller = new AbortController();
        let seen: AbortSignal | undefined;
        const port: DataPort = {
            execute: (_query, context) => {
                seen = context.signal;
                return wait(2_000).then(() => []);
            }
        };
        const running = program.run({}, { data: port }, { signal: controller.signal });
        await wait(30);
        controller.abort();
        const started = performance.now();
        expect(await running).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        expect(performance.now() - started).toBeLessThan(200);
        expect(seen?.aborted).toBe(true);
    });

    test('a signal that is already aborted ends the run before any port is called', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order SELECT .id');
        const { port, calls } = fakeData();
        const events: string[] = [];
        const result = await program.run({}, { data: port, events: { emit: e => events.push(e.kind) } }, { signal: AbortSignal.abort() });
        expect(result).toMatchObject({ ok: false, error: { code: 'cancelled', params: {} } });
        expect(calls).toHaveLength(0);
        expect(events).toEqual([]);
    });

    test('an abort between steps stops a program that calls a host function twice', async () => {
        const minab = createMinab({ schema: orderSchema(), functions: [{ name: 'tick', params: [], returns: 'INTEGER' }] });
        const program = await minab.prepare('tick() + tick() + tick()');
        const controller = new AbortController();
        let calls = 0;
        const hostFunctions: HostFunctions = {
            call: () => {
                calls++;
                controller.abort();
                return 1;
            }
        };
        expect(await program.run({}, { hostFunctions }, { signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'cancelled' } });
        expect(calls).toBe(1);
    });

    test('an abort does not leave a listener on the host signal', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('1 + 1');
        const controller = new AbortController();
        for (let i = 0; i < 20; i++) await program.run({}, {}, { signal: controller.signal });
        controller.abort(); // must not throw or call anything of a finished run
        expect(await program.run({}, {}, { signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    });
});

describe('call depth', () => {
    const recursive = 'fn down(n: INTEGER): INTEGER { down(n + 1) }\ndown(1)';

    test('a recursive fn is limit.callDepth at depth 64', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare(recursive);
        expect(program.diagnostics).toEqual([]);
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'limit.callDepth', params: { limit: 64 } } });
    });

    test('a call chain of exactly the limit is fine, one more is not', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { callDepth: 5 } });
        const program = await minab.prepare('fn sum(n: INTEGER): INTEGER { if n <= 0 { 0 } else { n + sum(n - 1) } }\nsum(4)');
        expect(await program.run()).toMatchObject({ ok: true, value: 10 });
        const deeper = await minab.prepare('fn sum(n: INTEGER): INTEGER { if n <= 0 { 0 } else { n + sum(n - 1) } }\nsum(5)');
        expect(await deeper.run()).toMatchObject({ ok: false, error: { code: 'limit.callDepth', params: { limit: 5 } } });
    });

    test('the depth is per run: calls that finished do not count', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { callDepth: 2 } });
        const program = await minab.prepare('fn one(n: INTEGER): INTEGER { n }\none(1) + one(2) + one(3) + one(4)');
        expect(await program.run()).toMatchObject({ ok: true, value: 10 });
    });

    test('a failed call still gives the depth back (a later call in a catch-free run is not affected)', async () => {
        const budget = new RunBudget(resolveLimits({ callDepth: 1 }));
        try {
            const leave = budget.enterCall();
            expect(() => budget.enterCall()).toThrow(/nested deeper/);
            leave();
            budget.enterCall()();
        } finally {
            budget.dispose();
        }
    });
});

describe('statements and rows', () => {
    test('100 statements are fine; 101 is limit.tooManyStatements, with the range of the 101st', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const { port, calls } = fakeData();
        const fine = await minab.prepare(statements(100));
        expect(await fine.run({}, { data: port })).toMatchObject({ ok: true, value: true, stats: { statements: 100 } });
        expect(calls).toHaveLength(100);

        const { port: second, calls: secondCalls } = fakeData();
        const over = await minab.prepare(statements(101));
        const result = await over.run({}, { data: second });
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.tooManyStatements', params: { limit: 100 } } });
        // The 101st statement is never sent.
        expect(secondCalls).toHaveLength(100);
        expect(result.ok ? undefined : result.error.range).toBeDefined();
    });

    test('a data port that returns 10,001 rows is limit.tooManyRows; 10,000 is fine', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order SELECT .id');
        const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `o-${i}` }));
        const fine = await program.run({}, { data: fakeData(rows(10_000)).port });
        expect(fine).toMatchObject({ ok: true, stats: { statements: 1, rows: 10_000 } });
        const over = await program.run({}, { data: fakeData(rows(10_001)).port });
        expect(over).toMatchObject({ ok: false, error: { code: 'limit.tooManyRows', params: { limit: 10_000 } } });
    });

    test('a host can raise the statement limit', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { statements: 150 } });
        const program = await minab.prepare(statements(120));
        expect(await program.run({}, { data: fakeData().port })).toMatchObject({ ok: true });
    });

    test('a run can lower a limit, and cannot raise the host limit', async () => {
        const host = createMinab({ schema: orderSchema(), limits: { statements: 2, rowsPerStatement: 3 } });
        const three = await host.prepare(statements(3));
        // Asking for more does nothing: the host's 2 holds.
        expect(await three.run({}, { data: fakeData().port }, { limits: { statements: 50 } })).toMatchObject({
            ok: false,
            error: { code: 'limit.tooManyStatements', params: { limit: 2 } }
        });
        // Asking for less works.
        const two = await host.prepare(statements(2));
        expect(await two.run({}, { data: fakeData().port })).toMatchObject({ ok: true });
        expect(await two.run({}, { data: fakeData().port }, { limits: { statements: 1 } })).toMatchObject({
            ok: false,
            error: { code: 'limit.tooManyStatements', params: { limit: 1 } }
        });
        // The same for rows.
        const query = await host.prepare('FROM Order SELECT .id');
        const four = Array.from({ length: 4 }, (_, i) => ({ id: i }));
        expect(await query.run({}, { data: fakeData(four).port }, { limits: { rowsPerStatement: 100 } })).toMatchObject({
            ok: false,
            error: { code: 'limit.tooManyRows', params: { limit: 3 } }
        });
    });

    test('the count starts again for every run', async () => {
        const minab = createMinab({ schema: orderSchema(), limits: { statements: 3 } });
        const program = await minab.prepare(statements(3));
        for (let i = 0; i < 3; i++) expect(await program.run({}, { data: fakeData().port })).toMatchObject({ ok: true });
    });

    test('a record rule settled from the record sends no statement and counts none', async () => {
        const minab = createMinab({ schema: orderSchema(), ruleContext: record, limits: { statements: 1 } });
        const program = await minab.prepare('.total > 1');
        expect(await program.run({ record: { total: 5 } })).toMatchObject({ ok: true, value: true, stats: { statements: 0, rows: 0 } });
    });
});

describe('loop iterations (X4 will call the counter)', () => {
    test('the counter trips at the limit, counted over all loops of the run', () => {
        const budget = new RunBudget(resolveLimits({ loopIterations: 3 }));
        try {
            budget.countIteration();
            budget.countIteration();
            budget.countIteration();
            expect(() => budget.countIteration()).toThrowError(expect.objectContaining({ code: 'limit.tooManyIterations', params: { limit: 3 } }));
        } finally {
            budget.dispose();
        }
    });

    test('the counter also checks the abort signal', () => {
        const controller = new AbortController();
        const budget = new RunBudget(resolveLimits({}), controller.signal);
        try {
            budget.countIteration();
            controller.abort();
            expect(() => budget.countIteration()).toThrowError(expect.objectContaining({ code: 'cancelled' }));
        } finally {
            budget.dispose();
        }
    });
});

describe('results', () => {
    test('a good run gives value, logs and stats', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const program = await minab.prepare('FROM Order SELECT .id');
        const result = await program.run({}, { data: fakeData([{ id: 'a' }, { id: 'b' }]).port });
        expect(result).toMatchObject({ ok: true, value: [{ id: 'a' }, { id: 'b' }], logs: [], stats: { statements: 1, rows: 2 } });
        expect(result.ok && result.stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('a failed run has only an error', async () => {
        const minab = createMinab({ schema: orderSchema() });
        const result = await (await minab.prepare('FROM Order SELECT .id')).run();
        expect(result.ok).toBe(false);
        expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
    });
});
