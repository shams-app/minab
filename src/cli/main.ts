/**
 * The `minab` command (roadmap Phase 6).
 *
 * Three verbs over the services Phases 1-5 built, each answering one
 * question about a `.minab` file:
 *
 *  - `check`   — is it a valid program? (parser + `MinabValidator`, which
 *                since Phase 4 carries the type-checking diagnostics too)
 *  - `compile` — what SQL does it become? (`MinabSqlCompiler`)
 *  - `run`     — what does it evaluate to? (`MinabInterpreter`, pushing
 *                the relational parts down to the compiler, per ADR 0001)
 *
 * Everything the host would normally supply — schema, rule context, the
 * record under validation, a data source — comes from a config file; see
 * `config.ts`. Nothing here decides anything about the language: this is a
 * front end over existing services, which is why Phase 6 is marked
 * Mechanical.
 *
 * `runCli` takes its argv and its output sinks as parameters rather than
 * reading `process.argv` and calling `console.log`, so the test suite can
 * drive whole commands and assert on what a user would actually see.
 * `bin.ts` is the thin wrapper that supplies the real ones.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URI, type LangiumDocument } from 'langium';
import { NodeFileSystem } from 'langium/node';
import type { Diagnostic } from 'vscode-languageserver-types';
import { isQuery, type Model } from '../language/generated/ast.js';
import type { SqlQuery } from '../language/minab-executor.js';
import { createMinabServices } from '../language/minab-module.js';
import type { MinabServices } from '../language/minab-module.js';
import {
    DEFAULT_CONFIG_NAME,
    ConfigError,
    emptyConfig,
    loadConfigFile,
    loadRecordFile,
    type LoadedConfig
} from './config.js';
import { formatDiagnostic, isError, messageText, summarize } from './diagnostics.js';
import { DataSourceError, FixtureExecutor, PostgresExecutor, traced } from './executors.js';

export interface CliIo {
    out(text: string): void;
    err(text: string): void;
    cwd: string;
}

/** Exit codes: 0 fine, 1 the program is bad or failed, 2 the invocation is bad. */
export const EXIT_OK = 0;
export const EXIT_PROGRAM_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;

const COMMANDS = ['run', 'compile', 'check'] as const;
type Command = (typeof COMMANDS)[number];

interface Options {
    command: Command;
    file: string;
    config?: string;
    database?: string;
    record?: string;
    field?: string;
    json: boolean;
    trace: boolean;
}

class UsageError extends Error {}

export const HELP = `minab — run, compile, and check Minab programs

Usage:
  minab <command> [options] <file.minab>

Commands:
  run        Evaluate the program against a data source and print the result
  compile    Print the SQL the program compiles to, without executing it
  check      Parse, validate, and type-check only

Options:
  -c, --config <file>    Config file (default: ${DEFAULT_CONFIG_NAME}, if present)
  -d, --database <url>   Run against a PostgreSQL database (needs the "pg" package)
  -r, --record <file>    JSON record under validation, overriding the config
      --field <json>     Value of \`$\` for a field rule, overriding the config
      --json             Print the result as JSON instead of for a human
      --trace            Print every SQL statement sent to the data source
  -h, --help             Show this help
  -v, --version          Show the version

The config file supplies what Minab source deliberately never names: the
table/column schema, whether the program is a field rule, the record under
validation, and where data comes from. See the README for its shape.`;

