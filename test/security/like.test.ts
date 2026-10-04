/**
 * Phase Q3: `LIKE` cannot be slow and cannot overflow the stack.
 *
 * The matcher is iterative. A pattern with thousands of `%` used to overflow the stack
 * inside `run` (a RangeError, not a coded error).
 */

import { describe, expect, test } from 'vitest';
import { createMinab } from '../../src/runtime/index.js';
import { orderSchema } from '../support/runtime.js';

const minab = createMinab({ schema: orderSchema() });

async function like(text: string, pattern: string) {
    const program = await minab.prepare(`${JSON.stringify(text)} LIKE ${JSON.stringify(pattern)}`);
    expect(program.diagnostics).toEqual([]);
    const started = performance.now();
    const result = await program.run();
    return { result, ms: performance.now() - started };
}

describe('LIKE time', () => {
    const A = 'a'.repeat(10_000);
    test.each([
        [A, '%a%a%a%a%a%a%b'],
        [`${A}b`, '%a%a%a%a%a%a%bb'],
        [A, '%a_%a_%a_%a_%b'],
        [A, '_%a_%a_%a_%a_%a_%b'],
        ['ab'.repeat(5_000), '%ab%ab%ab%ab%ab%abc'],
        [A, '%aa%aa%aa%aa%aa%aab']
    ])('a hard pattern against 10,000 characters ends in under 50 ms (%#)', async (text, pattern) => {
        const { result, ms } = await like(text, pattern);
        expect(result).toMatchObject({ ok: true, value: false });
        expect(ms).toBeLessThan(50);
    });
});

describe('LIKE depth', () => {
    test('a pattern with 20,000 "%a" parts does not overflow the stack', async () => {
        const pattern = '%a'.repeat(20_000);
        const { result } = await like('a'.repeat(20_000), pattern);
        expect(result).toMatchObject({ ok: true, value: true });
    });

    test('a long pattern that cannot match gives false', async () => {
        const { result } = await like('a'.repeat(20_000), `${'%a'.repeat(20_000)}%b`);
        expect(result).toMatchObject({ ok: true, value: false });
    });
});

describe('LIKE meaning stays the same', () => {
    test.each([
        ['hello', 'h%o', true],
        ['hello', 'h_llo', true],
        ['hello', 'h_lo', false],
        ['hello', '%', true],
        ['', '%', true],
        ['', '_', false],
        ['abc', '%b%', true],
        ['abc', 'a%c%', true],
        ['abc', '%%%c', true],
        ['a%c', 'a\\%c', true],
        ['abc', 'a\\%c', false],
        ['a_c', 'a\\_c', true],
        ['a\\c', 'a\\\\c', true],
        ['日本語', '日_語', true],
        ['😀x', '_x', true],
        ['ab', 'abc%', false]
    ])('%j LIKE %j is %s', async (text, pattern, expected) => {
        const { result } = await like(text, pattern);
        expect(result).toMatchObject({ ok: true, value: expected });
    });

    test('a pattern that ends with an escape fails only when the matcher reaches it, as in Postgres', async () => {
        expect((await like('Hello', 'Hello\\')).result).toMatchObject({ ok: true, value: false });
        expect((await like('Hello!', 'Hello\\')).result).toMatchObject({ ok: false });
    });
});
