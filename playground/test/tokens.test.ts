import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { builtinNames } from '../../src/language/minab-builtins.js';
import { prettySql } from '../src/syntax/highlight.js';
import { ALL_WORD_KEYWORDS, BUILTINS, tokenize } from '../src/syntax/tokens.js';

/** The keywords Langium generated from the grammar — the source of truth the tokenizer must track. */
function grammarKeywords(): string[] {
    const ast = readFileSync(resolve(import.meta.dirname, '../../src/language/generated/ast.ts'), 'utf8');
    // The union ends at the first `;` that closes a line — `";"` is itself a keyword.
    const union = /export type MinabKeywordNames =([\s\S]*?);\n/.exec(ast)![1];
    return [...union.matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

describe('the tokenizer tracks the grammar', () => {
    test('every alphabetic keyword in the grammar has a category', () => {
        const words = grammarKeywords().filter(k => /^[A-Za-z_][A-Za-z!_]*$/.test(k));
        expect(words.filter(k => !ALL_WORD_KEYWORDS.includes(k))).toEqual([]);
    });

    test('the tokenizer knows no keyword the grammar lacks', () => {
        const grammar = new Set(grammarKeywords());
        expect(ALL_WORD_KEYWORDS.filter(k => !grammar.has(k))).toEqual([]);
    });

    test('built-ins match the checker’s list', () => {
        expect([...BUILTINS].sort()).toEqual(builtinNames().sort());
    });
});

function types(source: string): string[] {
    return tokenize(source).flat().filter(t => t.type !== 'whitespace').map(t => `${t.type}:${t.text}`);
}

describe('sigils', () => {
    test('a leading dot is the current record; a dot after a name is member access', () => {
        expect(types('.customer.name')).toEqual(['sigil.record:.customer', 'delimiter:.', 'member:name']);
        expect(types('^.room_id')).toEqual(['sigil.parent:^', 'delimiter:.', 'member:room_id']);
        expect(types('KEY.name')).toEqual(['sigil.key:KEY', 'delimiter:.', 'member:name']);
    });

    test('named scopes, calls, $ and .$index', () => {
        expect(types('#Booking[.id != $]')).toEqual([
            'sigil.alias:#Booking', 'delimiter:[', 'sigil.record:.id', 'operator:!=', 'sigil.field:$', 'delimiter:]'
        ]);
        expect(types('&discounted(1)')).toEqual(['sigil.call:&discounted', 'delimiter:(', 'number:1', 'delimiter:)']);
        expect(types('.$index')).toEqual(['sigil.index:.$index']);
    });

    test('if! is one keyword', () => {
        expect(types('if! x')).toEqual(['keyword.control:if!', 'identifier:x']);
    });
});

test('block comments carry across lines', () => {
    const lines = tokenize('/* a\nb */ FROM');
    expect(lines[1].map(t => t.type)).toEqual(['comment', 'whitespace', 'keyword.pipeline']);
});

test('tokens reassemble into the source', () => {
    const source = 'FROM Order AS o // c\nWHERE .total >= 1.5 AND "x\\"y" != \'z\'';
    expect(tokenize(source).map(line => line.map(t => t.text).join('')).join('\n')).toBe(source);
});

test('prettySql breaks only top-level clauses', () => {
    const sql = 'SELECT (SELECT "a" FROM "B" WHERE x = 1) AS "v" FROM "T" WHERE "s" = \'a FROM b\' ORDER BY "v" DESC';
    expect(prettySql(sql)).toBe('SELECT (SELECT "a" FROM "B" WHERE x = 1) AS "v"\nFROM "T"\nWHERE "s" = \'a FROM b\'\nORDER BY "v" DESC');
});