function parseArgs(argv: string[]): Options | { help: true } | { version: true } {
    const positional: string[] = [];
    const flags = new Map<string, string | true>();

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('-') || arg === '-') {
            positional.push(arg);
            continue;
        }
        const equals = arg.indexOf('=');
        const name = equals === -1 ? arg : arg.slice(0, equals);
        const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);
        const canonical = ALIASES[name];
        if (!canonical) throw new UsageError(`unknown option "${name}"`);
        if (VALUED.has(canonical)) {
            const value = inlineValue ?? argv[++i];
            if (value === undefined) throw new UsageError(`option "${name}" needs a value`);
            flags.set(canonical, value);
        } else {
            if (inlineValue !== undefined) throw new UsageError(`option "${name}" takes no value`);
            flags.set(canonical, true);
        }
    }

    if (flags.has('help') || positional[0] === 'help') return { help: true };
    if (flags.has('version')) return { version: true };

    const [command, ...rest] = positional;
    if (command === undefined) throw new UsageError('no command given');
    if (!COMMANDS.includes(command as Command)) {
        throw new UsageError(`unknown command "${command}" — expected ${COMMANDS.join(', ')}`);
    }
    if (rest.length === 0) throw new UsageError(`"${command}" needs a .minab file`);
    if (rest.length > 1) throw new UsageError(`"${command}" takes one file, got ${rest.length}`);

    return {
        command: command as Command,
        file: rest[0],
        config: flags.get('config') as string | undefined,
        database: flags.get('database') as string | undefined,
        record: flags.get('record') as string | undefined,
        field: flags.get('field') as string | undefined,
        json: flags.get('json') === true,
        trace: flags.get('trace') === true
    };
}

const ALIASES: Record<string, string | undefined> = {
    '-c': 'config', '--config': 'config',
    '-d': 'database', '--database': 'database',
    '-r': 'record', '--record': 'record',
    '--field': 'field',
    '--json': 'json',
    '--trace': 'trace',
    '-h': 'help', '--help': 'help',
    '-v': 'version', '--version': 'version'
};

const VALUED = new Set(['config', 'database', 'record', 'field']);

export async function runCli(argv: string[], io: CliIo): Promise<number> {
    let options: Options;
    try {
        const parsed = parseArgs(argv);
        if ('help' in parsed) {
            io.out(HELP);
            return EXIT_OK;
        }
        if ('version' in parsed) {
            io.out(packageVersion());
            return EXIT_OK;
        }
        options = parsed;
    } catch (e) {
        if (e instanceof UsageError) {
            io.err(`minab: ${e.message}\n\nRun "minab --help" for usage.`);
            return EXIT_USAGE_ERROR;
        }
        throw e;
    }

    try {
        return await execute(options, io);
    } catch (e) {
        if (e instanceof ConfigError) {
            io.err(`minab: ${e.message}`);
            return EXIT_USAGE_ERROR;
        }
        if (e instanceof DataSourceError) {
            io.err(`minab: ${e.message}`);
            return EXIT_PROGRAM_ERROR;
        }
        throw e;
    }
}

async function execute(options: Options, io: CliIo): Promise<number> {
    const filePath = resolvePath(options.file, io.cwd);
    if (!existsSync(filePath)) {
        io.err(`minab: cannot read ${options.file}`);
        return EXIT_USAGE_ERROR;
    }
    const config = loadConfig(options, filePath, io);
    // `production` here is a startup-time decision, not a correctness one:
    // it skips Chevrotain's per-construction grammar re-validation, which
    // takes ~2.8s against this grammar and answers a question the test
    // suite already answers. See `MinabServiceOptions` in `minab-module.ts`.
    const services = createMinabServices(NodeFileSystem, config.schema, config.ruleContext, { mode: 'production' }).Minab;

    const document = await buildDocument(services, filePath);
    const diagnostics = dedupe(document.diagnostics ?? []);
    const source = readFileSync(filePath, 'utf8');
    const label = displayPath(filePath, io.cwd);
    for (const diagnostic of diagnostics) {
        io.err(formatDiagnostic(diagnostic, source, label));
    }
    if (diagnostics.some(isError)) {
        io.err(`minab: ${summarize(diagnostics)} — ${STOPPED[options.command]}`);
        return EXIT_PROGRAM_ERROR;
    }

    const model = document.parseResult.value;
    switch (options.command) {
        case 'check':
            return reportCheck(diagnostics, label, options, io);
        case 'compile':
            return compile(model, services, options, io);
        case 'run':
            return await run(model, services, config, options, io);
    }
}

const STOPPED: Record<Command, string> = {
    check: 'not a valid program',
    compile: 'nothing compiled',
    run: 'nothing was run'
};

function reportCheck(diagnostics: Diagnostic[], label: string, options: Options, io: CliIo): number {
    if (options.json) {
        io.out(JSON.stringify({ ok: true, diagnostics }, null, 2));
    } else {
        io.out(diagnostics.length === 0 ? `${label}: no problems found` : `${label}: ${summarize(diagnostics)}`);
    }
    return EXIT_OK;
}

