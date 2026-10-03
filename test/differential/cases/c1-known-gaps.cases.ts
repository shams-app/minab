import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

/**
 * Bugs we know today: the two runtimes disagree. Each one names the card
 * that fixes it. That card removes `knownGap` and adds `expect`.
 */

export const cases: DifferentialCase[] = [
    {
        name: 'IN a list without null, on a null value',
        schema,
        record: { id: 1, n: null, a: 4 },
        expr: '.n IN [1, 2]',
        knownGap: {
            card: 'none yet',
            note: 'the interpreter says false; SQL says null (three-valued logic). Spec §7.7 says IN is repeated =='
        }
    },
    {
        name: 'IN a list with null, on a null value',
        schema,
        record: { id: 1, n: null, a: 4 },
        expr: '.n IN [1, null]',
        knownGap: {
            card: 'none yet',
            note: 'the interpreter says true; SQL says null. Spec §7.7 says null is fine in IN'
        }
    },
    {
        name: 'arithmetic with a null operand',
        schema,
        record: { id: 1, n: null, a: 4 },
        expr: '.n + .a',
        knownGap: {
            card: 'none yet',
            note: 'the interpreter fails with "expected a number"; SQL answers null'
        }
    }
];
