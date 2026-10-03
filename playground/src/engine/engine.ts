/**
 * The Minab engine: check, compile and run a program against a host.
 *
 * This is the whole toolchain the CLI drives — Langium's parser, the
 * validator and type checker, the SQL compiler, and the hybrid interpreter
 * — pointed at an in-browser Postgres instead of a file system and a
 * connection string. It has no DOM and no React: `worker.ts` exposes it to
 * the UI thread, and the tests drive it directly in Node.
 *
 * Work goes through two queues. Everything Langium does (parsing, checking,
 * hovers, completion) runs on the language queue; everything that touches
 * Postgres runs on the database queue. A run does its analysis on the first
 * and its execution on the second, so the editor stays responsive while
 * Postgres boots or a query runs — and a rule that never reaches the
 * database never waits for it.
 */

import type { AstNode, LangiumDocument } from 'langium';
import { isQuery, type Model } from '../../../src/language/generated/ast.js';
import type { QueryExecutor, SqlQuery } from '../../../src/language/minab-executor.js';
import type { MinabRuleContext, MinabSchema } from '../../../src/language/schema.js';
import { ConfigError, parseConfig, type HostConfig } from '../../../src/host/config.js';
import { DataSourceError, FixtureExecutor } from '../../../src/host/fixture-executor.js';
import { formatSql } from '../../../src/host/format.js';
import { Database, type DatabaseContents, type DatabaseState } from './database.js';
import { databaseScript } from './ddl.js';
import { EditorIntel } from './intel.js';
import { LanguageHosts, type LanguageHost } from './language.js';
import { describeProgram, explainRefusal, rangeOf } from './program.js';
import type {
    AnalyzeReport,
    AstNodeView,
    CompiledSql,
    CompletionReport,
    EngineApi,
    EngineStatus,
    HostSettings,
    HoverInfo,
    ProgramKind,
    Range,
    Row,
    RunReport,
    RunResult,
    SqlConsoleResult,
    TablePreview,
    TraceEntry
} from './protocol.js';

const EMPTY_SCHEMA: MinabSchema = { tables: [] };
const DEFAULT_RULE: MinabRuleContext = { isFieldRule: false };
const EMPTY_CONTENTS: DatabaseContents = { schema: EMPTY_SCHEMA, seed: {}, script: '' };
const PREVIEW_ROWS = 5;

/** Everything one host means to the engine: its parsed config, its checker, and what its database holds. */
interface ActiveHost {
    settings: HostSettings;
    config?: HostConfig;
    configError?: string;
    language: LanguageHost;
    contents: DatabaseContents;
}

/** Runs one task at a time, in arrival order. */
class Queue {
    private tail: Promise<unknown> = Promise.resolve();

    run<T>(task: () => Promise<T>): Promise<T> {
        const next = this.tail.then(task, task);
        this.tail = next.catch(() => undefined);
        return next;
    }
}

function now(): number {
    return performance.now();
}

function seedOf(raw: Record<string, unknown>): Record<string, Row[]> {
    const seed = raw.seed;
    if (seed === undefined) return {};
    if (typeof seed !== 'object' || seed === null || Array.isArray(seed)) {
        throw new ConfigError('seed: expected an object mapping table names to arrays of rows');
    }
    for (const [table, rows] of Object.entries(seed)) {
        if (!Array.isArray(rows)) throw new ConfigError(`seed.${table}: expected an array of rows`);
    }
    return seed as Record<string, Row[]>;
}

/** Readable names for the constructs that live only in the interpreted layer. */
const INTERPRETED_ONLY: Record<string, string> = {
    SwitchExpr: '`switch`',
    IfExpr: '`if`',
    TypeTestExpression: 'an `is` shape test',
    TupleAccess: 'tuple access',
    TupleLiteral: 'a tuple',
    Block: 'a block',
    JsonObjectLiteral: 'a JSON literal'
};

/**
 * Rephrases why a program doesn't compile to one statement. The compiler
 * is right but terse; the playground's reader usually hit this by writing
 * a perfectly good rule, and deserves to know that running it still works.
 */
