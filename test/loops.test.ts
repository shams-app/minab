/**
 * Production plan phase X4 — loops, `break`/`continue`, `.$index` and tuples.
 */

import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/host/config.js';
import { createMinab, type DataPort } from '../src/runtime/index.js';

const { schema } = parseConfig({
    schema: {
        tables: [
            {
                name: 'Customer',
                primaryKey: 'id',
                columns: { id: 'UUID', orders: { collection: 'Order', foreignKey: 'customer_id' } }
            },
            { name: 'Order', primaryKey: 'id', columns: { id: 'UUID', customer_id: 'UUID', status: 'TEXT', total: 'DECIMAL' } }
        ]
    }
});

/** A data port that answers every statement with the same rows, and counts the statements. */
function fakeData(rows: Record<string, unknown>[]) {
    const seen: string[] = [];
    const port: DataPort = {
        execute: query => {
            seen.push(query.text);
            return Promise.resolve(rows);
        }
    };
    return { port, seen };
}

const minab = createMinab({ schema, ruleContext: { recordTable: 'Customer', isFieldRule: false } });

async function run(source: string, options: Parameters<typeof minab.prepare>[1] = undefined, data?: DataPort) {
    const program = await minab.prepare(source, options);
    expect(program.diagnostics).toEqual([]);
    return await program.run({ record: { id: 'c1' } }, { data });
}

describe('range loops', () => {
    test('by 2 visits 1, 3, 5', async () => {
        const result = await run('let seen: TEXT = ""; loop i from 1 to 5 by 2 { seen += CAST(i AS TEXT) + ","; } seen');
        expect(result).toMatchObject({ ok: true, value: '1,3,5,' });
    });

    test('where skips a number', async () => {
        const result = await run('let sum: INTEGER = 0; loop i from 1 to 5 where i != 3 { sum += i; } sum');
        expect(result).toMatchObject({ ok: true, value: 12 });
    });

    test('an empty range does not run the body', async () => {
        expect(await run('let n: INTEGER = 0; loop i from 5 to 1 { n += 1; } n')).toMatchObject({ ok: true, value: 0 });
    });

    test('a step of zero is an error', async () => {
        expect(await run('let n: INTEGER = 0; loop i from 1 to 5 by 0 { n += 1; } n')).toMatchObject({ ok: false, error: { code: 'eval.failed' } });
    });
});

describe('for-in loops', () => {
    test('over an array', async () => {
        const result = await run('let sum: INTEGER = 0; loop x in [10, 20, 30] { sum += x; } sum');
        expect(result).toMatchObject({ ok: true, value: 60 });
    });

    test('over a collection reads the rows once', async () => {
        const { port, seen } = fakeData([
            { status: 'open', total: '5' },
            { status: 'shipped', total: '100' },
            { status: 'open', total: '7' }
        ]);
        const result = await run('let total: DECIMAL = 0; loop o in .orders where .status == "open" { total = total + o.total; } total', undefined, port);
        expect(result).toMatchObject({ ok: true, value: '12' });
        expect(seen).toHaveLength(1);
    });
});

describe('bare-condition loops', () => {
    test('run while the condition holds', async () => {
        const result = await run('let n: INTEGER = 0; loop n < 4 { n += 1; } n');
        expect(result).toMatchObject({ ok: true, value: 4 });
    });

    test('loop true hits the iteration limit', async () => {
        const result = await run('loop true { }', undefined);
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.tooManyIterations' } });
    });
});

describe('break and continue', () => {
    test('continue skips the rest of one iteration', async () => {
        const result = await run('let sum: INTEGER = 0; loop i from 1 to 5 { if! i == 3 { continue; } sum += i; } sum');
        expect(result).toMatchObject({ ok: true, value: 12 });
    });

    test('break leaves the innermost loop only', async () => {
        const result = await run('let n: INTEGER = 0; loop a from 1 to 3 { loop b from 1 to 3 { if! b == 2 { break; } n += 1; } } n');
        expect(result).toMatchObject({ ok: true, value: 3 });
    });

    test('a labeled break leaves both loops', async () => {
        const result = await run('let n: INTEGER = 0; outer: loop a from 1 to 3 { loop b from 1 to 3 { if! b == 2 { break outer; } n += 1; } } n');
        expect(result).toMatchObject({ ok: true, value: 1 });
    });

    test('a labeled continue goes on with the next step of the outer loop', async () => {
        const result = await run('let n: INTEGER = 0; outer: loop a from 1 to 3 { loop b from 1 to 3 { if! b == 2 { continue outer; } n += 1; } } n');
        expect(result).toMatchObject({ ok: true, value: 3 });
    });

    test('a function body can loop and return', async () => {
        const result = await run(
            'fn countUntilOver(limit: INTEGER): INTEGER { let count: INTEGER = 0; let total: INTEGER = 0; loop total <= limit { count += 1; total += count; } count }\ncountUntilOver(10)'
        );
        expect(result).toMatchObject({ ok: true, value: 5 });
    });
});

describe('the iteration limit', () => {
    test('counts the steps of all loops, also the skipped ones', async () => {
        const limited = createMinab({ schema, limits: { loopIterations: 5 } });
        const program = await limited.prepare('loop i from 1 to 3 { loop j from 1 to 3 { } }');
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'limit.tooManyIterations', params: { limit: 5 } } });
    });
});

describe('.$index', () => {
    test('keeps the elements at the right positions (zero-based)', async () => {
        const result = await run('[10, 20, 30, 40][.$index >= 2]');
        expect(result).toMatchObject({ ok: true, value: [30, 40] });
    });

    test('works inside a loop over an array', async () => {
        const result = await run('let sum: INTEGER = 0; loop x in [5, 6, 7] { sum += .$index * x; } sum');
        expect(result).toMatchObject({ ok: true, value: 0 * 5 + 1 * 6 + 2 * 7 });
    });

    test('on the rows of a table it is eval.indexNeedsArray', async () => {
        const { port } = fakeData([{ status: 'open', total: '5' }]);
        const result = await run('let n: INTEGER = 0; loop o in .orders { n += .$index; } n', undefined, port);
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.indexNeedsArray' } });
    });
});

describe('tuples', () => {
    test('a literal and a positional access', async () => {
        expect(await run('let point: (INTEGER, TEXT) = (3, "x"); point[0]')).toMatchObject({ ok: true, value: 3 });
        expect(await run('let point: (INTEGER, TEXT) = (3, "x"); point[1]')).toMatchObject({ ok: true, value: 'x' });
    });

    test('a function can return a tuple', async () => {
        const result = await run('fn pair(a: INTEGER): (INTEGER, INTEGER) { let b: INTEGER = a * 2; (a, b) }\npair(4)');
        expect(result).toMatchObject({ ok: true, value: [4, 8] });
    });

    test('tuples nest', async () => {
        expect(await run('let t: (INTEGER, (TEXT, BOOLEAN)) = (1, ("a", true)); t[1][0]')).toMatchObject({ ok: true, value: 'a' });
    });
});
