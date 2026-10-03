import { AstUtils, EmptyFileSystem } from 'langium';
import { validationHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { parseConfig } from '../src/host/config.js';
import { isCallExpression, type Model } from '../src/language/generated/ast.js';
import { builtinNames, getBuiltin } from '../src/language/minab-builtins.js';
import { createMinabServices } from '../src/language/minab-module.js';
import { formatType } from '../src/language/minab-types.js';

/** Checker and arity rules of the built-in table (L5, D20). Values are proved by `test/differential/cases/l5-*`. */

const schema = parseConfig({
    schema: {
        tables: [
            {
                name: 'Person',
                primaryKey: 'id',
                columns: { id: 'INTEGER', name: 'TEXT', nickname: 'TEXT?', mail: 'CITEXT', age: 'INTEGER', age2: 'INTEGER?', price: 'DECIMAL', ok: 'BOOLEAN' }
            }
        ]
    }
}).schema;

let services: ReturnType<typeof createMinabServices>;
let validate: ReturnType<typeof validationHelper<Model>>;

beforeAll(() => {
    services = createMinabServices(EmptyFileSystem, schema);
    validate = validationHelper<Model>(services.Minab);
});

async function codes(expr: string): Promise<string[]> {
    const result = await validate(`FROM Person SELECT ${expr} AS v`);
    return result.diagnostics.map(d => String(d.code));
}

/** The inferred type of the first call in `FROM Person SELECT <expr> AS v`, as text. */
async function typeOf(expr: string): Promise<string> {
    const result = await validate(`FROM Person SELECT ${expr} AS v`);
    expect(result.diagnostics.map(d => d.message)).toEqual([]);
    const call = AstUtils.streamAllContents(result.document.parseResult.value).find(isCallExpression);
    const inferred = services.Minab.typeChecker.inferType(call!);
    if (!inferred.ok) throw new Error('the call has no type');
    return formatType(inferred.type);
}

describe('the built-in table', () => {
    test('has the eight old built-ins, the 16 functions of D20 and the nine of D21', () => {
        const old = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'EXISTS', 'ALL', 'ANY'];
        const d20 = [
            'LOWER',
            'UPPER',
            'TRIM',
            'LENGTH',
            'SUBSTRING',
            'REPLACE',
            'STARTS_WITH',
            'ENDS_WITH',
            'CONTAINS',
            'COALESCE',
            'ROUND',
            'ABS',
            'FLOOR',
            'CEIL',
            'GREATEST',
            'LEAST'
        ];
        const d21 = ['NOW', 'TODAY', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'DATE_ADD', 'DATE_DIFF'];
        expect(builtinNames()).toEqual([...old, ...d20, ...d21]);
    });

    test('every scalar has a SQL form and every aggregate a shape', () => {
        for (const name of builtinNames()) {
            const builtin = getBuiltin(name)!;
            if (builtin.kind === 'scalar') expect(builtin.sql, name).toBeTypeOf('function');
            else expect(builtin.sqlAggregate, name).toBeDefined();
        }
    });
});

describe('argument count', () => {
    test.each([
        ['ROUND()', 'call.wrongArgumentCount'],
        ['ROUND(.price, 1, 2)', 'call.wrongArgumentCount'],
        ['LOWER()', 'call.wrongArgumentCount'],
        ['LOWER(.name, .name)', 'call.wrongArgumentCount'],
        ['SUBSTRING(.name)', 'call.wrongArgumentCount'],
        ['SUBSTRING(.name, 1, 2, 3)', 'call.wrongArgumentCount'],
        ['COALESCE(.name)', 'call.wrongArgumentCount'],
        ['GREATEST(.age)', 'call.wrongArgumentCount']
    ])('%s is %s', async (expr, code) => {
        expect(await codes(expr)).toContain(code);
    });

    test.each([
        'ROUND(.price)',
        'ROUND(.price, 2)',
        'SUBSTRING(.name, 1)',
        'SUBSTRING(.name, 1, 2)',
        'COALESCE(.nickname, .name, "x")',
        'GREATEST(.age, 1, 2, 3)'
    ])('%s is accepted', async expr => {
        expect(await codes(expr)).toEqual([]);
    });

    test('an aggregate keeps its own arity code', async () => {
        expect(await codes('COUNT(.name, .name)')).toContain('call.builtinArity');
    });
});