function explainNoSql(reason: string, kind: ProgramKind): CompiledSql {
    if (reason.includes('reaches outside the query being compiled')) {
        const what =
            kind === 'field-rule'
                ? '`$` and the record under validation'
                : kind === 'record-rule'
                  ? 'the record under validation'
                  : 'values that only exist at run time (a `let` variable, say)';
        return {
            ok: false,
            reason: `It reads ${what}, so it has no single SQL form. Running it evaluates those parts in memory and pushes each table-touching part down as its own statement.`,
            detail: reason,
            pushesDown: true
        };
    }
    const construct = /^"(\w+)" has no SQL form/.exec(reason)?.[1];
    if (construct) {
        return {
            ok: false,
            reason: `It uses ${INTERPRETED_ONLY[construct] ?? construct}, which the interpreter evaluates in memory (ADR 0001). Only its table-touching parts become SQL when it runs.`,
            detail: reason,
            pushesDown: true
        };
    }
    return { ok: false, reason, pushesDown: false };
}

/**
 * Wraps the real executor to time each statement and remember the source
 * node the interpreter said it came from (`EvalContext.onStatement`, which
 * fires immediately before `execute`).
 */
class TracingExecutor implements QueryExecutor {
    readonly entries: TraceEntry[] = [];
    lastColumns: string[] = [];
    private pendingOrigin?: AstNode;

    constructor(private readonly send: (query: SqlQuery) => Promise<{ rows: Row[]; columns: string[] }>) {}

    noteOrigin(origin: AstNode): void {
        this.pendingOrigin = origin;
    }

    async execute(query: SqlQuery): Promise<Row[]> {
        const origin = this.pendingOrigin;
        this.pendingOrigin = undefined;
        const range = rangeOf(origin);
        const entry: TraceEntry = {
            index: this.entries.length + 1,
            text: query.text,
            params: query.params,
            formatted: formatSql(query),
            rowCount: 0,
            preview: [],
            columns: [],
            durationMs: 0,
            origin: origin && range ? { range, type: origin.$type, text: origin.$cstNode?.text ?? '' } : undefined
        };
        this.entries.push(entry);
        const started = now();
        try {
            const { rows, columns } = await this.send(query);
            entry.rowCount = rows.length;
            entry.preview = rows.slice(0, PREVIEW_ROWS);
            entry.columns = columns;
            this.lastColumns = columns;
            return rows;
        } catch (e) {
            entry.error = (e as Error).message;
            throw e;
        } finally {
            entry.durationMs = now() - started;
        }
    }
}

/** A program analysed and ready to execute, pinned to the host it was checked against. */
interface Prepared {
    host: ActiveHost;
    analysis: AnalyzeReport;
    document: LangiumDocument<Model>;
}

export class Engine implements EngineApi {
    private readonly languageQueue = new Queue();
    private readonly databaseQueue = new Queue();
    private readonly hosts = new LanguageHosts();
    private readonly database: Database;
    private host: ActiveHost;

    constructor(private readonly onStatus: (status: EngineStatus) => void = () => {}) {
        this.database = new Database((state, error) => this.emitStatus(state, error));
        this.host = this.buildHost({ config: {}, dataSource: 'postgres' }).host;
    }

    private emitStatus(database: DatabaseState, databaseError?: string): void {
        this.onStatus({ phase: 'ready', database, databaseError });
    }

    /** Announces readiness. The default services were built by the constructor. */
    start(): void {
        this.emitStatus(this.database.state);
    }

    warmUp(): Promise<void> {
        const contents = this.host.contents;
        return this.databaseQueue.run(async () => {
            await this.database.load(contents);
        });
    }

    // ---- host -----------------------------------------------------------

