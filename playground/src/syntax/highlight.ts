/**
 * Static highlighting for code that isn't in an editor: landing-page
 * snippets, gallery cards, lessons, the cheat sheet, the SQL and trace
 * views. Minab uses the editor's own tokenizer; SQL gets a small one of
 * its own, colored with the same `--syntax-*` tokens so the two read as
 * one system.
 */

import { tokenize, type TokenType } from './tokens.js';

export interface Span {
    text: string;
    type: TokenType;
}

export function highlightMinab(source: string): Span[][] {
    return tokenize(source).map(line => line.map(t => ({ text: t.text, type: t.type })));
}

const SQL_KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'AS', 'AND', 'OR', 'NOT', 'EXISTS', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT',
    'OFFSET', 'IS', 'DISTINCT', 'JOIN', 'LEFT', 'CROSS', 'INNER', 'ON', 'IN', 'LIKE', 'ASC', 'DESC', 'CASE',
    'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
    'TABLE', 'PRIMARY', 'KEY', 'EXTENSION', 'IF', 'ARRAY', 'WITH', 'UNION', 'ALL'
]);
const SQL_CONSTANTS = new Set(['NULL', 'TRUE', 'FALSE']);
const SQL_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'BOOL_AND', 'BOOL_OR', 'LOWER', 'UPPER']);

export function highlightSql(source: string): Span[][] {
    return source.split('\n').map(line => {
        const spans: Span[] = [];
        let i = 0;
        const push = (type: TokenType, end: number) => {
            spans.push({ type, text: line.slice(i, end) });
            i = end;
        };
        while (i < line.length) {
            const rest = line.slice(i);
            let m: RegExpExecArray | null;
            if (rest.startsWith('--')) push('comment', line.length);
            else if ((m = /^\s+/.exec(rest))) push('whitespace', i + m[0].length);
            else if ((m = /^'(?:[^']|'')*'?/.exec(rest))) push('string', i + m[0].length);
            else if ((m = /^"(?:[^"]|"")*"?/.exec(rest))) push('member', i + m[0].length);
            else if ((m = /^\$\d+/.exec(rest))) push('sigil.field', i + m[0].length);
            else if ((m = /^\d+(\.\d+)?/.exec(rest))) push('number', i + m[0].length);
            else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
                const word = m[0].toUpperCase();
                push(SQL_CONSTANTS.has(word) ? 'constant' : SQL_FUNCTIONS.has(word) ? 'builtin' : SQL_KEYWORDS.has(word) ? 'keyword.pipeline' : 'identifier', i + m[0].length);
            } else if ((m = /^(<>|!=|<=|>=|::|[=<>+\-*/%])/.exec(rest))) push('operator', i + m[0].length);
            else push('delimiter', i + 1);
        }
        return spans;
    });
}

const CLAUSES = /^(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|LEFT JOIN|CROSS JOIN|JOIN)\b/i;

/**
 * Line-breaks compiled SQL at its top-level clauses, for reading. The
 * compiler emits one line (it's what gets executed); this only inserts
 * newlines outside parentheses and string literals, so it never changes
 * what the statement means.
 */
export function prettySql(sql: string): string {
    const [statement, ...comments] = sql.split('\n-- ');
    let out = '';
    let depth = 0;
    let quote: string | undefined;
    for (let i = 0; i < statement.length; i++) {
        const ch = statement[i];
        if (quote) {
            out += ch;
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            out += ch;
            continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth === 0 && ch === ' ' && CLAUSES.test(statement.slice(i + 1))) {
            out += '\n';
            continue;
        }
        out += ch;
    }
    return [out, ...comments.map(c => `-- ${c}`)].join('\n');
}
