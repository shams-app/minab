/**
 * Minab's lexical categories — one source of truth for every place the
 * playground colors code: the Monaco editor (through a tokens provider),
 * and the static snippets on the landing page, gallery cards, lessons and
 * cheat sheet (through `highlight`). `test/tokens.test.ts` checks these
 * lists against the keywords Langium generates from the grammar, so a
 * grammar change can't leave a keyword uncolored.
 *
 * The categories follow the language's own design: SQL-style pipeline
 * keywords are uppercase, control flow is lowercase (README "Working
 * conventions"), and the sigils — `.` `$` `^` `#` `&` `KEY` — each get a
 * color of their own, because they are what makes Minab read like Minab.
 */

export type TokenType =
    | 'keyword.pipeline'
    | 'keyword.dml'
    | 'keyword.operator'
    | 'keyword.control'
    | 'type'
    | 'constant'
    | 'builtin'
    | 'sigil.record'
    | 'sigil.field'
    | 'sigil.parent'
    | 'sigil.alias'
    | 'sigil.call'
    | 'sigil.key'
    | 'sigil.index'
    | 'member'
    | 'identifier'
    | 'string'
    | 'number'
    | 'comment'
    | 'operator'
    | 'delimiter'
    | 'whitespace'
    | 'invalid';

export const PIPELINE_KEYWORDS = [
    'FROM', 'AS', 'JOIN', 'LEFTJOIN', 'CROSSJOIN', 'ON', 'WHERE', 'GROUPBY', 'HAVING',
    'SELECT', 'DISTINCT', 'ORDERBY', 'ASC', 'DESC', 'LIMIT', 'OFFSET'
] as const;

export const DML_KEYWORDS = ['INSERT', 'VALUES', 'DELETE', 'UPDATE', 'SET'] as const;

export const OPERATOR_KEYWORDS = ['AND', 'OR', 'NOT', 'IN', 'LIKE', 'CAST', 'is', 'isnot'] as const;

export const CONTROL_KEYWORDS = [
    'let', 'fn', 'if', 'if!', 'else', 'switch', 'loop', 'from', 'to', 'by', 'in', 'where', 'break', 'continue', '_'
] as const;

export const TYPE_KEYWORDS = [
    'TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'UUID', 'JSON',
    'array', 'object', 'string', 'number', 'boolean'
] as const;

export const CONSTANT_KEYWORDS = ['true', 'false', 'null', 'NULL'] as const;

/** Reserved names called without `&` (`minab-builtins.ts`). Not grammar keywords — plain identifiers the checker knows. */
export const BUILTINS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'EXISTS', 'ALL', 'ANY'] as const;

const WORD_TYPES = new Map<string, TokenType>();
for (const k of PIPELINE_KEYWORDS) WORD_TYPES.set(k, 'keyword.pipeline');
for (const k of DML_KEYWORDS) WORD_TYPES.set(k, 'keyword.dml');
for (const k of OPERATOR_KEYWORDS) WORD_TYPES.set(k, 'keyword.operator');
for (const k of CONTROL_KEYWORDS) WORD_TYPES.set(k, 'keyword.control');
for (const k of TYPE_KEYWORDS) WORD_TYPES.set(k, 'type');
for (const k of CONSTANT_KEYWORDS) WORD_TYPES.set(k, 'constant');
for (const k of BUILTINS) WORD_TYPES.set(k, 'builtin');
WORD_TYPES.set('KEY', 'sigil.key');

/** Every alphabetic keyword the tokenizer knows (for the drift test and completion fallbacks). */
export const ALL_WORD_KEYWORDS: readonly string[] = [
    ...PIPELINE_KEYWORDS, ...DML_KEYWORDS, ...OPERATOR_KEYWORDS, ...CONTROL_KEYWORDS,
    ...TYPE_KEYWORDS, ...CONSTANT_KEYWORDS, 'KEY'
];

export interface Token {
    type: TokenType;
    /** Offset within the line. */
    start: number;
    text: string;
}

/** Tokenizer state carried from one line to the next: only an open block comment spans lines. */
export interface LineState {
    inBlockComment: boolean;
}

export const INITIAL_STATE: LineState = { inBlockComment: false };

const OPERATORS = [
    '==', '!=', '<=', '>=', '=>', '+:', '-:', '*:', '/:', ':|', '+=', '-=', '*=', '/=', '?=', '|=',
    '<', '>', '=', '+', '-', '*', '/', '%', '!', '?', ':', '|'
];

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /[0-9]+(\.[0-9]+)?/y;

