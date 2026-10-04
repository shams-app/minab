/**
 * Production plan phase X3 — statements run: blocks, function bodies, assignment to local names, `if!`.
 */

import { describe, expect, test } from 'vitest';
import { createMinab } from '../src/runtime/index.js';
import { orderSchema } from './support/runtime.js';

const minab = createMinab({ schema: orderSchema() });

async function run(source: string) {
    const program = await minab.prepare(source);
    expect(program.diagnostics).toEqual([]);
    return await program.run();
}

describe('functions with statements', () => {
    test('let, += and if! return the right value', async () => {
        const result = await run(`
            fn bonus(points: INTEGER): INTEGER {
                let total: INTEGER = points;
                if! points > 10 {
                    total += 5;
                } else if points > 5 {
                    total += 2;
                } else {
                    total -= 1;
                }
                total
            }
            bonus(20) * 100 + bonus(7) * 10 + bonus(1)
        `);
        expect(result).toMatchObject({ ok: true, value: 25 * 100 + 9 * 10 + 0 });
    });

    test('the arguments can be assigned too', async () => {
        const result = await run('fn twice(n: INTEGER): INTEGER { n *= 2; n }\ntwice(4)');
        expect(result).toMatchObject({ ok: true, value: 8 });
    });

    test('-= and /= follow the operators', async () => {
        expect(await run('fn f(n: DECIMAL): DECIMAL { n -= 0.5; n /= 2; n }\nf(4)')).toMatchObject({ ok: true, value: '1.75' });
        expect(await run('fn f(n: INTEGER): INTEGER { n /= 0; n }\nf(4)')).toMatchObject({ ok: false, error: { code: 'eval.divisionByZero' } });
    });
});

describe('assignment', () => {
    test('+= joins text (D13)', async () => {
        const result = await run('fn f(): TEXT { let label: TEXT = "order"; label += "-42"; label }\nf()');
        expect(result).toMatchObject({ ok: true, value: 'order-42' });
    });

    test('?= assigns only a null', async () => {
        const nullDiscount = await run('fn f(): DECIMAL? { let discount: DECIMAL? = null; discount ?= 0.10; discount }\nf()');
        expect(nullDiscount).toMatchObject({ ok: true, value: '0.1' });
        const setDiscount = await run('fn f(): DECIMAL? { let discount: DECIMAL? = 0.2; discount ?= 0.10; discount }\nf()');
        expect(setDiscount).toMatchObject({ ok: true, value: '0.2' });
    });

    test('|= merges an object into a JSON local', async () => {
        const result = await run('fn f(): JSON { let j: JSON = { a: 1 }; j |= { b: 2 }; j }\nf()');
        expect(result).toMatchObject({ ok: true, value: { a: 1, b: 2 } });
    });

    test('= keeps the declared type: a DECIMAL stays exact', async () => {
        const result = await run('fn f(): DECIMAL { let x: DECIMAL = 0.1; x = 0.2; x += 0.1; x }\nf()');
        expect(result).toMatchObject({ ok: true, value: '0.3' });
    });

    test('a record path is a write: eval.writesNotSupported', async () => {
        const program = await minab.prepare('if true { .total = 21; 1 } else { 0 }', { ruleContext: { recordTable: 'Order', isFieldRule: false } });
        expect(program.diagnostics).toEqual([]);
        const result = await program.run({ record: { id: 'o-1', total: 1 } });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.writesNotSupported' } });
    });
});

describe('top-level statements', () => {
    test('run in order before the tail', async () => {
        const result = await run('let total: INTEGER = 0;\ntotal += 5;\ntotal *= 4;\nif! total > 10 {\n    total -= 1;\n}\ntotal');
        expect(result).toMatchObject({ ok: true, value: 19 });
    });
});

describe('blocks', () => {
    test("an inner block's let shadows the outer one, and the outer value is back after it", async () => {
        const result = await run(`
            fn f(): INTEGER[] {
                let x: INTEGER = 1;
                let inner: INTEGER = if true {
                    let x: INTEGER = 50;
                    x += 1;
                    x
                } else {
                    0
                };
                [inner, x]
            }
            f()
        `);
        expect(result).toMatchObject({ ok: true, value: [51, 1] });
    });

    test('an assignment in a block changes the outer name', async () => {
        const result = await run(`
            fn f(): INTEGER {
                let n: INTEGER = 1;
                let ignored: INTEGER = if true { n = 7; 0 } else { 1 };
                n + ignored
            }
            f()
        `);
        expect(result).toMatchObject({ ok: true, value: 7 });
    });

    test('a block does not change what . means', async () => {
        const program = await minab.prepare('if true { let a: INTEGER = 1; .total } else { 0 }', { ruleContext: { recordTable: 'Order', isFieldRule: false } });
        expect(program.diagnostics).toEqual([]);
        expect(await program.run({ record: { id: 'o-1', total: 3 } })).toMatchObject({ ok: true, value: '3' });
    });
});

describe('limits', () => {
    test('a function that calls itself forever is limit.callDepth', async () => {
        const result = await run('fn f(n: INTEGER): INTEGER { let m: INTEGER = n + 1; m += 1; f(m) }\nf(0)');
        expect(result).toMatchObject({ ok: false, error: { code: 'limit.callDepth', params: { limit: 64 } } });
    });
});

describe('what does not run yet', () => {
    test('a loop in a function body is still refused, by name', async () => {
        const result = await run('fn f(): INTEGER { loop i from 1 to 3 { } 1 }\nf()');
        expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('"LoopStatement" is not executed yet') } });
    });
});
