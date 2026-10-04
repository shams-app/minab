/**
 * Turns a `MinabException` (or a `WireError`) into an HTTP answer (phase H2).
 * The body is `{ v: 1, error: { code, message, range?, params } }`, with `diagnostics` for a program with errors.
 * A server failure (status 500) never shows a driver message, SQL or a stack: only the code (and the SQLSTATE of a data error).
 */

import { Catch, Inject, Optional, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { MinabError } from '../runtime/types.js';
import { WireError } from '../runtime/wire.js';
import { MinabException, minabHttpStatus } from './exception.js';

/** What a 500 may say about an error. */
function safeError(error: MinabError): MinabError {
    if (error.code.startsWith('data.')) {
        return {
            code: error.code,
            message: 'the data source failed',
            params: typeof error.params.sqlstate === 'string' ? { sqlstate: error.params.sqlstate } : {}
        };
    }
    return { code: error.code, message: 'internal error', params: {} };
}

export function minabErrorBody(exception: MinabException | WireError): { status: number; body: Record<string, unknown> } {
    const error = exception.error;
    const status = minabHttpStatus(error.code);
    const diagnostics = exception instanceof MinabException ? exception.diagnostics : undefined;
    const shown = status >= 500 ? safeError(error) : error;
    return { status, body: { v: 1, error: shown, ...(diagnostics ? { diagnostics } : {}) } };
}

@Catch(MinabException, WireError)
export class MinabExceptionFilter implements ExceptionFilter {
    constructor(@Optional() @Inject(HttpAdapterHost) private readonly adapterHost?: HttpAdapterHost) {}

    catch(exception: MinabException | WireError, host: ArgumentsHost): void {
        const { status, body } = minabErrorBody(exception);
        const adapter = this.adapterHost?.httpAdapter;
        if (!adapter) throw exception;
        adapter.reply(host.switchToHttp().getResponse(), body, status);
    }
}