function compile(model: Model, services: MinabServices, options: Options, io: CliIo): number {
    if (!model.tail) {
        io.err('minab: nothing to compile — the program has no query or expression');
        return EXIT_PROGRAM_ERROR;
    }
    const compiled = isQuery(model.tail)
        ? services.sqlCompiler.compileQuery(model.tail)
        : services.sqlCompiler.compileValue(model.tail);
    if (!compiled.ok) {
        // Refusing to compile is how the compiler tells the interpreter to
        // take a node itself (ADR 0001), so this is a legitimate answer to
        // `compile` — not a crash, and `run` may well still work.
        io.err(`minab: this program does not compile to SQL on its own: ${compiled.reason}\n` +
               `Use "minab run" to evaluate it — the interpreter handles what SQL can't, and pushes the rest down.`);
        return EXIT_PROGRAM_ERROR;
    }
    io.out(options.json ? JSON.stringify(compiled.query, null, 2) : formatSql(compiled.query));
    return EXIT_OK;
}

async function run(
    model: Model,
    services: MinabServices,
    config: LoadedConfig,
    options: Options,
    io: CliIo
): Promise<number> {
    const databaseUrl = options.database ?? process.env.MINAB_DATABASE_URL ?? config.database;
    const postgres = databaseUrl ? await PostgresExecutor.connect(databaseUrl) : undefined;
    const base = postgres ?? new FixtureExecutor(config.responses);
    const executor = options.trace ? traced(base, query => io.err(formatSql(query))) : base;

    try {
        const result = await services.interpreter.evaluate(model, {
            executor,
            record: config.record,
            recordTable: config.ruleContext.recordTable,
            fieldValue: config.fieldValue
        });
        if (!result.ok) {
            io.err(`minab: cannot evaluate this program: ${result.reason}`);
            return EXIT_PROGRAM_ERROR;
        }
        io.out(options.json ? JSON.stringify(result.value ?? null, null, 2) : formatValue(result.value));
        return EXIT_OK;
    } finally {
        await postgres?.close();
    }
}

function loadConfig(options: Options, programPath: string, io: CliIo): LoadedConfig {
    let config: LoadedConfig;
    if (options.config) {
        const path = resolvePath(options.config, io.cwd);
        if (!existsSync(path)) throw new ConfigError(`cannot read config file ${options.config}`);
        config = loadConfigFile(path);
    } else {
        const discovered = discoverConfig(dirname(programPath));
        config = discovered ? loadConfigFile(discovered) : emptyConfig();
    }
    if (options.record) {
        config = { ...config, record: loadRecordFile(resolvePath(options.record, io.cwd)) };
    }
    if (options.field !== undefined) {
        config = { ...config, fieldValue: parseFieldValue(options.field) };
    }
    return config;
}

/**
 * Walks up from the program's own directory, not from the working
 * directory: a config belongs with the `.minab` files it describes, and
 * `minab run examples/rule.minab` should work from anywhere in the repo.
 */
