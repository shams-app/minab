import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

/**
 * `CAST` (C3, D16, spec §5.5). Both runtimes follow Postgres. A value is read from a
 * column (the text column `s`, the decimal column `x`, ...), so the SQL has typed operands.
 */
const fails = { error: 'cast-failed' };

function fromText(name: string, s: string, target: string, expect: unknown): DifferentialCase {
    return { name, schema, record: { s }, expr: `CAST(.s AS ${target})`, expect };
}

function fromDecimal(name: string, x: string, target: string, expect: unknown): DifferentialCase {
    return { name, schema, record: { x }, expr: `CAST(.x AS ${target})`, expect };
}

export const cases: DifferentialCase[] = [
    // DECIMAL -> INTEGER: half away from zero
    fromDecimal('3.7 to INTEGER is 4', '3.7', 'INTEGER', 4),
    fromDecimal('3.5 to INTEGER is 4', '3.5', 'INTEGER', 4),
    fromDecimal('3.4 to INTEGER is 3', '3.4', 'INTEGER', 3),
    fromDecimal('-3.5 to INTEGER is -4', '-3.5', 'INTEGER', -4),
    fromDecimal('-3.4 to INTEGER is -3', '-3.4', 'INTEGER', -3),
    fromDecimal('-0.4 to INTEGER is 0', '-0.4', 'INTEGER', 0),
    fromDecimal('0.5 to INTEGER is 1', '0.5', 'INTEGER', 1),
    fromDecimal('a whole decimal to INTEGER', '12.00', 'INTEGER', 12),

    // text -> INTEGER
    fromText('text to INTEGER', '12', 'INTEGER', 12),
    fromText('text with spaces to INTEGER', ' 12 ', 'INTEGER', 12),
    fromText('negative text to INTEGER', '-7', 'INTEGER', -7),
    fromText('signed text to INTEGER', '+7', 'INTEGER', 7),
    fromText('text with a letter to INTEGER fails', '12a', 'INTEGER', fails),
    fromText('empty text to INTEGER fails', '', 'INTEGER', fails),
    fromText('text with a fraction to INTEGER fails', '12.5', 'INTEGER', fails),
    fromText('text with two numbers to INTEGER fails', '1 2', 'INTEGER', fails),
    {
        name: 'text to INTEGER, then add',
        schema,
        record: { s: ' 12 ' },
        expr: 'CAST(.s AS INTEGER) + 1',
        expect: 13
    },

    // text -> DECIMAL
    fromText('text to DECIMAL', '2.50', 'DECIMAL', '2.5'),
    fromText('text with spaces to DECIMAL', ' 2.5 ', 'DECIMAL', '2.5'),
    fromText('whole text to DECIMAL', '7', 'DECIMAL', '7'),
    fromText('negative text to DECIMAL', '-0.10', 'DECIMAL', '-0.1'),
    fromText('text with an exponent to DECIMAL', '1e2', 'DECIMAL', '100'),
    fromText('text with a letter to DECIMAL fails', '2.5x', 'DECIMAL', fails),
    fromText('empty text to DECIMAL fails', '', 'DECIMAL', fails),
    {
        name: 'INTEGER to DECIMAL',
        schema,
        record: { a: 5 },
        expr: 'CAST(.a AS DECIMAL) / 2',
        expect: '2.5'
    },

    // to TEXT
    {
        name: 'INTEGER to TEXT',
        schema,
        record: { a: 5 },
        expr: 'CAST(.a AS TEXT)',
        expect: '5'
    },
    {
        name: 'negative INTEGER to TEXT',
        schema,
        record: { a: -5 },
        expr: 'CAST(.a AS TEXT)',
        expect: '-5'
    },
    {
        name: 'INTEGER to TEXT, then compare',
        schema,
        record: { a: 7 },
        expr: 'CAST(.a AS TEXT) == "7"',
        expect: true
    },
    fromDecimal('DECIMAL to TEXT drops trailing zeros', '2.50', 'TEXT', '2.5'),
    fromDecimal('whole DECIMAL to TEXT', '3.00', 'TEXT', '3'),
    fromDecimal('negative DECIMAL to TEXT', '-0.100', 'TEXT', '-0.1'),
    fromDecimal('zero DECIMAL to TEXT', '0.00', 'TEXT', '0'),
    fromDecimal('big DECIMAL to TEXT', '12345678901234567890.1200', 'TEXT', '12345678901234567890.12'),
    fromDecimal('DECIMAL to CITEXT', '2.50', 'CITEXT', '2.5'),
    {
        name: 'BOOLEAN to TEXT',
        schema,
        record: { yes: true },
        expr: 'CAST(.yes AS TEXT)',
        expect: 'true'
    },
    {
        name: 'false BOOLEAN to TEXT',
        schema,
        record: { no: false },
        expr: 'CAST(.no AS TEXT)',
        expect: 'false'
    },
    fromText('text to TEXT', ' a b ', 'TEXT', ' a b '),

    // text -> BOOLEAN
    ...['true', 'TRUE', 't', 'yes', 'Yes', 'y', 'on', 'ON', '1', ' true '].map(word => fromText(`"${word}" to BOOLEAN is true`, word, 'BOOLEAN', true)),
    ...['false', 'False', 'f', 'no', 'n', 'off', 'OFF', '0', ' no '].map(word => fromText(`"${word}" to BOOLEAN is false`, word, 'BOOLEAN', false)),
    ...['maybe', '', '2', 'yeah', 'o'].map(word => fromText(`"${word}" to BOOLEAN fails`, word, 'BOOLEAN', fails)),
    {
        name: 'BOOLEAN to INTEGER',
        schema,
        record: { yes: true },
        expr: 'CAST(.yes AS INTEGER)',
        expect: 1
    },

    // text -> UUID
    fromText('text to UUID', '123e4567-e89b-12d3-a456-426614174000', 'UUID', '123e4567-e89b-12d3-a456-426614174000'),
    fromText('upper case text to UUID', '123E4567-E89B-12D3-A456-426614174000', 'UUID', '123e4567-e89b-12d3-a456-426614174000'),
    fromText('not-a-uuid to UUID fails', 'not-a-uuid', 'UUID', fails),
    fromText('short text to UUID fails', '123e4567-e89b-12d3-a456', 'UUID', fails),

    // text -> DATE, TIME, DATETIME
    fromText('text to DATE', '2026-10-02', 'DATE', '2026-10-02'),
    fromText('text with spaces to DATE', ' 2026-10-02 ', 'DATE', '2026-10-02'),
    fromText('leap day to DATE', '2024-02-29', 'DATE', '2024-02-29'),
    fromText('a day that does not exist to DATE fails', '2026-02-30', 'DATE', fails),
    fromText('month 13 to DATE fails', '2026-13-01', 'DATE', fails),
    fromText('letters to DATE fails', 'abc', 'DATE', fails),
    fromText('text to TIME', '08:30:00', 'TIME', '08:30:00'),
    fromText('text without seconds to TIME', '08:30', 'TIME', '08:30:00'),
    fromText('text with a fraction to TIME', '08:30:00.50', 'TIME', '08:30:00.5'),
    fromText('hour 25 to TIME fails', '25:00:00', 'TIME', fails),
    fromText('words to TIME fails', 'noon', 'TIME', fails),
    fromText('text to DATETIME', '2026-10-02T08:30:00', 'DATETIME', '2026-10-02T08:30:00.000Z'),
    fromText('text with Z to DATETIME', '2026-10-02T08:30:00Z', 'DATETIME', '2026-10-02T08:30:00.000Z'),
    fromText('text with a space to DATETIME', '2026-10-02 08:30:00', 'DATETIME', '2026-10-02T08:30:00.000Z'),
    fromText('a date alone to DATETIME', '2026-10-02', 'DATETIME', '2026-10-02T00:00:00.000Z'),
    fromText('letters to DATETIME fails', '2026-10-02 later', 'DATETIME', fails),

    // JSON
    fromText('JSON text to JSON', '{"a": [1, 2]}', 'JSON', { a: [1, 2] }),
    fromText('a JSON string to JSON', '"hi"', 'JSON', 'hi'),
    fromText('a JSON number to JSON', '12', 'JSON', 12),
    fromText('bad JSON text to JSON fails', '{a:', 'JSON', fails),

    // null
    {
        name: 'null INTEGER to TEXT',
        schema,
        record: { n: null },
        expr: 'CAST(.n AS TEXT)',
        expect: null
    },
    {
        name: 'null TEXT to DATE',
        schema,
        record: { t: null },
        expr: 'CAST(.t AS DATE)',
        expect: null
    },
    {
        name: 'null TEXT to UUID',
        schema,
        record: { t: null },
        expr: 'CAST(.t AS UUID)',
        expect: null
    },
    {
        name: 'null TEXT to BOOLEAN',
        schema,
        record: { t: null },
        expr: 'CAST(.t AS BOOLEAN)',
        expect: null
    },
    {
        name: 'null TEXT to INTEGER',
        schema,
        record: { t: null },
        expr: 'CAST(.t AS INTEGER)',
        expect: null
    }
];
