/** Production plan phase H4 — values that cross the worker bridge. */

import { describe, expect, test } from 'vitest';
import { fromWire, toWire } from '../../src/browser/protocol.js';
import { Big } from '../../src/language/values.js';

describe('toWire and fromWire', () => {
    test('decimals travel as text and come back exact', () => {
        const wire = toWire({ total: new Big('24.90'), list: [new Big('0.1')] });
        expect(wire).toEqual({ total: { $minab: 'decimal', v: '24.9' }, list: [{ $minab: 'decimal', v: '0.1' }] });
        const back = fromWire(wire) as { total: Big; list: Big[] };
        expect(back.total).toBeInstanceOf(Big);
        expect(String(back.list[0])).toBe('0.1');
    });

    test('dates travel as ISO text', () => {
        const at = new Date('2026-10-02T08:30:00.000Z');
        expect(toWire(at)).toEqual({ $minab: 'datetime', v: '2026-10-02T08:30:00.000Z' });
        expect(fromWire(toWire(at))).toEqual(at);
    });

    test('plain values and null stay as they are, and undefined fields are dropped', () => {
        expect(toWire({ a: 1, b: 'x', c: true, d: null, e: undefined })).toEqual({ a: 1, b: 'x', c: true, d: null });
    });

    test('an object with its own $minab key cannot pretend to be a tag', () => {
        const sneaky = { $minab: 'decimal', v: '1' };
        const back = fromWire(toWire(sneaky));
        expect(back).toEqual(sneaky);
        expect(back).not.toBeInstanceOf(Big);
    });

    test('a __proto__ key stays plain data', () => {
        const back = fromWire(JSON.parse('{"__proto__":{"polluted":true},"a":1}')) as Record<string, unknown>;
        expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.keys(back)).toEqual(['__proto__', 'a']);
    });

    test('a function, a class instance, NaN and a bad tag are wire.invalidValue', () => {
        class Thing {}
        for (const value of [() => 1, new Thing(), Number.NaN, new Date('nope'), Symbol('s')]) {
            expect(() => toWire({ field: value })).toThrowError(expect.objectContaining({ error: expect.objectContaining({ code: 'wire.invalidValue' }) }));
        }
        expect(() => fromWire({ $minab: 'decimal', v: 'abc' })).toThrow();
        expect(() => fromWire({ $minab: 'unknown', v: 1 })).toThrow();
    });
});
