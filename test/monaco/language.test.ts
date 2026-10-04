/**
 * Production plan phase E5 — the static Minab language in Monaco: tokens, scopes, brackets and comments.
 * The tokens come from `src/editor/tokens.ts`, so these tests are about the Monaco side of them.
 */

import { describe, expect, test } from 'vitest';
import { languageConfiguration, tokensProvider } from '../../src/monaco/index.js';

/** The scoped tokens of one line, as `scope:text`. */
function scopes(line: string, state = tokensProvider.getInitialState()): string[] {
    const { tokens } = tokensProvider.tokenize(line, state);
    return tokens
        .map((token, i) => ({ scope: token.scopes, text: line.slice(token.startIndex, tokens[i + 1]?.startIndex ?? line.length) }))
        .filter(token => token.scope !== '')
        .map(token => `${token.scope}:${token.text}`);
}

describe('the tokens provider', () => {
    test('keywords: pipeline, control, operator and type words', () => {
        expect(scopes('FROM Order WHERE .total > 5 SELECT .id')).toContain('keyword.pipeline:FROM');
        expect(scopes('FROM Order WHERE .total > 5 SELECT .id')).toContain('keyword.pipeline:WHERE');
        expect(scopes('let x: DECIMAL = 1;')).toEqual([
            'keyword.control:let',
            'identifier:x',
            'operator::',
            'type:DECIMAL',
            'operator:=',
            'number:1',
            'delimiter:;'
        ]);
        expect(scopes('a AND b')).toContain('keyword.operator:AND');
        expect(scopes('if! x')).toContain('keyword.control:if!');
    });

    test('sigils each have a scope of their own', () => {
        expect(scopes('.customer.name')).toEqual(['variable.sigil.record:.customer', 'delimiter:.', 'identifier.member:name']);
        expect(scopes('^.room_id')).toEqual(['variable.sigil.parent:^', 'delimiter:.', 'identifier.member:room_id']);
        expect(scopes('#Booking[.id != $]')).toEqual([
            'variable.sigil.alias:#Booking',
            'delimiter:[',
            'variable.sigil.record:.id',
            'operator:!=',
            'variable.sigil.field:$',
            'delimiter:]'
        ]);
        expect(scopes('KEY.name')[0]).toBe('variable.sigil.key:KEY');
    });

    test('strings, built-ins and user function calls', () => {
        expect(scopes(`"a \\" b" 'c'`)).toEqual([`string:"a \\" b"`, `string:'c'`]);
        expect(scopes('COUNT(.orders)')[0]).toBe('predefined.builtin:COUNT');
        expect(scopes('discounted(1)')[0]).toBe('function:discounted');
    });

    test('Unicode names and backtick names are names', () => {
        expect(scopes('.مبلغ + .قیمت')).toEqual(['variable.sigil.record:.مبلغ', 'operator:+', 'variable.sigil.record:.قیمت']);
        expect(scopes('let çalışan = 1;')[1]).toBe('identifier:çalışan');
        expect(scopes('.`order total` > 1')[0]).toBe('variable.sigil.record:.`order total`');
        expect(scopes('`from`')).toEqual(['identifier:`from`']);
    });

    test('comments: a line comment, a block comment, and one that spans lines', () => {
        expect(scopes('1 // note')).toEqual(['number:1', 'comment:// note']);
        expect(scopes('1 /* a */ + 2')).toEqual(['number:1', 'comment:/* a */', 'operator:+', 'number:2']);
        const first = tokensProvider.tokenize('1 /* open', tokensProvider.getInitialState());
        expect(scopes('still comment */ 2', first.endState)).toEqual(['comment:still comment */', 'number:2']);
        expect(first.endState.equals(first.endState.clone())).toBe(true);
        expect(first.endState.equals(tokensProvider.getInitialState())).toBe(false);
    });
});

describe('the language configuration', () => {
    test('brackets, auto-closing quotes and backticks, and both comment styles', () => {
        expect(languageConfiguration.comments).toEqual({ lineComment: '//', blockComment: ['/*', '*/'] });
        expect(languageConfiguration.brackets).toEqual([
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ]);
        const opens = languageConfiguration.autoClosingPairs.map(pair => pair.open);
        expect(opens).toEqual(expect.arrayContaining(['{', '[', '(', '"', "'", '`']));
    });

    test('the word pattern takes Unicode names, numbers and backtick names whole', () => {
        const words = (text: string) => text.match(languageConfiguration.wordPattern);
        expect(words('.مبلغ + 3.5')).toEqual(['مبلغ', '3.5']);
        expect(words('`order total` x')).toEqual(['`order total`', 'x']);
        expect(words('if! y')).toEqual(['if!', 'y']);
    });
});
