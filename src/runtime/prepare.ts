/**
 * `prepare`: parse and check one program, and keep what `run` and `compile`
 * need. Each call uses its own document URI and removes the document when
 * done (ADR 0002, section 10), so calls can overlap and a long-running
 * server does not grow. The prepared program holds the AST, the interpreter
 * and the compiler, and nothing of the workspace.
 */

import { AstUtils, URI, type AstNode, type LangiumDocument } from 'langium';
import type { Diagnostic } from 'vscode-languageserver-types';
import { coded } from '../language/diagnostics/codes.js';
import { isExpression, isQuery, type Model } from '../language/generated/ast.js';
import type { Row, SqlQuery } from '../language/minab-executor.js';
import type { MinabInterpreter } from '../language/minab-interpreter.js';
import type { MinabSqlCompiler } from '../language/minab-sql-compiler.js';
import { formatType, type MinabType } from '../language/minab-types.js';
import { analyzeProgram, conservativeAnalysis, dependsOnField } from './analyze.js';
import { runError } from './errors.js';
import { RunBudget, tightenLimits, type Limits } from './limits.js';
import { PortError, REFUSING_WRITE_PORT, SYSTEM_CLOCK, type DataPort, type EventSink } from './ports.js';
import { classifyProgram, type ProgramKind } from './program-kind.js';
import type { ServiceSet } from './service-cache.js';
import type {
    CompileResult,
    ExpectedType,
    MinabDiagnostic,
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

/** The stand-in data port when a program needs data and the host gave none. */
const NO_DATA_PORT: DataPort = {
    execute(_query: SqlQuery): Promise<Row[]> {
        return Promise.reject(new PortError('data.noPort', coded('data.noPort').reason));
    }
};

class Prepared implements PreparedProgram {
    constructor(
        readonly diagnostics: readonly MinabDiagnostic[],
        readonly kind: ProgramKind,
        readonly resultType: string | undefined,
        readonly analysis: ProgramAnalysis,
        /** Missing when a limit stopped `prepare` before the program was checked. Such a program has errors, so nothing uses it. */
        private readonly model: Model | undefined,
        private readonly interpreter: MinabInterpreter,
        private readonly compiler: MinabSqlCompiler,
        private readonly recordTable: string | undefined,
        private readonly hostLimits: Limits
    ) {}

    dependsOn(field: string): boolean {
        return dependsOnField(this.analysis, field);
    }

    get ok(): boolean {
        return !this.diagnostics.some(d => d.severity === 'error');
    }

    compile(): CompileResult {
        if (!this.ok) return { ok: false, error: runError('compile.programHasErrors', undefined) };
        const tail = this.model?.tail;
        if (!tail) return { ok: false, error: runError('compile.nothingToCompile', undefined) };
        const compiled = isQuery(tail) ? this.compiler.compileQuery(tail) : this.compiler.compileValue(tail);
        if (compiled.ok) return { ok: true, sql: compiled.query };
        const range = tail.$cstNode?.range;
        if (compiled.code === 'compile.notSql') return { ok: false, error: runError('compile.notSql', range, { reason: compiled.reason }) };
        return { ok: false, error: { code: compiled.code, message: compiled.reason, ...(range ? { range } : {}), params: compiled.params } };
    }

    async run(inputs: RunInputs = {}, ports: RunPorts = {}, options: RunOptions = {}): Promise<RunResult> {
        if (!this.ok || !this.model) return { ok: false, error: runError('eval.programInvalid', undefined) };
        // The limits of the run: never above the host's.
        const limits = tightenLimits(this.hostLimits, options.limits);
        // A signal that is already aborted ends the run before any port is called.
        if (options.signal?.aborted) return { ok: false, error: runError('cancelled', undefined) };
        const events = safeSink(ports.events);
        // Read once: every read of the time in this run sees the same instant (D21).
        const clock = ports.clock ?? SYSTEM_CLOCK;
        const started = performance.now();
        const budget = new RunBudget(limits, options.signal);
        try {
            const result = await this.interpreter.run(this.model, {
                executor: ports.data ?? NO_DATA_PORT,
                write: ports.write ?? REFUSING_WRITE_PORT,
                writeMode: options.writes,
                hostInputs: inputs.hostInputs as Record<string, unknown> | undefined,
                hostFunctions: ports.hostFunctions,
                now: clock.now(),
                timeZone: clock.timeZone,
                events,
                budget,
                record: inputs.record,
                recordTable: this.recordTable,
                fieldValue: inputs.fieldValue
            });
            const durationMs = performance.now() - started;
            if (result.ok) {
                const logs = { logs: budget.logs, ...(budget.logsTruncated ? { logsTruncated: true } : {}) };
                const writes = { mode: budget.writes.length > 0 ? (options.writes ?? null) : null, statements: budget.writes };
                return { ok: true, value: result.value, ...logs, writes, stats: { ...budgetStats(budget), durationMs } };
            }
            return { ok: false, error: result.error };
        } finally {
            budget.dispose();
            events?.emit({ kind: 'timing', phase: 'run', durationMs: performance.now() - started });
        }
    }
}

function budgetStats(budget: RunBudget): { statements: number; rows: number; writes: { statements: number; rows: number } } {
    return {
        statements: budget.counts.statements,
        rows: budget.counts.rows,
        writes: { statements: budget.writes.length, rows: budget.writeRows }
    };
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

/** Length in UTF-8 bytes, like the file on disk or the request body. */
function utf8Length(text: string): number {
    return new TextEncoder().encode(text).length;
}

/**
 * How deep `(`, `[` and `{` are nested in the source, found in one pass without a parser. Text in strings,
 * quoted names and comments does not count. A run of prefix operators (`-`, `+`, `NOT`) counts too: each
 * one nests the tree one level, and `-` repeated 5,000 times costs the parser as much as 5,000 brackets.
 * The parser takes more than linear time and stack on deep programs (a 64 KB source could use gigabytes),
 * so this check comes first.
 */
/** A source nested at least this deep is a suspect when the parser fails with a TypeError. Overflows were seen from about 80 levels. */
const STACK_SUSPECT_DEPTH = 40;

export function bracketDepth(source: string): number {
    let depth = 0;
    let deepest = 0;
    // Prefix operators in a row, and whether the last token ended an operand (then `-` is a binary minus).
    let prefixes = 0;
    let afterOperand = false;
    const note = () => {
        if (depth + prefixes > deepest) deepest = depth + prefixes;
    };
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '"' || c === "'" || c === '`') {
            prefixes = 0;
            afterOperand = true;
            for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++;
        } else if (c === '/' && source[i + 1] === '/') {
            while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
        } else if (c === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            i = end < 0 ? source.length : end + 1;
        } else if (c === '(' || c === '[' || c === '{') {
            prefixes = 0;
            afterOperand = false;
            depth++;
            note();
        } else if (c === ')' || c === ']' || c === '}') {
            prefixes = 0;
            afterOperand = true;
            if (depth > 0) depth--;
        } else if (c === '-' || c === '+') {
            if (afterOperand) {
                afterOperand = false;
                prefixes = 0;
            } else {
                prefixes++;
                note();
            }
        } else if (/\s/.test(c)) {
            continue;
        } else if (source.startsWith('NOT', i) && !/[\p{L}\p{N}_]/u.test(source[i + 3] ?? '') && !/[\p{L}\p{N}_]/u.test(source[i - 1] ?? '')) {
            prefixes++;
            afterOperand = false;
            note();
            i += 2;
        } else {
            prefixes = 0;
            afterOperand = !',;:=<>*/%&|!?^\\.'.includes(c);
        }
    }
    return deepest;
}

