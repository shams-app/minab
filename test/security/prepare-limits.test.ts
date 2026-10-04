/**
 * Phase Q3: prepare-time limits (D36). A huge or deep program is a coded diagnostic,
 * never a crash and never a stack overflow.
 */

import { describe, expect, test } from 'vitest';
import { createMinab } from '../../src/runtime/index.js';
import { orderSchema } from '../support/runtime.js';

const minab = createMinab({ schema: orderSchema() });

describe('prepare limits', () => {
    test('a 5,000-level nested expression is limit.tooDeep', async () => {
        const program = await minab.prepare(`${'('.repeat(5_000)}1${')'.repeat(5_000)}`);
        expect(program.ok).toBe(false);
        expect(program.diagnostics.map(d => d.code)).toEqual(['limit.tooDeep']);
    });

    test('5,000 nested calls, lists, minus and NOT are limit.tooDeep too', async () => {
        for (const source of [
            `${'ABS('.repeat(5_000)}1${')'.repeat(5_000)}`,
            `${'['.repeat(5_000)}1${']'.repeat(5_000)}`,
            `${'-'.repeat(5_000)}1`,
            `${'NOT '.repeat(5_000)}TRUE`
        ]) {
            const program = await minab.prepare(source);
            expect(program.ok).toBe(false);
            expect(program.diagnostics.map(d => d.code)).toEqual(['limit.tooDeep']);
        }
    });

    test('a 1 MB source is limit.sourceTooLong, with one diagnostic', async () => {
        const program = await minab.prepare(`"${'a'.repeat(1_048_576)}"`);
        expect(program.ok).toBe(false);
        expect(program.diagnostics).toHaveLength(1);
        expect(program.diagnostics[0]).toMatchObject({ code: 'limit.sourceTooLong', severity: 'error' });
    });

    test('a 1 MB source of many small tokens is refused before it is parsed', async () => {
        const started = performance.now();
        const program = await minab.prepare('1 + '.repeat(262_144) + '1');
        expect(program.diagnostics.map(d => d.code)).toEqual(['limit.sourceTooLong']);
        expect(performance.now() - started).toBeLessThan(2_000);
    });

    test('a refused program does not run and does not compile', async () => {
        const program = await minab.prepare(`"${'a'.repeat(1_048_576)}"`);
        expect(await program.run()).toMatchObject({ ok: false, error: { code: 'eval.programInvalid' } });
        expect(program.compile()).toMatchObject({ ok: false });
    });

    test('a host may set the limits lower', async () => {
        const small = createMinab({ schema: orderSchema(), limits: { sourceLength: 20, nestingDepth: 3 } });
        expect((await small.prepare('"aaaaaaaaaaaaaaaaaaaaaaaaaaaa"')).diagnostics[0]).toMatchObject({ code: 'limit.sourceTooLong' });
        expect((await small.prepare('((((1))))')).diagnostics[0]).toMatchObject({ code: 'limit.tooDeep' });
        expect((await small.prepare('((1))')).ok).toBe(true);
    });
});
