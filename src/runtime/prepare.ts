/**
 * `prepare`: parse and check one program, and keep what `run` and `compile`
 * need. Each call uses its own document URI and removes the document when
 * done (ADR 0002, section 10), so calls can overlap and a long-running
 * server does not grow. The prepared program holds the AST, the interpreter
 * and the compiler, and nothing of the workspace.
 */

import { URI, type LangiumDocument } from 'langium';
import type { Diagnostic } from 'vscode-languageserver-types';
import { coded } from '../language/diagnostics/codes.js';
import { isQuery, type Model } from '../language/generated/ast.js';
import type { Row, SqlQuery } from '../language/minab-executor.js';
import type { MinabInterpreter } from '../language/minab-interpreter.js';
import type { MinabSqlCompiler } from '../language/minab-sql-compiler.js';
import { formatType, type MinabType } from '../language/minab-types.js';
import { analyzeProgram, conservativeAnalysis, dependsOnField } from './analyze.js';
import { PortError, REFUSING_WRITE_PORT, SYSTEM_CLOCK, type DataPort, type EventSink } from './ports.js';
import { classifyProgram, type ProgramKind } from './program-kind.js';
import type { ServiceSet } from './service-cache.js';
import type {
    CompileResult,
    ExpectedType,
    MinabDiagnostic,
    MinabError,
    MinabSeverity,
    PreparedProgram,
    ProgramAnalysis,
    RunInputs,
    RunOptions,
    RunPorts,
    RunResult,
    SourceRange
} from './types.js';

const SEVERITIES: Record<number, MinabSeverity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };

const EMPTY_RANGE: SourceRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

function toDiagnostic(d: Diagnostic): MinabDiagnostic {
    const data = d.data as { params?: Record<string, string | number> } | undefined;
    return {
        severity: SEVERITIES[d.severity ?? 1] ?? 'error',
        code: typeof d.code === 'string' ? d.code : 'unknown',
        message: typeof d.message === 'string' ? d.message : String(d.message),
        range: d.range,
        params: data?.params ?? {}
    };
}

/** Does the type of the answer fit what the host expects? Null-ability does not matter here. */
export function fitsExpected(type: MinabType, expected: ExpectedType): boolean {
    if (typeof expected === 'object') return formatType(type).replaceAll('?', '') === expected.minab.replaceAll('?', '');
    if (expected === 'list') return type.kind === 'collection' || (type.kind === 'scalar' && type.array);
    if (type.kind !== 'scalar' || type.array) return false;
    switch (expected) {
        case 'text':
            return type.base === 'TEXT' || type.base === 'CITEXT';
        case 'number':
            return type.base === 'INTEGER' || type.base === 'DECIMAL';
        case 'boolean':
            return type.base === 'BOOLEAN';
        case 'date':
            return type.base === 'DATE';
        case 'dateTime':
            return type.base === 'DATETIME';
    }
}

function expectedText(expected: ExpectedType): string {
    return typeof expected === 'object' ? expected.minab : expected;
}

function error(code: string, message: string, params: MinabError['params'] = {}): MinabError {
    return { code, message, params };
}

/** Thrown by the stand-in data port when a program needs data and the host gave none. */
class NoDataPort extends Error {}

const NO_DATA_PORT: DataPort = {
    execute(_query: SqlQuery): Promise<Row[]> {
        return Promise.reject(new NoDataPort('this program needs data, and no data port was given'));
    }
};

class Prepared implements PreparedProgram {
    constructor(
        readonly diagnostics: readonly MinabDiagnostic[],
        readonly kind: ProgramKind,
        readonly resultType: string | undefined,
        readonly analysis: ProgramAnalysis,
        private readonly model: Model,
        private readonly interpreter: MinabInterpreter,
        private readonly compiler: MinabSqlCompiler,
        private readonly recordTable: string | undefined
    ) {}

    dependsOn(field: string): boolean {
        return dependsOnField(this.analysis, field);
    }

    get ok(): boolean {
        return !this.diagnostics.some(d => d.severity === 'error');
    }