    /** Parses a host config into everything the engine needs; a broken config still yields a usable (empty) host. */
    private buildHost(settings: HostSettings): { host: ActiveHost; result: { ok: true; tables: string[] } | { ok: false; error: string } } {
        try {
            const config = parseConfig(settings.config);
            const seed = seedOf(settings.config);
            const script = databaseScript(config.schema, seed); // validates the seed against the schema up front
            return {
                host: {
                    settings,
                    config,
                    language: this.hosts.get(config.schema, config.ruleContext),
                    contents: { schema: config.schema, seed, script }
                },
                result: { ok: true, tables: config.schema.tables.map(t => t.name) }
            };
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return {
                host: { settings, configError: message, language: this.hosts.get(EMPTY_SCHEMA, DEFAULT_RULE), contents: EMPTY_CONTENTS },
                result: { ok: false, error: message }
            };
        }
    }

    setHost(settings: HostSettings): ReturnType<EngineApi['setHost']> {
        return this.languageQueue.run(async () => {
            const { host, result } = this.buildHost(settings);
            this.host = host;
            return result;
        });
    }

    // ---- analysis -------------------------------------------------------

    private async analyzeWith(host: ActiveHost, source: string, channel: 'analyze' | 'run'): Promise<Prepared> {
        const language = host.language;
        const started = now();
        const document = await language.parse(source, channel);
        const parsed = now();
        const diagnostics = await language.validate(document);
        const program = describeProgram(document, language.services);
        const checked = now();

        let compiled: CompiledSql;
        const tail = document.parseResult.value.tail;
        if (diagnostics.some(d => d.severity === 1)) {
            compiled = { ok: false, reason: 'The program has errors — fix them to see its SQL.', pushesDown: false };
        } else if (!tail) {
            compiled = { ok: false, reason: 'The program has no final expression or query, so there is nothing to compile.', pushesDown: false };
        } else {
            const result = isQuery(tail) ? language.services.sqlCompiler.compileQuery(tail) : language.services.sqlCompiler.compileValue(tail);
            compiled = result.ok
                ? { ok: true, text: result.query.text, params: result.query.params, formatted: formatSql(result.query) }
                : explainNoSql(result.reason, program.kind);
        }
        const compiledAt = now();

        return {
            host,
            document,
            analysis: {
                diagnostics,
                program,
                compiled,
                configError: host.configError,
                timings: { parseMs: parsed - started, checkMs: checked - parsed, compileMs: compiledAt - checked }
            }
        };
    }

    analyze(source: string): Promise<AnalyzeReport> {
        return this.languageQueue.run(async () => (await this.analyzeWith(this.host, source, 'analyze')).analysis);
    }

    // ---- running --------------------------------------------------------

    run(source: string, runId: number): Promise<RunReport> {
        return this.runOn(() => this.host, source, runId);
    }

    /**
     * Runs a program against a host of its own, without replacing the
     * current one — for the landing page's live snippets, which must not
     * disturb whatever the workbench has loaded.
     */
    runSnippet(settings: HostSettings, source: string): Promise<RunReport> {
        return this.runOn(() => this.buildHost(settings).host, source, 0);
    }

    private async runOn(pickHost: () => ActiveHost, source: string, runId: number): Promise<RunReport> {
        const started = now();
        const prepared = await this.languageQueue.run(() => this.analyzeWith(pickHost(), source, 'run'));
        const { host, analysis, document } = prepared;
        const base: RunReport = {
            ...analysis,
            runId,
            stage: 'done',
            trace: [],
            dataSource: host.settings.dataSource,
            runMs: 0,
            totalMs: 0
        };
        const finish = (report: RunReport): RunReport => {
            report.totalMs = now() - started;
            return report;
        };

        if (host.configError || !host.config) {
            return finish({ ...base, stage: 'config', error: { kind: 'config', message: host.configError ?? 'invalid host config' } });
        }
        if (document.parseResult.lexerErrors.length > 0 || document.parseResult.parserErrors.length > 0) {
            return finish({ ...base, stage: 'parse' });
        }
        if (analysis.diagnostics.some(d => d.severity === 1)) {
            return finish({ ...base, stage: 'check' });
        }
        return this.databaseQueue.run(async () => finish(await this.execute(prepared, base)));
    }

