import { readFileSync } from 'node:fs';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { describe, expect, test } from 'vitest';
import type { Model } from '../src/language/generated/ast.js';
import { createMinabServices } from '../src/language/minab-module.js';

/**
 * The VS Code snippets (production plan E4). Each snippet, with its default
 * placeholder text filled in, must be a valid Minab program (it may not
 * pass the type check: the names are examples).
 */

interface Snippet {
    prefix: string[];
    description: string;
    body: string[];
}

const snippets = JSON.parse(readFileSync('vscode-extension/snippets/minab.json', 'utf8')) as Record<string, Snippet>;
const parse = parseHelper<Model>(createMinabServices(EmptyFileSystem).Minab);

/** What the editor inserts if the user presses Tab through every placeholder. */
function expand(body: string[]): string {
    return body
        .join('\n')
        .replace(/\$\{\d+:((?:[^}\\]|\\.)*)\}/g, '$1')
        .replace(/\$\{\d+\}|\$\d+/g, '')
        .replace(/\\(\$|\}|\\)/g, '$1');
}

describe('snippets/minab.json', () => {
    test('has the snippets the card asks for', () => {
        expect(Object.keys(snippets)).toEqual(
            expect.arrayContaining(['Record rule', 'Field rule', 'Query', 'Function', 'Switch', 'If expression', 'Loop over a collection'])
        );
    });

    test('every snippet has a prefix and a description, and no prefix is used twice', () => {
        const prefixes = Object.values(snippets).flatMap(s => s.prefix);
        expect(new Set(prefixes).size).toBe(prefixes.length);
        for (const [name, s] of Object.entries(snippets)) {
            expect(s.prefix.length, name).toBeGreaterThan(0);
            expect(s.description, name).not.toBe('');
        }
    });

    for (const [name, snippet] of Object.entries(snippets)) {
        test(`"${name}" parses`, async () => {
            const text = expand(snippet.body).replaceAll('\t', '    ');
            const document = await parse(text);
            const errors = [...document.parseResult.lexerErrors, ...document.parseResult.parserErrors].map(e => e.message);
            expect(errors, text).toEqual([]);
        });
    }
});
