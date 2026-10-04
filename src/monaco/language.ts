/**
 * The static part of the Minab language in Monaco: tokens, brackets, comments, word pattern.
 * Pure data and one pure function; nothing here needs Monaco at run time.
 */

import { INITIAL_STATE, tokenizeLine, type LineState, type TokenType } from '../editor/tokens.js';

/**
 * Monaco themes match a token by the start of its scope, so each Minab category
 * has a scope that a stock theme already colors, and the part after the dot
 * lets a host theme tell them apart.
 */
export const TOKEN_SCOPES: Record<TokenType, string> = {
    'keyword.pipeline': 'keyword.pipeline',
    'keyword.dml': 'keyword.dml',
    'keyword.operator': 'keyword.operator',
    'keyword.control': 'keyword.control',
    type: 'type',
    constant: 'constant',
    builtin: 'predefined.builtin',
    function: 'function',
    'sigil.record': 'variable.sigil.record',
    'sigil.field': 'variable.sigil.field',
    'sigil.parent': 'variable.sigil.parent',
    'sigil.alias': 'variable.sigil.alias',
    'sigil.key': 'variable.sigil.key',
    'sigil.index': 'variable.sigil.index',
    member: 'identifier.member',
    identifier: 'identifier',
    string: 'string',
    number: 'number',
    comment: 'comment',
    operator: 'operator',
    delimiter: 'delimiter',
    whitespace: '',
    invalid: 'invalid'
};

/** The tokenizer state that Monaco carries between lines. Only an open block comment spans lines. */
export class MinabLineState {
    constructor(readonly line: LineState = INITIAL_STATE) {}
    /** A copy of the state. Monaco needs it for each line. */
    clone(): MinabLineState {
        return new MinabLineState({ ...this.line });
    }
    /** Two states are equal when a block comment is open in both or in neither. */
    equals(other: unknown): boolean {
        return other instanceof MinabLineState && other.line.inBlockComment === this.line.inBlockComment;
    }
}

/** A tokens provider for `monaco.languages.setTokensProvider`. It runs the same tokenizer as the playground. */
export const tokensProvider = {
    /** The state at the start of a document. */
    getInitialState: () => new MinabLineState(),
    /** Colours one line. The state tells if a block comment is open. */
    tokenize(line: string, state: MinabLineState) {
        const result = tokenizeLine(line, state.line);
        return {
            tokens: result.tokens.map(token => ({ startIndex: token.start, scopes: TOKEN_SCOPES[token.type] })),
            endState: new MinabLineState(result.state)
        };
    }
};

/** Brackets, auto-closing pairs and comments (line and block, like the grammar). */
export const languageConfiguration = {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] as [string, string] },
    brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
    ] as [string, string][],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"', notIn: ['string', 'comment'] },
        { open: "'", close: "'", notIn: ['string', 'comment'] },
        { open: '`', close: '`', notIn: ['string', 'comment'] }
    ],
    surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '`', close: '`' }
    ],
    /** A number, a name with any Unicode letter (and `!` for `if!`), or a backtick name. */
    wordPattern: /(-?\d+(\.\d+)?)|([\p{L}_][\p{L}\p{N}_‌‍]*!?)|(`(?:[^`\\]|\\[\s\S])*`)/gu
};
