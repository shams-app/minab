/**
 * The contract between the UI thread and the engine worker.
 *
 * Everything here is plain, structured-clone-safe data: the worker owns
 * Langium and PGlite, the UI owns React and Monaco, and this file is the
 * only thing both import. Positions follow LSP conventions (0-based line
 * and character), since that's what Langium hands out; the Monaco layer
 * converts at its edge.
 */

export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

/** 1 error · 2 warning · 3 information · 4 hint (LSP `DiagnosticSeverity`). */
export type Severity = 1 | 2 | 3 | 4;

export interface EngineDiagnostic {
    severity: Severity;
    message: string;
    range: Range;
    /** Where the diagnostic came from: the lexer/parser, or Minab's validator/type checker. */
    source: 'syntax' | 'minab';
    /** The stable diagnostic code, for example `type.implicitCoercion`. Not shown in the UI yet. */
    code?: string;
}

// ---- host ---------------------------------------------------------------

/** Where a program's SQL goes: the in-browser Postgres, or the config's canned `data.responses`. */
export type DataSourceMode = 'postgres' | 'fixtures';

/**
 * What the playground stands in for: the host application. `config` is the
 * same JSON a `minab.config.json` holds (schema, rule, record, fieldValue,
 * data), plus one playground-only key, `seed`: rows to load into the
 * in-browser database, per table.
 */
export interface HostSettings {
    config: Record<string, unknown>;
    dataSource: DataSourceMode;
}

export type Row = Record<string, unknown>;

// ---- analysis -----------------------------------------------------------

/**
 * What kind of program this is, which decides how its answer is shown:
 * rows for a query, a pass/fail verdict for a rule, a value otherwise.
 */
export type ProgramKind = 'query' | 'record-rule' | 'field-rule' | 'value' | 'empty';

/** A construct that parses and type-checks but that the evaluator doesn't execute yet. */
export interface CheckOnlyConstruct {
    /** The AST `$type`, e.g. `LoopStatement`. */
    type: string;
    /** Human wording, e.g. "loops". */
    label: string;
    /** Where the spec describes it, e.g. "§9.4". */
    specRef: string;
    range: Range;
}

export interface ProgramInfo {
    kind: ProgramKind;
    /** The program contains constructs the evaluator refuses — it can be checked, not run. */
    checkOnly: boolean;
    checkOnlyConstructs: CheckOnlyConstruct[];
    /** The inferred type of the program's final expression, when it has one (`BOOLEAN`, `DECIMAL`, …). */
    resultType?: string;
    /** Names the program declares, for the outline and completion. */
    symbols: ProgramSymbol[];
}

export interface ProgramSymbol {
    kind: 'function' | 'variable';
    name: string;
    /** `fn` signature or declared type, as written. */
    detail?: string;
    range: Range;
}

export type CompiledSql =
    | { ok: true; text: string; params: unknown[]; formatted: string }
    | {
          ok: false;
          /** Why there is no single statement, in plain words. */
          reason: string;
          /** The compiler's own message, when `reason` rephrases it. */
          detail?: string;
          /** Whether running the program still sends statements to the database (its relational parts are pushed down). */
          pushesDown: boolean;
      };

export interface AnalyzeReport {
    diagnostics: EngineDiagnostic[];
    program: ProgramInfo;
    /** The whole program as one SQL statement — only a query compiles on its own; a rule reports why not. */
    compiled: CompiledSql;
    /** The host config failed to parse; diagnostics are then computed against an empty schema. */
    configError?: string;
    timings: { parseMs: number; checkMs: number; compileMs: number };
}

// ---- running ------------------------------------------------------------

export type RunResult =
    | { kind: 'rows'; columns: string[]; rows: Row[] }
    | { kind: 'verdict'; value: boolean }
    | { kind: 'value'; value: unknown; type?: string };

/** One statement that reached the data source, and the source span that produced it. */
export interface TraceEntry {
    index: number;
    text: string;
    params: unknown[];
    /** `text` with its parameters listed as SQL comments — ready to paste into psql. */
    formatted: string;
    rowCount: number;
    /** The first few rows returned, for the execution view. */
    preview: Row[];
    columns: string[];
    durationMs: number;
    /** The Minab node this statement was compiled from — the whole query, or the pushed-down subexpression. */
    origin?: { range: Range; type: string; text: string };
    error?: string;
}

