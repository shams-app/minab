import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

/**
 * Bugs we know today: the two runtimes disagree. Each one names the card
 * that fixes it. That card removes `knownGap` and adds `expect`.
 */
const record = { id: 1, a: 7, b: 2, x: 0.1, y: 0.2, z: 0.3, s: '12', ci: 'Hello' };

export const cases: DifferentialCase[] = [
    {
        name: 'decimal addition is exact',
        schema,
        record,
        expr: '.x + .y == .z',
        knownGap: { card: 'C2', note: 'the interpreter adds in binary floating point: 0.1 + 0.2 is not 0.3' }
    },
    {
        name: 'CAST DECIMAL to INTEGER',
        schema,
        record: { ...record, x: 3.7 },
        expr: 'CAST(.x AS INTEGER)',
        knownGap: { card: 'C3', note: 'the two runtimes round or cut differently' }
    },
    {
        name: 'CAST TEXT to INTEGER, then add',
        schema,
        record,
        expr: 'CAST(.s AS INTEGER) + 1',
        knownGap: { card: 'C3', note: 'the interpreter does not run CAST' }
    },
    {
        name: 'CAST INTEGER to TEXT, then compare',
        schema,
        record,
        expr: 'CAST(.a AS TEXT) == "7"',
        knownGap: { card: 'C3', note: 'the interpreter does not run CAST' }
    },
    {
        name: 'integer division',
        schema,
        record: { ...record, a: 7, b: 2 },
        expr: '.a / .b',
        knownGap: { card: 'C4', note: 'JS divides to 3.5, Postgres divides integers to 3' }
    },
    {
        name: 'remainder by zero',
        schema,
        record: { ...record, b: 0 },
        expr: '.a % .b',
        knownGap: { card: 'C4', note: 'JS gives NaN, Postgres raises division by zero' }
    },
    {
        name: 'CITEXT column compared with a TEXT column',
        schema,
        record: { ...record, s: 'hello' },
        expr: '.ci == .s',
        knownGap: { card: 'C5', note: 'the interpreter compares ignoring case; Postgres may compare as text' }
    },
    {
        name: 'TEXT column compared with a CITEXT column',
        schema,
        record: { ...record, s: 'hello' },
        expr: '.s == .ci',
        knownGap: { card: 'C5', note: 'same, with the sides swapped' }
    },
    {
        name: 'CITEXT column IN a list of text',
        schema,
        record,
        expr: '.ci IN ["hello"]',
        knownGap: { card: 'C5', note: 'IN on CITEXT' }
    },
    {
        name: 'is null has no SQL form',
        schema,
        record: { id: 1, n: null, a: 4 },
        expr: '.n is null',
        knownGap: { card: 'X1', note: 'the compiler refuses TypeTestExpression' }
    },
    {
        name: 'IN a list without null, on a null value',
        schema,
        record: { id: 1, n: null, a: 4 },
        expr: '.n IN [1, 2]',
        knownGap: { card: 'none yet', note: 'the interpreter says false; SQL says null (three-valued logic). Spec §7.7 says IN is repeated ==' }
    },
    {
        name: 'IN a list with null, on a null value',
        schema,
        record: { id: 1, n: null, a: 4 },
        expr: '.n IN [1, null]',
        knownGap: { card: 'none yet', note: 'the interpreter says true; SQL says null. Spec §7.7 says null is fine in IN' }
    },
    {
        name: 'arithmetic with a null operand',
        schema,
        record: { id: 1, n: null, a: 4 },
        expr: '.n + .a',
        knownGap: { card: 'none yet', note: 'the interpreter fails with "expected a number"; SQL answers null' }
    }
];