/** Whether a `.` here starts a new current-record reference (`.status`) rather than continuing a member chain (`x.status`). */
function dotStartsRecord(previous: Token | undefined): boolean {
    if (!previous) return true;
    if (previous.type === 'identifier' || previous.type === 'member' || previous.type === 'sigil.key'
        || previous.type === 'sigil.alias' || previous.type === 'sigil.parent' || previous.type === 'sigil.field'
        || previous.type === 'sigil.record' || previous.type === 'string' || previous.type === 'number'
        || previous.type === 'sigil.index') {
        return false;
    }
    if (previous.type === 'delimiter' && (previous.text === ')' || previous.text === ']')) return false;
    return true;
}

/** Tokenizes one line. Whitespace is emitted as tokens too, so the tokens concatenate back to the line. */
export function tokenizeLine(line: string, state: LineState): { tokens: Token[]; state: LineState } {
    const tokens: Token[] = [];
    let i = 0;
    let inBlockComment = state.inBlockComment;
    let lastSignificant: Token | undefined;
    const push = (type: TokenType, start: number, end: number) => {
        const token = { type, start, text: line.slice(start, end) };
        tokens.push(token);
        if (type !== 'whitespace' && type !== 'comment') lastSignificant = token;
    };

    while (i < line.length) {
        if (inBlockComment) {
            const close = line.indexOf('*/', i);
            const end = close === -1 ? line.length : close + 2;
            push('comment', i, end);
            inBlockComment = close === -1;
            i = end;
            continue;
        }
        const ch = line[i];
        if (ch === ' ' || ch === '\t' || ch === '\r') {
            let j = i + 1;
            while (j < line.length && (line[j] === ' ' || line[j] === '\t' || line[j] === '\r')) j++;
            push('whitespace', i, j);
            i = j;
            continue;
        }
        if (line.startsWith('//', i)) {
            push('comment', i, line.length);
            break;
        }
        if (line.startsWith('/*', i)) {
            const close = line.indexOf('*/', i + 2);
            const end = close === -1 ? line.length : close + 2;
            push('comment', i, end);
            inBlockComment = close === -1;
            i = end;
            continue;
        }
        if (ch === '"' || ch === "'") {
            let j = i + 1;
            while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
            const end = Math.min(j + 1, line.length);
            push('string', i, end);
            i = end;
            continue;
        }
        if (line.startsWith('.$index', i)) {
            push('sigil.index', i, i + 7);
            i += 7;
            continue;
        }
        if (ch === '#' || ch === '&') {
            IDENT.lastIndex = i + 1;
            const m = IDENT.exec(line);
            const end = m ? i + 1 + m[0].length : i + 1;
            push(ch === '#' ? 'sigil.alias' : 'sigil.call', i, end);
            i = end;
            continue;
        }
        if (ch === '$') {
            push('sigil.field', i, i + 1);
            i++;
            continue;
        }
        if (ch === '^') {
            push('sigil.parent', i, i + 1);
            i++;
            continue;
        }
        if (ch === '.') {
            if (dotStartsRecord(lastSignificant)) {
                // `.status` is one reference: the current record's column.
                IDENT.lastIndex = i + 1;
                const m = IDENT.exec(line);
                const end = m ? i + 1 + m[0].length : i + 1;
                push('sigil.record', i, end);
                i = end;
            } else {
                push('delimiter', i, i + 1);
                i++;
                IDENT.lastIndex = i;
                const m = IDENT.exec(line);
                if (m) {
                    push('member', i, i + m[0].length);
                    i += m[0].length;
                }
            }
            continue;
        }
        if (ch >= '0' && ch <= '9') {
            NUMBER.lastIndex = i;
            const m = NUMBER.exec(line)!;
            push('number', i, i + m[0].length);
            i += m[0].length;
            continue;
        }
        IDENT.lastIndex = i;
        const word = IDENT.exec(line);
        if (word) {
            let text = word[0];
            let end = i + text.length;
            if (text === 'if' && line[end] === '!') {
                text = 'if!';
                end++;
            }
            push(WORD_TYPES.get(text) ?? 'identifier', i, end);
            i = end;
            continue;
        }
        if ('(){}[],;'.includes(ch)) {
            push('delimiter', i, i + 1);
            i++;
            continue;
        }
        const op = OPERATORS.find(o => line.startsWith(o, i));
        if (op) {
            push('operator', i, i + op.length);
            i += op.length;
            continue;
        }
        push('invalid', i, i + 1);
        i++;
    }
    return { tokens, state: { inBlockComment } };
}

/** Tokenizes a whole program, line by line. */
export function tokenize(source: string): Token[][] {
    let state = INITIAL_STATE;
    return source.split('\n').map(line => {
        const result = tokenizeLine(line, state);
        state = result.state;
        return result.tokens;
    });
}