describe('argument types', () => {
    test.each(['LENGTH(5)', 'LENGTH(.age)', 'LOWER(.ok)', 'ROUND(.name)', 'ABS("x")', 'SUBSTRING(.name, "1")', 'ROUND(.price, 1.5)', 'FLOOR(.ok)'])(
        '%s is call.argumentType',
        async expr => {
            expect(await codes(expr)).toContain('call.argumentType');
        }
    );

    test.each(['COALESCE(.name, .age)', 'GREATEST(.name, .age)', 'LEAST(.price, "x")'])('%s mixes types: call.argumentType', async expr => {
        expect(await codes(expr)).toContain('call.argumentType');
    });

    test('null fits every parameter', async () => {
        expect(await codes('LOWER(null)')).toEqual([]);
        expect(await codes('COALESCE(null, .name)')).toEqual([]);
    });

    test('INTEGER and DECIMAL may mix in COALESCE and GREATEST', async () => {
        expect(await codes('COALESCE(.age2, .price)')).toEqual([]);
        expect(await codes('GREATEST(.age, .price)')).toEqual([]);
    });
});

describe('result types', () => {
    test('COALESCE(.nickname, .name) has the type of .name and is not nullable', async () => {
        expect(await typeOf('COALESCE(.nickname, .name)')).toBe(await typeOf('LOWER(.name)'));
        expect(await typeOf('COALESCE(.nickname, .name)')).not.toContain('?');
    });

    test('COALESCE of only nullable values stays nullable', async () => {
        expect(await typeOf('COALESCE(.nickname, .nickname)')).toBe('TEXT?');
    });

    test('COALESCE of INTEGER and DECIMAL is DECIMAL', async () => {
        expect(await typeOf('COALESCE(.age2, .price)')).toBe('DECIMAL');
    });

    test('a nullable argument makes the answer nullable', async () => {
        expect(await typeOf('LOWER(.nickname)')).toBe('TEXT?');
        expect(await typeOf('LENGTH(.nickname)')).toBe('INTEGER?');
        expect(await typeOf('STARTS_WITH(.nickname, "a")')).toBe('BOOLEAN?');
        expect(await typeOf('ABS(.age2)')).toBe('INTEGER?');
    });

    test('text functions keep CITEXT', async () => {
        expect(await typeOf('LOWER(.mail)')).toBe('CITEXT');
        expect(await typeOf('TRIM(.mail)')).toBe('CITEXT');
    });

    test('number functions keep the number type; FLOOR and CEIL give INTEGER', async () => {
        expect(await typeOf('ROUND(.price, 2)')).toBe('DECIMAL');
        expect(await typeOf('ROUND(.age)')).toBe('INTEGER');
        expect(await typeOf('ABS(.price)')).toBe('DECIMAL');
        expect(await typeOf('FLOOR(.price)')).toBe('INTEGER');
        expect(await typeOf('CEIL(.price)')).toBe('INTEGER');
    });

    test('LENGTH is INTEGER, the searches are BOOLEAN', async () => {
        expect(await typeOf('LENGTH(.name)')).toBe('INTEGER');
        expect(await typeOf('CONTAINS(.name, "a")')).toBe('BOOLEAN');
        expect(await typeOf('ENDS_WITH(.name, "a")')).toBe('BOOLEAN');
    });

    test('GREATEST and LEAST are nullable only when all arguments are', async () => {
        expect(await typeOf('GREATEST(.age2, .age)')).toBe('INTEGER');
        expect(await typeOf('LEAST(.age2, .age2)')).toBe('INTEGER?');
    });
});