    private async execute({ host, analysis, document }: Prepared, base: RunReport): Promise<RunReport> {
        const config = host.config!;
        const tracer = new TracingExecutor(async query => {
            if (host.settings.dataSource === 'fixtures') {
                const rows = await new FixtureExecutor(config.responses).execute(query);
                return { rows, columns: rows[0] ? Object.keys(rows[0]) : [] };
            }
            try {
                return await this.database.query(host.contents, query.text, query.params);
            } catch (e) {
                if (e instanceof DataSourceError) throw e;
                throw new DataSourceError(`Postgres rejected this statement: ${(e as Error).message}`);
            }
        });

        const started = now();
        try {
            const outcome = await host.language.services.interpreter.evaluate(document.parseResult.value, {
                executor: tracer,
                record: config.record,
                recordTable: config.ruleContext.recordTable,
                fieldValue: config.fieldValue,
                onStatement: (_query, origin) => tracer.noteOrigin(origin)
            });
            base.runMs = now() - started;
            base.trace = tracer.entries;
            if (!outcome.ok) {
                const refusal = explainRefusal(outcome.reason);
                return refusal
                    ? { ...base, stage: 'run', refusal: { ...refusal, reason: outcome.reason } }
                    : { ...base, stage: 'run', error: { kind: 'evaluation', message: outcome.reason } };
            }
            return { ...base, stage: 'done', result: this.shapeResult(outcome.value, analysis, tracer) };
        } catch (e) {
            base.runMs = now() - started;
            base.trace = tracer.entries;
            const failed = tracer.entries.find(entry => entry.error);
            if (e instanceof DataSourceError) {
                return { ...base, stage: 'run', error: { kind: 'datasource', message: e.message, sql: failed?.formatted } };
            }
            return { ...base, stage: 'run', error: { kind: 'internal', message: (e as Error).message ?? String(e) } };
        }
    }

    private shapeResult(value: unknown, analysis: AnalyzeReport, tracer: TracingExecutor): RunResult {
        const kind = analysis.program.kind;
        if (kind === 'query' && Array.isArray(value)) {
            const rows = value as Row[];
            const columns = tracer.lastColumns.length > 0 ? tracer.lastColumns : [...new Set(rows.flatMap(r => Object.keys(r)))];
            return { kind: 'rows', columns, rows };
        }
        if ((kind === 'record-rule' || kind === 'field-rule') && typeof value === 'boolean') {
            return { kind: 'verdict', value };
        }
        return { kind: 'value', value: value ?? null, type: analysis.program.resultType };
    }

    // ---- editor intelligence --------------------------------------------

    private intel(): EditorIntel {
        return new EditorIntel(this.host.language);
    }

    hover(source: string, offset: number): Promise<HoverInfo | undefined> {
        return this.languageQueue.run(() => this.intel().hover(source, offset));
    }

    complete(source: string, offset: number): Promise<CompletionReport> {
        return this.languageQueue.run(() => this.intel().complete(source, offset));
    }

    definition(source: string, offset: number): Promise<Range | undefined> {
        return this.languageQueue.run(() => this.intel().definition(source, offset));
    }

    ast(source: string): Promise<AstNodeView | undefined> {
        return this.languageQueue.run(() => this.intel().ast(source));
    }

    // ---- database -------------------------------------------------------

    tablePreview(table: string, limit: number): Promise<TablePreview> {
        const contents = this.host.contents;
        return this.databaseQueue.run(() => this.database.preview(contents, table, limit));
    }

    sql(text: string): Promise<SqlConsoleResult> {
        const contents = this.host.contents;
        return this.databaseQueue.run(() => this.database.console(contents, text));
    }

    resetDatabase(): Promise<void> {
        const contents = this.host.contents;
        return this.databaseQueue.run(() => this.database.reset(contents));
    }

    async seedSql(): Promise<string> {
        return this.host.contents.script;
    }

    /** Test and shutdown hook: releases the database. */
    close(): Promise<void> {
        return this.databaseQueue.run(() => this.database.close());
    }
}
