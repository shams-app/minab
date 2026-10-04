import { describe, expect, test } from 'vitest';
import { signatureHelp } from '../../src/editor/index.js';
import { openCallsAt } from '../../src/editor/signature-help.js';
import { parseSignature } from '../../src/editor/builtin-docs.js';
import { cursor, open, setup } from './support.js';

const services = setup({ host: true });

function help(marked: string) {
    const { source, offset } = cursor(marked);
    return signatureHelp(open(services, source), offset);
}

const DISCOUNTED = 'fn discounted(price: DECIMAL, pct: DECIMAL): DECIMAL { price }\n';

describe('signature help', () => {
    test('a user function shows its parameters and the active one', () => {
        expect(help(`${DISCOUNTED}discounted(|`)).toMatchObject({
            label: 'fn discounted(price: DECIMAL, pct: DECIMAL): DECIMAL',
            parameters: ['price: DECIMAL', 'pct: DECIMAL'],
            activeParameter: 0
        });
        expect(help(`${DISCOUNTED}discounted(10, |`)?.activeParameter).toBe(1);
        expect(help(`${DISCOUNTED}discounted(10, 5|)`)?.activeParameter).toBe(1);
    });

    test('a built-in shows its signature', () => {
        expect(help('ROUND(2.5, |')).toMatchObject({
            label: 'ROUND(n: N, digits?: INTEGER) → N',
            parameters: ['n: N', 'digits?: INTEGER'],
            activeParameter: 1
        });
    });

    test('a host function shows its signature', () => {
        expect(help('fxRate("USD", |')).toMatchObject({
            parameters: ['from: TEXT', 'to: TEXT'],
            activeParameter: 1
        });
    });

    test('commas inside text, brackets and inner calls are not separators', () => {
        expect(help('SUBSTRING("a,b", 1, |')?.activeParameter).toBe(2);
        expect(help('SUBSTRING([1, 2, 3], |')?.activeParameter).toBe(1);
        expect(help('ROUND(ABS(1, 2), |')?.activeParameter).toBe(1);
    });

    test('inside an inner call, that call is shown', () => {
        expect(help('ROUND(ABS(|')?.label).toContain('ABS(');
    });

    test('after the closing bracket, the call is closed', () => {
        expect(help('ROUND(2.5)|')).toBeUndefined();
    });

    test('a call with more arguments than parameters stays on the last one; a rest parameter too', () => {
        expect(help('ABS(1, 2, |')?.activeParameter).toBe(0);
        expect(help('COALESCE(1, 2, 3, |')?.activeParameter).toBe(2);
    });

    test('a bracket of a keyword is not a call, so the outer call shows', () => {
        expect(help('ROUND(1, (2 + |')?.label).toContain('ROUND(');
    });

    test('nothing for an unknown name', () => {
        expect(help('nothing(|')).toBeUndefined();
    });

    test('a call in a comment is ignored', () => {
        expect(help('// ROUND(\n|')).toBeUndefined();
    });
});

describe('the helpers', () => {
    test('parseSignature cuts at top-level commas only', () => {
        expect(parseSignature('DATE_ADD(d: DATE | DATETIME, n: INTEGER, unit: "year" | "month") → same type as d')?.parameters).toEqual([
            'd: DATE | DATETIME',
            'n: INTEGER',
            'unit: "year" | "month"'
        ]);
        expect(parseSignature('NOW() → DATETIME')?.parameters).toEqual([]);
    });

    test('openCallsAt lists calls from the inside out', () => {
        expect(openCallsAt('A(1, B(2, ', 10)).toEqual([
            { name: 'B', argument: 1 },
            { name: 'A', argument: 1 }
        ]);
    });
});
