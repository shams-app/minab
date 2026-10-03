/**
 * Structured run errors (ADR 0002, section 5; decision D35).
 *
 * A failed run or compile gives `{ code, message, range?, params }`. The code is
 * in the registry (`src/language/diagnostics/codes.ts`). The message is English.
 * A host maps the error by its code and never parses the text.
 *
 * The SQL text is never part of an error. A host can read it from the
 * `statement` event and log it if it wants to.
 */

import { coded, type DiagnosticCode, type ParamsArgs } from '../language/diagnostics/codes.js';
import type { MinabError, SourceRange } from './types.js';

/** An error with a code from the registry. Its message and params come from there. */
export function runError<C extends DiagnosticCode>(code: C, range: SourceRange | undefined, ...args: ParamsArgs<C>): MinabError {
    const message = coded(code, ...args);
    const error: MinabError = { code: message.code, message: message.reason, params: message.params as MinabError['params'] };
    if (range) error.range = range;
    return error;
}

/** The SQLSTATE of a driver error (five characters), when it has one. `pg` and PGlite put it in `code`. */
export function sqlstateOf(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/** A data port failure, as a code, a message and params. Both runtimes report the same code for the same cause. */
export function dataFailure(error: unknown): { code: DiagnosticCode; message: string; params: Record<string, string | number> } {
    const sqlstate = sqlstateOf(error);
    switch (sqlstate) {
        case '22012':
            return { code: 'eval.divisionByZero', message: coded('eval.divisionByZero').reason, params: { sqlstate } };
        case '22P02':
        case '22003':
            // The database does not say which value or which types, so the message stays general.
            return { code: 'eval.castFailed', message: `the database could not convert a value (SQLSTATE ${sqlstate})`, params: { sqlstate } };
        default:
            return { code: 'data.error', message: coded('data.error').reason, params: sqlstate ? { sqlstate } : {} };
    }
}
