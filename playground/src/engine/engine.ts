/**
 * The Minab engine: check, compile and run a program against a host.
 *
 * It drives the runtime API (`src/runtime/`): one `Minab` for each host,
 * `prepare` to check, `compile()` for the SQL tab, and `run` with a data
 * port that points at an in-browser Postgres (or at the config's canned
 * answers) instead of a connection string. The runtime's event stream fills
 * the Execution tab. It has no DOM and no React: `worker.ts` exposes it to
 * the UI thread, and the tests drive it directly in Node.
 *
 * Work goes through two queues. Everything the language does (parsing,
 * checking, hovers, completion) runs on the language queue; everything that
 * touches Postgres runs on the database queue. A run does its analysis on the
 * first and its execution on the second, so the editor stays responsive while
 * Postgres boots or a query runs — and a rule that never reaches the
 * database never waits for it.
 */

import type { LangiumDocument } from 'langium';
import type { Model } from '../../../src/language/generated/ast.js';
import type { SqlQuery } from '../../../src/language/minab-executor.js';
import type { MinabRuleContext, MinabSchema } from '../../../src/language/schema.js';
import type { DataPort, EventSink, Minab, MinabDiagnostic, PreparedProgram, SourceRange } from '../../../src/runtime/index.js';
import { ConfigError, parseConfig, type HostConfig } from '../../../src/host/config.js';
import { DataSourceError, FixtureExecutor } from '../../../src/host/fixture-executor.js';
import { formatSql } from '../../../src/host/format.js';
import { Database, type DatabaseContents, type DatabaseState } from './database.js';
import { databaseScript } from './ddl.js';
import { EditorIntel } from './intel.js';
import { LanguageHosts, type LanguageHost } from './language.js';
import { describeProgram, explainRefusal, nodeAt } from './program.js';
import type {
    AnalyzeReport,
    AstNodeView,
    CompiledSql,
    CompletionReport,
    EngineApi,
    EngineDiagnostic,
    EngineStatus,
    HostSettings,
    HoverInfo,
    ProgramKind,
    Range,
    Row,
    RunReport,
    RunResult,
    Severity,
    SqlConsoleResult,
    TablePreview,
    LogEntry,
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
    /** The runtime for this host's schema and rule context. */
    minab: Minab;
    /** Only for the syntax tree: check-only constructs, symbols, statement origins, editor intelligence. */
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

const SEVERITIES: Record<MinabDiagnostic['severity'], Severity> = { error: 1, warning: 2, info: 3, hint: 4 };

function toEngineDiagnostic(d: MinabDiagnostic): EngineDiagnostic {
    return {
        severity: SEVERITIES[d.severity],
        message: d.message,
        range: d.range,
        source: d.code === 'syntax.lexer' || d.code === 'syntax.parser' ? 'syntax' : 'minab',
        code: d.code
    };
}

function sameRange(a: SourceRange, b: SourceRange): boolean {
    return a.start.line === b.start.line && a.start.character === b.start.character && a.end.line === b.end.line && a.end.character === b.end.character;
}

/**
 * Builds the Execution tab from a run. The runtime's `statement` event says
 * what is about to be sent and which part of the source it came from; the data
 * port then runs it and fills in the rows, the time and any error. The runtime
 * sends one statement at a time, so a statement's range waits in a queue until
 * its port call starts.
 */
class Tracer {
    readonly entries: TraceEntry[] = [];
    readonly logs: LogEntry[] = [];
    lastColumns: string[] = [];
    private readonly pending: (SourceRange | undefined)[] = [];

    constructor(
        private readonly document: LangiumDocument<Model>,
        private readonly send: (query: SqlQuery) => Promise<{ rows: Row[]; columns: string[] }>
    ) {}

    readonly events: EventSink = {
        emit: event => {
            if (event.kind === 'statement') this.pending.push(event.range);
            if (event.kind === 'dryRun') {
                // The playground always runs writes as a dry run (X5, D26): the statement is listed, not sent.
                const query = { text: event.sql, params: event.params };
                const node = event.range && nodeAt(this.document, event.range);
                this.entries.push({
                    index: this.entries.length + 1,
                    text: query.text,
                    params: query.params,
                    formatted: formatSql(query),
                    rowCount: 0,
                    preview: [],
                    columns: [],
                    durationMs: 0,
                    dryRun: true,
                    origin:
                        event.range && node && sameRange(event.range, node.$cstNode!.range)
                            ? { range: event.range, type: node.$type, text: node.$cstNode!.text }
                            : undefined
                });
            }
            if (event.kind === 'log') {
                this.logs.push({
                    index: this.logs.length + 1,
                    message: event.message,
                    ...(event.label === undefined ? {} : { label: event.label }),
                    ...(event.range ? { range: event.range } : {}),
                    ...(event.time === undefined ? {} : { timeMs: event.time })
                });
            }
        }
    };

    readonly port: DataPort = {
        execute: async query => {
            const range = this.pending.shift();
            const node = range && nodeAt(this.document, range);
            const entry: TraceEntry = {
                index: this.entries.length + 1,
                text: query.text,
                params: query.params,
                formatted: formatSql(query),
                rowCount: 0,
                preview: [],
                columns: [],
                durationMs: 0,
                origin: range && node && sameRange(range, node.$cstNode!.range) ? { range, type: node.$type, text: node.$cstNode!.text } : undefined
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
    };
}

/** A program analysed and ready to execute, pinned to the host it was checked against. */
interface Prepared {
    host: ActiveHost;
    analysis: AnalyzeReport;
    program: PreparedProgram;
    /** The syntax tree, to name the node a statement came from. */
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
                    ...this.hosts.get(config.schema, config.ruleContext),
                    contents: { schema: config.schema, seed, script }
                },
                result: { ok: true, tables: config.schema.tables.map(t => t.name) }
            };
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return {
                host: { settings, configError: message, ...this.hosts.get(EMPTY_SCHEMA, DEFAULT_RULE), contents: EMPTY_CONTENTS },
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
        const started = now();
        // The runtime parses and checks in one call.
        const program = await host.minab.prepare(source);
        const checked = now();
        const document = await host.language.parse(source, channel);
        const info = describeProgram(document, program);
        const parsed = now();

        let compiled: CompiledSql;
        const result = program.compile();
        if (result.ok) {
            compiled = { ok: true, text: result.sql.text, params: result.sql.params, formatted: formatSql(result.sql) };
        } else if (result.error.code === 'compile.programHasErrors') {
            compiled = { ok: false, reason: 'The program has errors — fix them to see its SQL.', pushesDown: false };
        } else if (result.error.code === 'compile.nothingToCompile') {
            compiled = { ok: false, reason: 'The program has no final expression or query, so there is nothing to compile.', pushesDown: false };
        } else if (result.error.code === 'compile.notSql') {
            compiled = explainNoSql(String(result.error.params.reason), program.kind);
        } else {
            compiled = { ok: false, reason: result.error.message, pushesDown: false };
        }
        const compiledAt = now();

        return {
            host,
            document,
            program,
            analysis: {
                diagnostics: program.diagnostics.map(toEngineDiagnostic),
                program: info,
                compiled,
                configError: host.configError,
                // `prepare` does both, so `checkMs` is the whole call. `parseMs` is this engine's own parse for the syntax tree.
                timings: { parseMs: parsed - checked, checkMs: checked - started, compileMs: compiledAt - parsed }
            }
        };
    }

    analyze(source: string): Promise<AnalyzeReport> {
        return this.languageQueue.run(async () => (await this.analyzeWith(this.host, source, 'analyze')).analysis);
    }

    // ---- running --------------------------------------------------------

    run(source: string, runId: number, signal?: AbortSignal): Promise<RunReport> {
        return this.runOn(() => this.host, source, runId, signal);
    }

    /**
     * Runs a program against a host of its own, without replacing the
     * current one — for the landing page's live snippets, which must not
     * disturb whatever the workbench has loaded.
     */
    runSnippet(settings: HostSettings, source: string): Promise<RunReport> {
        return this.runOn(() => this.buildHost(settings).host, source, 0);
    }

    private async runOn(pickHost: () => ActiveHost, source: string, runId: number, signal?: AbortSignal): Promise<RunReport> {
        const started = now();
        const prepared = await this.languageQueue.run(() => this.analyzeWith(pickHost(), source, 'run'));
        const { host, analysis } = prepared;
        const base: RunReport = {
            ...analysis,
            runId,
            stage: 'done',
            trace: [],
            logs: [],
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
        if (analysis.diagnostics.some(d => d.severity === 1 && d.source === 'syntax')) {
            return finish({ ...base, stage: 'parse' });
        }
        if (!prepared.program.ok) {
            return finish({ ...base, stage: 'check' });
        }
        return this.databaseQueue.run(async () => {
            // A run that was cancelled while it waited for the database never starts.
            if (signal?.aborted) return finish({ ...base, stage: 'run', error: { kind: 'evaluation', message: 'the run was cancelled' } });
            return finish(await this.execute(prepared, base, signal));
        });
    }

    private async execute({ host, analysis, program, document }: Prepared, base: RunReport, signal?: AbortSignal): Promise<RunReport> {
        const config = host.config!;
        const fixtures = host.settings.dataSource === 'fixtures' ? new FixtureExecutor(config.responses) : undefined;
        const tracer = new Tracer(document, async query => {
            if (fixtures) {
                const rows = await fixtures.execute(query);
                return { rows, columns: rows[0] ? Object.keys(rows[0]) : [] };
            }
            try {
                return await this.database.query(host.contents, query.text, query.params);
            } catch (e) {
                if (e instanceof DataSourceError) throw e;
                // Keep the driver's error as it is: the runtime reads its SQLSTATE. The tab shows this text.
                const failure = e as Error;
                failure.message = `Postgres rejected this statement: ${failure.message}`;
                throw failure;
            }
        });

        // Boot the database before the clock starts, so the limits count the program and not the boot.
        // A failure to boot comes back through the first statement, as it always did.
        if (!fixtures && program.analysis.needsData) await this.database.load(host.contents).catch(() => undefined);

        const started = now();
        try {
            const outcome = await program.run(
                { record: config.record, fieldValue: config.fieldValue },
                { data: tracer.port, events: tracer.events },
                // A program that writes runs as a dry run here: the statements show in the Execution tab and the database stays as it is.
                { writes: 'dry-run', ...(signal ? { signal } : {}) }
            );
            base.runMs = now() - started;
            base.trace = tracer.entries;
            base.logs = tracer.logs;
            if (outcome.ok && outcome.logsTruncated) base.logsTruncated = true;
            if (!outcome.ok) {
                const { error } = outcome;
                const failed = tracer.entries.find(entry => entry.error);
                if (failed) return { ...base, stage: 'run', error: { kind: 'datasource', message: failed.error!, sql: failed.formatted } };
                const reason = error.code === 'eval.failed' ? String(error.params.reason) : undefined;
                const refusal = reason === undefined ? undefined : explainRefusal(reason);
                return refusal
                    ? { ...base, stage: 'run', refusal: { ...refusal, reason: reason! } }
                    : { ...base, stage: 'run', error: { kind: 'evaluation', message: error.message } };
            }
            return { ...base, stage: 'done', result: this.shapeResult(outcome.value, analysis, tracer) };
        } catch (e) {
            base.runMs = now() - started;
            base.trace = tracer.entries;
            base.logs = tracer.logs;
            return { ...base, stage: 'run', error: { kind: 'internal', message: (e as Error).message ?? String(e) } };
        }
    }

    private shapeResult(value: unknown, analysis: AnalyzeReport, tracer: Tracer): RunResult {
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