    compile(): CompileResult {
        if (!this.ok) return { ok: false, error: error('compile.programHasErrors', 'the program has errors, so it cannot be compiled') };
        const tail = this.model.tail;
        if (!tail) return { ok: false, error: error('compile.nothingToCompile', 'nothing to compile: the program has no query or expression') };
        const compiled = isQuery(tail) ? this.compiler.compileQuery(tail) : this.compiler.compileValue(tail);
        if (compiled.ok) return compiled;
        const code = compiled.code ?? 'compile.notSql';
        return { ok: false, error: error(code, `this program does not compile to SQL on its own: ${compiled.reason}`, { reason: compiled.reason }) };
    }

    async run(inputs: RunInputs = {}, ports: RunPorts = {}, options: RunOptions = {}): Promise<RunResult> {
        if (!this.ok) return { ok: false, error: error('eval.programInvalid', 'the program has errors, so it cannot run') };
        const events = safeSink(ports.events);
        // Read once: every read of the time in this run sees the same instant (D21).
        const clock = ports.clock ?? SYSTEM_CLOCK;
        const started = performance.now();
        try {
            const result = await this.interpreter.evaluate(this.model, {
                executor: ports.data ?? NO_DATA_PORT,
                write: ports.write ?? REFUSING_WRITE_PORT,
                hostInputs: inputs.hostInputs as Record<string, unknown> | undefined,
                hostFunctions: ports.hostFunctions,
                now: clock.now(),
                timeZone: clock.timeZone,
                events,
                signal: options.signal,
                record: inputs.record,
                recordTable: this.recordTable,
                fieldValue: inputs.fieldValue
            });
            if (result.ok) return result;
            return { ok: false, error: error(result.code ?? 'eval.failed', result.reason, { ...result.params, reason: result.reason }) };
        } catch (e) {
            if (e instanceof NoDataPort) return { ok: false, error: error('data.noPort', e.message) };
            if (e instanceof PortError) return { ok: false, error: error(e.code, e.message) };
            throw e;
        } finally {
            events?.emit({ kind: 'timing', phase: 'run', durationMs: performance.now() - started });
        }
    }
}

/** A sink that must not throw: if the host's sink throws, the runtime drops the error (ADR 0002, 4.5). */
function safeSink(sink: EventSink | undefined): EventSink | undefined {
    if (!sink) return undefined;
    return {
        emit(event) {
            try {
                sink.emit(event);
            } catch {
                // dropped on purpose
            }
        }
    };
}

export async function prepareProgram(
    set: ServiceSet,
    uri: string,
    source: string,
    expect: ExpectedType | undefined,
    recordTable: string | undefined,
    localHostFunctions: ReadonlySet<string> | undefined
): Promise<PreparedProgram> {
    const { shared, services } = set;
    const documents = shared.workspace.LangiumDocuments;
    const parsedUri = URI.parse(uri);
    let document: LangiumDocument<Model>;
    try {
        document = shared.workspace.LangiumDocumentFactory.fromString<Model>(source, parsedUri);
        documents.addDocument(document);
        // Like the CLI: a program with syntax errors gets those errors only. Type errors over a
        // half-recovered tree mostly echo the typo.
        await shared.workspace.DocumentBuilder.build([document], {
            validation: { stopAfterLexingErrors: true, stopAfterParsingErrors: true }
        });
    } finally {
        if (documents.hasDocument(parsedUri)) documents.deleteDocument(parsedUri);
    }

    const diagnostics = (document.diagnostics ?? []).map(toDiagnostic);
    const model = document.parseResult.value;
    const classified = classifyProgram(model, services);
    const hasErrors = diagnostics.some(d => d.severity === 'error');
    if (expect !== undefined && !hasErrors && classified.type && !fitsExpected(classified.type, expect)) {
        const message = coded('type.unexpectedResultType', { expected: expectedText(expect), actual: classified.resultType! });
        diagnostics.push({
            severity: 'error',
            code: message.code,
            message: message.reason,
            range: model.tail?.$cstNode?.range ?? EMPTY_RANGE,
            params: message.params
        });
    }
    // A half-parsed tree can miss parts, so a syntax error gets the safe answer. A type error leaves
    // the tree whole (an undeclared host function is one until R3), so it is analyzed as usual.
    const { lexerErrors, parserErrors } = document.parseResult;
    const analysis =
        lexerErrors.length > 0 || parserErrors.length > 0
            ? conservativeAnalysis()
            : analyzeProgram(model, services.schema, recordTable, { localHostFunctions });
    return new Prepared(diagnostics, classified.kind, classified.resultType, analysis, model, services.interpreter, services.sqlCompiler, recordTable);
}
