/**
 * The error a Nest host throws or catches, and the HTTP status of each Minab code (phase H2).
 *
 * Status table (the filter uses it):
 *
 * | Code | Status |
 * |---|---|
 * | `wire.programNotFound` | 404 |
 * | other `wire.*` | 400 |
 * | `cancelled` | 499 (the client closed the request) |
 * | `data.*` | 500, without the driver message |
 * | a check failure (`syntax`, `scope`, `type`, ... `eval`, `compile`) | 422 |
 * | `limit.*` | 422 |
 * | anything else | 500, without detail |
 */

import type { MinabDiagnostic, MinabError } from '../runtime/types.js';
import { runError } from '../runtime/errors.js';

const UNPROCESSABLE = new Set(['syntax', 'scope', 'type', 'null', 'call', 'compile', 'eval', 'limit', 'query', 'rule']);

/** The HTTP status for a Minab error code. An unknown code gives 500. */
export function minabHttpStatus(code: string): number {
    if (code === 'cancelled') return 499;
    if (code === 'wire.programNotFound') return 404;
    if (code === 'wire.workerFailed') return 500;
    const area = code.split('.')[0];
    if (area === 'wire') return 400;
    if (area === 'data') return 500;
    return UNPROCESSABLE.has(area) ? 422 : 500;
}

/** A failure of a program or a request, as a coded error. The filter turns it into an HTTP answer. */
export class MinabException extends Error {
    constructor(
        readonly error: MinabError,
        /** The check diagnostics, when the program has errors. */
        readonly diagnostics?: readonly MinabDiagnostic[]
    ) {
        super(error.message);
        this.name = 'MinabException';
    }

    /** The HTTP status for this error. */
    get status(): number {
        return minabHttpStatus(this.error.code);
    }

    /** The program has errors: `eval.programInvalid` with the diagnostics. */
    static invalidProgram(diagnostics: readonly MinabDiagnostic[]): MinabException {
        return new MinabException(runError('eval.programInvalid', undefined), diagnostics);
    }

    /** An error for a program id and version that the store does not have (HTTP 404). */
    static programNotFound(id: string, version: string): MinabException {
        return new MinabException(runError('wire.programNotFound', undefined, { id, version }));
    }
}
