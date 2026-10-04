/**
 * The run endpoint (phase H2): `POST <path>` with a wire format v1 request (`src/runtime/wire.ts`).
 *
 * - It runs **stored programs** (`program.ref`). `program.source` is refused unless `endpoint.allowSource` is
 *   true, for development (D34).
 * - It uses the server's own schema, ports and host inputs. Nothing of that comes from the client.
 * - A request with more runs than the `batchRuns` limit is refused (`wire.tooManyRuns`, D36).
 * - A valid request is 200, even when some runs fail: each result has its own `ok` and `error`.
 *   A request that fails as a whole is answered by the filter (400).
 */

import { Body, Controller, Headers, HttpCode, Inject, Post, Req, UseFilters, UseGuards, type Type } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { decodeInputs, encodeBy, resultWireType } from '../browser/protocol.js';
import { runError } from '../runtime/errors.js';
import { resolveLimits } from '../runtime/limits.js';
import type { MinabError, RunInputs, RunPorts } from '../runtime/types.js';
import { WireError, parseRequest, type Json, type WireResponse, type WireResult, type WireRun } from '../runtime/wire.js';
import { MinabException } from './exception.js';
import { MinabExceptionFilter } from './filter.js';
import { logsEnabled, oneLine } from './logger.js';
import { MINAB_OPTIONS, type MinabContext, type MinabEndpointOptions, type MinabModuleOptions } from './options.js';
import { MinabService, type LoadedProgram } from './service.js';

/** The id the client sent, cleaned, or a new one. It goes into logs, so it is short and on one line. */
function requestIdOf(header: string | string[] | undefined): string {
    const value = Array.isArray(header) ? header[0] : header;
    return value && value.trim() !== '' ? oneLine(value.trim().slice(0, 100)) : randomUUID();
}

export class MinabRunController {
    constructor(
        @Inject(MinabService) private readonly service: MinabService,
        @Inject(MINAB_OPTIONS) private readonly options: MinabModuleOptions
    ) {}

    @Post()
    @HttpCode(200)
    async run(@Body() body: unknown, @Req() request: unknown, @Headers('x-request-id') requestIdHeader?: string | string[]): Promise<WireResponse> {
        const endpoint = this.options.endpoint ?? {};
        const limits = resolveLimits(this.options.limits);
        const parsed = parseRequest(body, { maxRuns: limits.batchRuns, allowSource: endpoint.allowSource === true });
        if (!parsed.ok) throw new MinabException(parsed.error);

        const context: MinabContext = { request, requestId: requestIdOf(requestIdHeader) };
        const ports: RunPorts = (await endpoint.ports?.(context)) ?? {};
        const serverInputs = (await endpoint.hostInputs?.(context)) ?? {};
        const results = await Promise.all(parsed.value.runs.map(run => this.runOne(run, context, ports, serverInputs)));
        return { v: 1, results };
    }

    private async runOne(run: WireRun, context: MinabContext, ports: RunPorts, serverInputs: Record<string, unknown>): Promise<WireResult> {
        const failed = (error: MinabError): WireResult => ({ id: run.id, ok: false, error });
        try {
            let loaded: LoadedProgram;
            let programId: string | undefined;
            if ('ref' in run.program) {
                programId = run.program.ref.id;
                loaded = await this.service.loadStored(programId, run.program.ref.version, { context });
            } else {
                loaded = await this.service.loadSource(run.program.source, { context });
                if (!loaded.prepared.ok) throw MinabException.invalidProgram(loaded.prepared.diagnostics);
            }
            const decoded: RunInputs = decodeInputs(
                { record: run.record, fieldValue: run.fieldValue, hostInputs: run.inputs },
                { schema: loaded.schema, inputs: this.options.inputs, ruleContext: loaded.ruleContext }
            );
            // The server's own values win over the client's (the current user, the tenant).
            decoded.hostInputs = { ...decoded.hostInputs, ...serverInputs };
            const result = await this.service.run(loaded.prepared, decoded, ports, {
                programId,
                requestId: context.requestId,
                limits: run.options?.limits
            });
            if (!result.ok) return failed(result.error);
            const value: Json = encodeBy(result.value, resultWireType(loaded.prepared.resultType));
            const answer: WireResult = { id: run.id, ok: true, value, stats: result.stats };
            // Logs go to the client only when the host allows logs and the run asks for them (D37).
            if (run.options?.logs === true) answer.logs = logsEnabled(this.options.logs) ? result.logs : [];
            return answer;
        } catch (error) {
            if (error instanceof MinabException) return failed(error.error);
            if (error instanceof WireError) return failed(error.error);
            // A bug or a host failure: the answer says only that, never the message (it may hold private data).
            return failed(runError('eval.failed', undefined, { reason: 'internal error' }));
        }
    }
}

/** A controller class on `path`, with the filter and the host's guards. One class for each module, so two modules can have two paths. */
export function createRunController(path: string, guards: MinabEndpointOptions['guards']): Type<MinabRunController> {
    class Mounted extends MinabRunController {}
    Controller(path)(Mounted);
    UseFilters(MinabExceptionFilter)(Mounted);
    if (guards && guards.length > 0) UseGuards(...guards)(Mounted);
    return Mounted;
}
