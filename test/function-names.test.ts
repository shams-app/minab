import { EmptyFileSystem } from 'langium';
import { parseHelper, validationHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import type { Model } from '../src/language/generated/ast.js';
import type { QueryExecutor, Row } from '../src/language/minab-executor.js';
import { createMinabServices } from '../src/language/minab-module.js';
import { EMPTY_SCHEMA } from '../src/language/schema.js';
import { evaluate } from './support/evaluate.js';

/**
 * D10: built-in names are ALL UPPERCASE and a user `fn` name needs a
 * lowercase letter. So a built-in that is added later (L5 added the real
 * `LOWER`) can never change what an existing `fn lower(...)` means.
 */

const executor: QueryExecutor = {
    async execute(): Promise<Row[]> {
        throw new Error('no query expected');
    }
};

describe('a built-in does not break an existing fn of the same name in lower case (D10)', () => {
    const services = createMinabServices(EmptyFileSystem, EMPTY_SCHEMA).Minab;
    const validate = validationHelper<Model>(services);
    const parse = parseHelper<Model>(services);
    const program = `
        fn lower(x: INTEGER): INTEGER { x + 1 }
        lower(41)
    `;

    test('LOWER is a built-in', async () => {
        const { diagnostics } = await validate(`LOWER("A")`);
        expect(diagnostics.map(d => d.message)).toEqual([]);
    });

    test('fn lower(...) still checks', async () => {
        const { diagnostics } = await validate(program);
        expect(diagnostics.map(d => d.message)).toEqual([]);
    });

    test('fn lower(...) still runs, and calls the user function', async () => {
        const document = await parse(program);
        const result = await evaluate(services.interpreter, document.parseResult.value, { executor });
        expect(result).toEqual({ ok: true, value: 42 });
    });

    test('fn LOWER(...) is refused by the case rule', async () => {
        const { diagnostics } = await validate(`fn LOWER(x: INTEGER): INTEGER { x }\n1`);
        expect(diagnostics.map(d => d.code)).toContain('call.functionNameCase');
    });
});
