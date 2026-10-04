import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

// Item columns: a, b, n (INTEGER, n nullable), x, y (DECIMAL).
const record = { id: 1, a: 7, b: 2, n: null, x: 7.9, y: 2 };
const byZero = { error: 'division-by-zero' };

const row = (a: number, b: number) => ({ ...record, a, b });

export const cases: DifferentialCase[] = [
    { name: '\\ two INTEGER columns', schema, record, expr: '.a \\ .b', expect: 3 },
    { name: '\\ negative left side cuts toward zero', schema, record: row(-7, 2), expr: '.a \\ .b', expect: -3 },
    { name: '\\ negative right side cuts toward zero', schema, record: row(7, -2), expr: '.a \\ .b', expect: -3 },
    { name: '\\ two negative sides', schema, record: row(-7, -2), expr: '.a \\ .b', expect: 3 },
    { name: '\\ exact quotient', schema, record: row(8, 2), expr: '.a \\ .b', expect: 4 },
    { name: '\\ left side smaller than the right side is 0', schema, record: row(1, 2), expr: '.a \\ .b', expect: 0 },
    { name: '\\ a DECIMAL column is cut, not rounded', schema, record, expr: '.x \\ .b', expect: 3 },
    { name: '\\ a DECIMAL right side', schema, record, expr: '.a \\ .y', expect: 3 },
    { name: '\\ a negative DECIMAL', schema, record: { ...record, x: -7.9 }, expr: '.x \\ .b', expect: -3 },
    { name: '\\ literals', schema, record, expr: '7 \\ 2', expect: 3 },
    { name: '\\ negative literal', schema, record, expr: '-7 \\ 2', expect: -3 },
    { name: '\\ DECIMAL literal', schema, record, expr: '7.9 \\ 2', expect: 3 },
    { name: '\\ has the precedence of *', schema, record, expr: '1 + .a \\ .b * 2', expect: 7 },
    { name: '\\ and * go left to right', schema, record, expr: '.a * .b \\ 3', expect: 4 },
    { name: '(a \\ b) * b + a % b == a for 7 and 2', schema, record, expr: '(.a \\ .b) * .b + .a % .b == .a', expect: true },
    { name: '(a \\ b) * b + a % b == a for -7 and 2', schema, record: row(-7, 2), expr: '(.a \\ .b) * .b + .a % .b == .a', expect: true },
    { name: '(a \\ b) * b + a % b == a for 7 and -2', schema, record: row(7, -2), expr: '(.a \\ .b) * .b + .a % .b == .a', expect: true },
    { name: '(a \\ b) * b + a % b == a for -7 and -2', schema, record: row(-7, -2), expr: '(.a \\ .b) * .b + .a % .b == .a', expect: true },
    { name: '\\ by a zero column', schema, record: row(5, 0), expr: '.a \\ .b', expect: byZero },
    { name: '\\ by a zero literal', schema, record, expr: '5 \\ 0', expect: byZero },
    { name: '\\ by a zero DECIMAL column', schema, record: { ...record, y: 0 }, expr: '.a \\ .y', expect: byZero }
];
