import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/host/config.js';
import { createMinab } from '../src/runtime/index.js';

/**
 * Production plan phase V4 (the 1.0 review) found three places where a type or a value did not
 * follow the spec. Each test here fails without its fix.
 * - The type of an `if` or a `switch` is the join of its branches: nullable when a branch may be
 *   `null`, and `DECIMAL` when `INTEGER` and `DECIMAL` mix (spec §7.2, §9.1, §9.2).
 * - A `DECIMAL` result leaves the run as text, also when its value came from an `INTEGER` branch (spec §7.2).
 * - `x += v` is `x = x + v` (spec §9.3): a `null` operand gives `null` (D46), not an error.
 * The Postgres answers are in `test/differential/cases/v4-readiness.cases.ts`.
 */

const { schema } = parseConfig({
    schema: {
        tables: [
            {
                name: 'Item',
                primaryKey: 'id',
                columns: { id: 'INTEGER', a: 'INTEGER', n: 'INTEGER?', x: 'DECIMAL', s: 'TEXT', tags: 'JSON?' }
            }
        ]
    }
});

const minab = createMinab({ schema, ruleContext: { recordTable: 'Item', isFieldRule: false } });
const record = { id: 1, a: 4, n: null, x: '2.5', s: 'abc', tags: [{ k: 'a', v: 1 }] };

async function typeOf(source: string): Promise<string | undefined> {
    const program = await minab.prepare(source);
    expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    return program.resultType;
}

async function valueOf(source: string): Promise<unknown> {
    const program = await minab.prepare(source);
    expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const result = await program.run({ record }, {}, { writes: 'dry-run' });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
}

describe('the type of an if is the join of its branches', () => {
    test.each([
        ['if .a > 10 { 1 } else { null }', 'INTEGER?'],
        ['if .a > 10 { null } else { 1 }', 'INTEGER?'],
        ['if .a > 10 { .a } else { .n }', 'INTEGER?'],
        ['if .a > 10 { .n } else { .a }', 'INTEGER?'],
        ['if .a > 10 { 1 } else { .x }', 'DECIMAL'],
        ['if .a > 10 { .x } else { 1 }', 'DECIMAL'],
        ['if .a > 10 { 1 } else if .a > 5 { .x } else { null }', 'DECIMAL?'],
        ['if .a > 10 { 1 } else { 2 }', 'INTEGER'],
        ['if .a > 10 { "a" } else { .s }', 'TEXT'],
        ['if .a > 10 { [1] }', 'INTEGER[]?'],
        ['if .a > 10 { [1] } else { null }', 'INTEGER[]?']
    ])('%s is %s', async (source, type) => {
        expect(await typeOf(source)).toBe(type);
    });

    test('branches of different families are still type.ifBranchesDiffer', async () => {
        const program = await minab.prepare('if .a > 10 { 1 } else { "one" }');
        expect(program.diagnostics.map(d => d.code)).toContain('type.ifBranchesDiffer');
    });
});

describe('the type of a switch is the join of its arms', () => {
    test.each([
        ['switch .a { 4 => null, _ => 1 }', 'INTEGER?'],
        ['switch .a { 4 => 1, _ => null }', 'INTEGER?'],
        ['switch .a { 4 => .n, _ => 1 }', 'INTEGER?'],
        ['switch .a { 4 => .x, _ => 1 }', 'DECIMAL'],
        ['switch .a { 4 => 1, _ => .x }', 'DECIMAL'],
        ['switch .a { 1 => 1, 2 => 2, _ => 3 }', 'INTEGER']
    ])('%s is %s', async (source, type) => {
        expect(await typeOf(source)).toBe(type);
    });

    test('arms of different families are still type.switchArmsDiffer', async () => {
        const program = await minab.prepare('switch .a { 4 => null, 5 => 1, _ => "x" }');
        expect(program.diagnostics.map(d => d.code)).toContain('type.switchArmsDiffer');
    });
});

describe('a branch of an if or a switch needs a value (spec §9.1)', () => {
    test.each([
        'if .a > 1 { LOG(1); } else { 2 }',
        'let x: INTEGER = if .a > 1 { LOG(1); } else { 2 }; x',
        'if .a > 1 { 1 } else { let z: INTEGER = 2; }',
        'switch .a { 4 => { LOG(1); }, _ => 2 }',
        'switch .a { 4 => 1, _ => { LOG(2); } }'
    ])('%s is type.blockNoValue', async source => {
        const program = await minab.prepare(source);
        expect(program.ok).toBe(false);
        expect(program.diagnostics.map(d => d.code)).toContain('type.blockNoValue');
    });

    test('a branch with statements and a tail, and an if! with no tail, are fine', async () => {
        expect(await valueOf('if .a > 1 { LOG(1); 1 } else { 2 }')).toBe(1);
        expect(await valueOf('let k: INTEGER = 0; if! .a > 1 { k = 1; } k')).toBe(1);
    });
});

describe('a DECIMAL result leaves the run as text', () => {
    test.each([
        ['if .a > 1 { 1 } else { .x }', '1'],
        ['if .a > 10 { 1 } else { .x }', '2.5'],
        ['switch .a { 4 => 7, _ => .x }', '7'],
        ['COALESCE(.a, .x)', '4'],
        ['COALESCE(.n, .x)', '2.5']
    ])('%s gives %j', async (source, value) => {
        expect(await valueOf(source)).toBe(value);
    });

    test('an INTEGER result stays a number', async () => {
        expect(await valueOf('if .a > 1 { 1 } else { 2 }')).toBe(1);
    });
});

describe('a compound assignment with a null operand gives null (spec §9.3, D46)', () => {
    test.each([
        ['let z: INTEGER? = 1; z += .n; z', null],
        ['let z: INTEGER? = null; z += 1; z', null],
        ['let z: INTEGER? = null; z -= 1; z', null],
        ['let z: INTEGER? = null; z *= 2; z', null],
        ['let z: DECIMAL? = null; z /= 0; z', null],
        ['let t: TEXT? = null; t += "a"; t', null],
        ['let t: TEXT? = "a"; t += .s; t', 'aabc'],
        ['let z: INTEGER = 1; z += 2; z', 3],
        ['let y: INTEGER? = null; y = y + 1; y', null]
    ])('%s gives %j', async (source, value) => {
        expect(await valueOf(source)).toBe(value);
    });
    // `SET { k +: v }` on a `JSON` array element follows the same rule: see `test/writes-json-paths.test.ts`.
});
