/**
 * Hover/go-to-definition for `#alias` (roadmap Phase 7's "verify
 * hover/go-to-definition work for at least `#alias` references"). Calls
 * the LSP services directly against a `parseHelper`-built document, the
 * same way `test/scoping.test.ts`/`test/validation.test.ts` call the
 * scope resolver/validator directly — no real JSON-RPC connection is
 * needed to exercise `HoverProvider`/`DefinitionProvider`.
 *
 * Scope-resolution correctness itself (aliases, shadowing, unresolved
 * names) is Phase 2's job and is covered by `test/scoping.test.ts`; this
 * file only confirms the provider wiring renders/targets what
 * `MinabScopeResolver.resolveNamedScope` already resolves.
 */

import { AstUtils, EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinabServices, type MinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';
import { isNamedScope, type Model } from '../src/language/generated/ast.js';

const fixtureSchema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('INTEGER') } }
            ]
        }
    ],
    functions: []
};

let parse: ReturnType<typeof parseHelper<Model>>;
let services: MinabServices;

beforeAll(async () => {
    const created = createMinabServices(EmptyFileSystem, fixtureSchema);
    services = created.Minab;
    parse = parseHelper<Model>(services);
});

describe('hover on `#alias` (spec §2.2)', () => {
    test('a `#Table` reference reports the table it resolves to', async () => {
        const document = await parse(`EXISTS(#Customer[.id == 1])`);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        const namedScope = AstUtils.streamAst(document.parseResult.value).find(isNamedScope)!;
        const position = document.textDocument.positionAt(namedScope.$cstNode!.offset + 1);

        const hover = await services.lsp.HoverProvider!.getHoverContent(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        expect(hover?.contents).toBeDefined();
        const value = typeof hover!.contents === 'object' && 'value' in hover!.contents ? hover!.contents.value : String(hover!.contents);
        expect(value).toContain('Customer');
    });

    test('an unresolved `#alias` produces no hover rather than throwing', async () => {
        const document = await parse(`EXISTS(#TotallyUnknownTable[.x == 1])`);
        const namedScope = AstUtils.streamAst(document.parseResult.value).find(isNamedScope)!;
        const position = document.textDocument.positionAt(namedScope.$cstNode!.offset + 1);

        const hover = await services.lsp.HoverProvider!.getHoverContent(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        expect(hover).toBeUndefined();
    });
});

describe('go-to-definition on `#alias` (spec §2.2)', () => {
    test('a `#Table` reference resolves to a location link', async () => {
        const document = await parse(`EXISTS(#Customer[.id == 1])`);
        const namedScope = AstUtils.streamAst(document.parseResult.value).find(isNamedScope)!;
        const position = document.textDocument.positionAt(namedScope.$cstNode!.offset + 1);

        const links = services.lsp.DefinitionProvider!.getDefinition(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        expect(links).toBeDefined();
        expect(links).toHaveLength(1);
    });

    test('an unresolved `#alias` produces no definition rather than throwing', async () => {
        const document = await parse(`EXISTS(#TotallyUnknownTable[.x == 1])`);
        const namedScope = AstUtils.streamAst(document.parseResult.value).find(isNamedScope)!;
        const position = document.textDocument.positionAt(namedScope.$cstNode!.offset + 1);

        const links = services.lsp.DefinitionProvider!.getDefinition(document, {
            textDocument: { uri: document.uri.toString() },
            position
        });

        expect(links).toBeUndefined();
    });
});