/** One line of `LOG` output (L7), in the order the program logged it. */
export interface LogEntry {
    index: number;
    /** The one-line text: `label: value`, newlines escaped. */
    message: string;
    label?: string;
    /** The `LOG(...)` call in the source. */
    range?: Range;
    /** Milliseconds since the run started. */
    timeMs?: number;
}

export type RunStage = 'config' | 'parse' | 'check' | 'run' | 'done';

export interface RunReport extends AnalyzeReport {
    runId: number;
    /** Where the pipeline stopped. `done` means the program produced an answer. */
    stage: RunStage;
    result?: RunResult;
    /** The evaluator declined a construct it doesn't execute yet — not a bug, a boundary. */
    refusal?: { construct: string; label: string; specRef: string; reason: string };
    error?: { kind: 'config' | 'evaluation' | 'datasource' | 'internal'; message: string; sql?: string };
    trace: TraceEntry[];
    /** The `LOG` lines of the run. */
    logs: LogEntry[];
    /** More logs were made than the limit allows. The rest were dropped. */
    logsTruncated?: boolean;
    dataSource: DataSourceMode;
    runMs: number;
    totalMs: number;
}

// ---- editor intelligence ------------------------------------------------

export interface HoverInfo {
    /** Markdown. Empty when only `keyword` is set. */
    contents: string;
    range?: Range;
    /** The hovered token is this keyword; the UI documents keywords from the cheat sheet. */
    keyword?: string;
}

export type CompletionKind = 'keyword' | 'table' | 'column' | 'function' | 'builtin' | 'variable' | 'type';

export interface CompletionEntry {
    label: string;
    kind: CompletionKind;
    detail?: string;
    documentation?: string;
    insertText?: string;
    /** Sort bucket: lower sorts first. */
    rank: number;
}

export interface CompletionReport {
    entries: CompletionEntry[];
    /** The range of the partial word being completed. */
    replace?: Range;
}

/** One node of the parsed program, for the AST view. */
export interface AstNodeView {
    type: string;
    /** The property of the parent this node sits in (`whereClause`, `args[1]`). */
    feature?: string;
    range?: Range;
    /** Primitive properties worth showing inline: `name`, `operator`, `value`, … */
    attributes: Record<string, string | number | boolean>;
    /** Inferred Minab type, for expressions that have one. */
    inferredType?: string;
    children: AstNodeView[];
}

// ---- database -----------------------------------------------------------

export interface TablePreview {
    table: string;
    columns: Array<{ name: string; type: string }>;
    rows: Row[];
    total: number;
}

export interface SqlConsoleResult {
    statements: Array<{ command?: string; columns: string[]; rows: Row[]; affectedRows?: number }>;
    error?: string;
    durationMs: number;
}

export type EngineStatus =
    | { phase: 'starting' }
    | { phase: 'ready'; database: 'idle' | 'booting' | 'ready' | 'failed'; databaseError?: string }
    | { phase: 'failed'; error: string };

// ---- messages -----------------------------------------------------------

export interface EngineApi {
    /** Boots Postgres ahead of the first run, so the first answer isn't the slow one. */
    warmUp(): Promise<void>;
    setHost(host: HostSettings): Promise<{ ok: true; tables: string[] } | { ok: false; error: string }>;
    analyze(source: string): Promise<AnalyzeReport>;
    run(source: string, runId: number): Promise<RunReport>;
    /** Runs against a one-off host, leaving the current host untouched (landing-page snippets). */
    runSnippet(host: HostSettings, source: string): Promise<RunReport>;
    hover(source: string, offset: number): Promise<HoverInfo | undefined>;
    complete(source: string, offset: number): Promise<CompletionReport>;
    definition(source: string, offset: number): Promise<Range | undefined>;
    ast(source: string): Promise<AstNodeView | undefined>;
    tablePreview(table: string, limit: number): Promise<TablePreview>;
    sql(text: string): Promise<SqlConsoleResult>;
    resetDatabase(): Promise<void>;
    /** DDL plus INSERTs for the current host — the `seed.sql` of an export. */
    seedSql(): Promise<string>;
}

export type EngineMethod = keyof EngineApi;

export interface EngineRequest<M extends EngineMethod = EngineMethod> {
    id: number;
    method: M;
    args: Parameters<EngineApi[M]>;
}

export type EngineResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export type EngineEvent = { event: 'status'; status: EngineStatus };

export type EngineMessage = EngineResponse | EngineEvent;
