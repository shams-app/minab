/**
 * Readable diagnostics for the CLI (roadmap Phase 6).
 *
 * Phase 6's task list asks for exactly one thing here: "parse errors,
 * validation errors, and type errors should all produce readable CLI
 * output, not stack traces." All three already arrive in the same place —
 * Langium's `DocumentValidator` turns lexer and parser errors into
 * `Diagnostic`s alongside the ones `MinabValidator` raises — so this
 * module has one job: render a `Diagnostic` against the source text with
 * a line and a caret under the offending span.
 */

import type { Diagnostic } from 'vscode-languageserver-types';
import type { MinabDiagnostic } from '../runtime/index.js';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

const SEVERITIES: Record<number, Severity> = {
    1: 'error',
    2: 'warning',
    3: 'info',
    4: 'hint'
};

/**
 * A runtime diagnostic in the shape the CLI prints and `check --json` has always
 * printed: a numeric severity (1 error to 4 hint), the stable `code`, and `data.params`.
 */
const SEVERITY_NUMBERS = { error: 1, warning: 2, info: 3, hint: 4 } as const;

export function toCliDiagnostic(diagnostic: MinabDiagnostic): Diagnostic {
    return {
        severity: SEVERITY_NUMBERS[diagnostic.severity],
        range: diagnostic.range,
        message: diagnostic.message,
        data: { params: diagnostic.params },
        source: 'minab',
        code: diagnostic.code
    };
}

export function severityOf(diagnostic: Diagnostic): Severity {
    return SEVERITIES[diagnostic.severity ?? 1] ?? 'error';
}

export function isError(diagnostic: Diagnostic): boolean {
    return severityOf(diagnostic) === 'error';
}

/**
 * A `Diagnostic`'s message is typed `string | MarkupContent`, and the
 * difference is invisible until something prints `[object Object]` at a
 * user. Unwrapped in one place rather than cast at each call site.
 */
export function messageText(diagnostic: Diagnostic): string {
    const message = diagnostic.message as string | { value: string };
    return typeof message === 'string' ? message : message.value;
}

/**
 * ```
 * rule.minab:3:14: error: cannot compare INTEGER with TEXT
 *   3 |     .total == "large"
 *     |     ^^^^^^^^^^^^^^^^^
 * ```
 * The span is clamped to the first line of the range: a diagnostic over a
 * whole query would otherwise underline the rest of the file.
 */
export function formatDiagnostic(diagnostic: Diagnostic, source: string, fileLabel: string): string {
    const lines = source.split(/\r?\n/);
    const { start, end } = diagnostic.range;
    const lineText = lines[start.line] ?? '';
    const lineNumber = start.line + 1;
    const column = start.character + 1;
    // Chevrotain's "expecting one of these token sequences" message is
    // two dozen lines long. Its first line belongs in the header, where
    // the position is; the rest reads better under the caret than wedged
    // between the position and the source line.
    const [firstLine, ...restLines] = messageText(diagnostic).split('\n');
    const head = `${fileLabel}:${lineNumber}:${column}: ${severityOf(diagnostic)}: ${firstLine}`;

    const endColumn = end.line === start.line ? end.character : lineText.length;
    const width = Math.max(1, endColumn - start.character);
    const gutter = String(lineNumber);
    const pad = ' '.repeat(gutter.length);
    // Tabs would push the caret out of alignment; keep them as-is in the
    // source line and mirror them in the indent so the two still line up.
    const indent = [...lineText.slice(0, start.character)].map(c => (c === '\t' ? '\t' : ' ')).join('');

    return [head, `${gutter} | ${lineText}`, `${pad} | ${indent}${'^'.repeat(width)}`, ...restLines.map(line => `${pad} | ${line}`)].join('\n');
}

/** "2 errors, 1 warning" — plural-correct, and silent when there's nothing to count. */
export function summarize(diagnostics: Diagnostic[]): string {
    const counts = new Map<Severity, number>();
    for (const diagnostic of diagnostics) {
        const severity = severityOf(diagnostic);
        counts.set(severity, (counts.get(severity) ?? 0) + 1);
    }
    const parts: string[] = [];
    for (const severity of ['error', 'warning', 'info', 'hint'] as Severity[]) {
        const count = counts.get(severity);
        if (count) parts.push(`${count} ${severity}${count === 1 ? '' : 's'}`);
    }
    return parts.join(', ');
}
