import { EmptyFileSystem } from 'langium';
import { parseHelper, validationHelper } from 'langium/test';
import { describe, expect, test, vi } from 'vitest';
import type { Model } from '../src/language/generated/ast.js';
import type * as Builtins from '../src/language/minab-builtins.js';
import type { QueryExecutor, Row } from '../src/language/minab-executor.js';
import { createMinabServices } from '../src/language/minab-module.js';
import { EMPTY_SCHEMA } from '../src/language/schema.js';

/**
 * D10: built-in names are ALL UPPERCASE and a user `fn` name needs a
 * lowercase letter. So a built-in that is added later (here a test-only
 * `LOWER`, as L5 will add the real one) can never change what an existing
 * `fn lower(...)` means. The built-in table is copied and extended in the
 * mock below; the real table is not touched.
 */
vi.mock('../src/language/minab-builtins.js', async importOriginal => {
    const real = await importOriginal<typeof Builtins>();
    const lowerBuiltin = {
        name: 'LOWER',
        check: () => ({ ok: true as const, type: { kind: 'scalar' as const, base: 'TEXT' as const, nullable: false, array: false } })
    };
    return {
        ...real,
        getBuiltin: (name: string) => (name === 'LOWER' ? lowerBuiltin : real.getBuiltin(name)),
        isBuiltinName: (name: string) => name === 'LOWER' || real.isBuiltinName(name)
    };
});

const executor: QueryExecutor = {
    async execute(): Promise<Row[]> {
        throw new Error('no query expected');
    }
};

describe('a future built-in does not break an existing fn (D10)', () => {
    const services = createMinabServices(EmptyFileSystem, EMPTY_SCHEMA).Minab;
    const validate = validationHelper<Model>(services);
    const parse = parseHelper<Model>(services);
    const program = `
        fn lower(x: INTEGER): INTEGER { x + 1 }
        lower(41)
    `;

    test('the test-only LOWER is a built-in now', async () => {
        const { diagnostics } = await validate(`LOWER(1)`);
        expect(diagnostics.map(d => d.code)).not.toContain('call.unknownFunction');
    });

    test('fn lower(...) still checks', async () => {
        const { diagnostics } = await validate(program);
        expect(diagnostics.map(d => d.message)).toEqual([]);
    });

    test('fn lower(...) still runs, and calls the user function', async () => {
        const document = await parse(program);
        const result = await services.interpreter.evaluate(document.parseResult.value, { executor });
        expect(result).toEqual({ ok: true, value: 42 });
    });

    test('fn LOWER(...) is refused by the case rule', async () => {
        const { diagnostics } = await validate(`fn LOWER(x: INTEGER): INTEGER { x }\n1`);
        expect(diagnostics.map(d => d.code)).toContain('call.functionNameCase');
    });
});