/**
 * The deepest nesting of expressions, and the deepest expression. It walks with its own stack, so a deep tree
 * cannot overflow the call stack here.
 */
function expressionDepth(root: AstNode): { depth: number; node: AstNode } {
    let deepest = { depth: 0, node: root };
    const stack: { node: AstNode; depth: number }[] = [{ node: root, depth: 0 }];
    while (stack.length > 0) {
        const { node, depth } = stack.pop()!;
        const here = isExpression(node) ? depth + 1 : depth;
        if (here > deepest.depth) deepest = { depth: here, node };
        for (const child of AstUtils.streamContents(node)) stack.push({ node: child, depth: here });
    }
    return deepest;
}

export async function prepareProgram(
    set: ServiceSet,
    uri: string,
    source: string,
    expect: ExpectedType | undefined,
    recordTable: string | undefined,
    localHostFunctions: ReadonlySet<string> | undefined,
    limits: Limits
): Promise<PreparedProgram> {
    const { shared, services } = set;
    // A limit of the program text stops the work before the parser sees it.
    const bytes = utf8Length(source);
    if (bytes > limits.sourceLength) {
        return stoppedAtPrepare(set, recordTable, limits, limitDiagnostic('limit.sourceTooLong', EMPTY_RANGE, { limit: limits.sourceLength, used: bytes }));
    }
    // Before the parser: deep nesting costs the parser a lot of time and memory.
    const brackets = bracketDepth(source);
    if (brackets > limits.nestingDepth) {
        return stoppedAtPrepare(set, recordTable, limits, limitDiagnostic('limit.tooDeep', EMPTY_RANGE, { limit: limits.nestingDepth, used: brackets }));
    }
    const documents = shared.workspace.LangiumDocuments;
    const parsedUri = URI.parse(uri);
    let document: LangiumDocument<Model>;
    try {
        try {
            document = shared.workspace.LangiumDocumentFactory.fromString<Model>(source, parsedUri);
        } catch (e) {
            // The parser ran out of stack on a deep program (some shapes fail at about 80 levels). The depth it
            // could not take counts as over the limit, and `used` is a lower bound.
            // An overflow at an unlucky place can also surface as a TypeError (a node was half built, seen on
            // Node 24 with a warm parser), so a TypeError on a deeply nested source counts as an overflow too.
            if (e instanceof RangeError || (e instanceof TypeError && brackets >= STACK_SUSPECT_DEPTH)) {
                return stoppedAtPrepare(
                    set,
                    recordTable,
                    limits,
                    limitDiagnostic('limit.tooDeep', EMPTY_RANGE, { limit: limits.nestingDepth, used: limits.nestingDepth + 1 })
                );
            }
            throw e;
        }
        // Before the checker, so a deep tree cannot overflow it.
        const nesting = expressionDepth(document.parseResult.value);
        if (nesting.depth > limits.nestingDepth) {
            const range = nesting.node.$cstNode?.range ?? EMPTY_RANGE;
            return stoppedAtPrepare(set, recordTable, limits, limitDiagnostic('limit.tooDeep', range, { limit: limits.nestingDepth, used: nesting.depth }));
        }
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
    return new Prepared(diagnostics, classified.kind, classified.resultType, analysis, model, services.interpreter, services.sqlCompiler, recordTable, limits);
}

function limitDiagnostic(code: 'limit.sourceTooLong' | 'limit.tooDeep', range: SourceRange, params: { limit: number; used: number }): MinabDiagnostic {
    const message = coded(code, params);
    return { severity: 'error', code, message: message.reason, range, params: message.params };
}

/** A program that a limit stopped at `prepare`: one error, no analysis. `run` and `compile` refuse it. */
function stoppedAtPrepare(set: ServiceSet, recordTable: string | undefined, limits: Limits, diagnostic: MinabDiagnostic): PreparedProgram {
    const { services } = set;
    return new Prepared([diagnostic], 'empty', undefined, conservativeAnalysis(), undefined, services.interpreter, services.sqlCompiler, recordTable, limits);
}