function discoverConfig(startDir: string): string | undefined {
    let dir = startDir;
    for (;;) {
        const candidate = join(dir, DEFAULT_CONFIG_NAME);
        if (existsSync(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/** `--field 42` and `--field '"paid"'` are both JSON; a bare word is taken as the string it plainly is. */
function parseFieldValue(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function buildDocument(services: MinabServices, path: string): Promise<LangiumDocument<Model>> {
    const documents = services.shared.workspace.LangiumDocuments;
    const document = await documents.getOrCreateDocument(URI.file(path));
    await services.shared.workspace.DocumentBuilder.build([document], {
        // A file that doesn't parse gets its syntax errors and nothing
        // else. Type-checking a half-recovered AST produces diagnostics
        // about the typo's fallout rather than about the typo, and the
        // first error is the only one worth reading anyway.
        validation: { stopAfterLexingErrors: true, stopAfterParsingErrors: true }
    });
    return document as LangiumDocument<Model>;
}

/**
 * One mistake, one message. `MinabValidator` registers its type checks on
 * every expression node, so an error inside a subexpression is reported
 * again by each enclosing node that re-infers it — the same message over a
 * range that contains the original. Only the innermost one points at the
 * actual mistake, so the ones wrapping it are dropped. Two identical
 * messages over ranges that *don't* nest are two real errors, and both
 * survive.
 */
function dedupe(diagnostics: Diagnostic[]): Diagnostic[] {
    const groups = new Map<string, Diagnostic[]>();
    for (const diagnostic of diagnostics) {
        const key = `${diagnostic.severity ?? 1}|${messageText(diagnostic)}`;
        const group = groups.get(key);
        if (group) group.push(diagnostic);
        else groups.set(key, [diagnostic]);
    }
    const innermost = new Set<Diagnostic>();
    for (const group of groups.values()) {
        for (const diagnostic of group) {
            if (!group.some(other => other !== diagnostic && contains(diagnostic, other))) {
                innermost.add(diagnostic);
            }
        }
    }
    // A group of identical ranges would keep every copy by the rule above,
    // since none strictly contains another; the Set of ranges settles it.
    const seen = new Set<string>();
    return diagnostics.filter(diagnostic => {
        if (!innermost.has(diagnostic)) return false;
        const key = `${diagnostic.severity ?? 1}|${rangeKey(diagnostic)}|${messageText(diagnostic)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function rangeKey(diagnostic: Diagnostic): string {
    const { start, end } = diagnostic.range;
    return `${start.line}:${start.character}-${end.line}:${end.character}`;
}

/** True when `outer`'s range strictly encloses `inner`'s. */
function contains(outer: Diagnostic, inner: Diagnostic): boolean {
    const a = outer.range;
    const b = inner.range;
    const startsBefore = a.start.line < b.start.line
        || (a.start.line === b.start.line && a.start.character <= b.start.character);
    const endsAfter = a.end.line > b.end.line
        || (a.end.line === b.end.line && a.end.character >= b.end.character);
    return startsBefore && endsAfter && rangeKey(outer) !== rangeKey(inner);
}

/** SQL, then its parameters as SQL comments — so the whole block can be pasted into psql and edited, not just read. */
export function formatSql(query: SqlQuery): string {
    if (query.params.length === 0) return query.text;
    const params = query.params.map((value, index) => `--   $${index + 1} = ${JSON.stringify(value) ?? 'null'}`);
    return `${query.text}\n-- parameters\n${params.join('\n')}`;
}

/**
 * A validation rule answers with one value; a pipeline query answers with
 * rows. Printing rows as a table rather than as JSON is the difference
 * between reading a result and parsing one.
 */
export function formatValue(value: unknown): string {
    if (Array.isArray(value) && value.length > 0 && value.every(isPlainRow)) {
        return formatTable(value as Record<string, unknown>[]);
    }
    if (Array.isArray(value) && value.length === 0) return '(no rows)';
    return JSON.stringify(value ?? null, null, 2);
}

function isPlainRow(value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatTable(rows: Record<string, unknown>[]): string {
    const columns: string[] = [];
    for (const row of rows) {
        for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    }
    const cells = rows.map(row => columns.map(column => renderCell(row[column])));
    const widths = columns.map((column, index) =>
        Math.max(column.length, ...cells.map(row => row[index].length))
    );
    const line = (values: string[]) => values.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
    return [
        line(columns),
        widths.map(w => '-'.repeat(w)).join('  '),
        ...cells.map(line)
    ].join('\n');
}

function renderCell(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function resolvePath(path: string, cwd: string): string {
    return isAbsolute(path) ? path : resolve(cwd, path);
}

function displayPath(path: string, cwd: string): string {
    const relativePath = relative(cwd, path);
    return relativePath === '' || relativePath.startsWith('..') ? path : relativePath;
}

/**
 * Found by walking up from this module rather than by a fixed relative
 * path: `src/cli/` and the built `out/src/cli/` sit at different depths
 * below the package root, and a wrong `--version` is a silly way to fail.
 */
function packageVersion(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
        const candidate = join(dir, 'package.json');
        if (existsSync(candidate)) {
            const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
            if (parsed.version && parsed.name?.includes('minab')) return parsed.version;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return 'unknown';
}
