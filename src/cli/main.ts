/**
 * The `minab` command (roadmap Phase 6, moved onto the runtime API in R7).
 *
 * Three verbs, each answering one question about a `.minab` file:
 *
 *  - `check`   — is it a valid program? (`prepare` diagnostics)
 *  - `compile` — what SQL does it become? (`PreparedProgram.compile`)
 *  - `run`     — what does it evaluate to? (`PreparedProgram.run`)
 *
 * The CLI is a host like any other. It builds a runtime with `createMinab`,
 * prepares the file, and runs it with a data port. It never touches the
 * Langium services. `test/cli-imports.test.ts` checks that.
 *
 * Everything the host would normally supply — schema, rule context, the
 * record under validation, a data source — comes from a config file; see
 * `config.ts`.
 *
 * `runCli` takes its argv and its output sinks as parameters rather than
 * reading `process.argv` and calling `console.log`, so the test suite can
 * drive whole commands and assert on what a user would actually see.
 * `bin.ts` is the thin wrapper that supplies the real ones.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Diagnostic } from 'vscode-languageserver-types';
import { createMinab, type DataPort, type MinabError, type PreparedProgram } from '../runtime/index.js';
import { DEFAULT_CONFIG_NAME, ConfigError, discoverConfig, emptyConfig, loadConfigFile, loadRecordFile, type LoadedConfig } from './config.js';
import { formatDiagnostic, isError, summarize, toCliDiagnostic } from './diagnostics.js';
import { DataSourceError, FixtureExecutor, connectPostgres } from './executors.js';
import { formatSql, formatValue } from '../host/format.js';

export { formatSql, formatValue } from '../host/format.js';

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
    '-c': 'config',
    '--config': 'config',
    '-d': 'database',
    '--database': 'database',
    '-r': 'record',
    '--record': 'record',
    '--field': 'field',
    '--json': 'json',
    '--trace': 'trace',
    '-h': 'help',
    '--help': 'help',
    '-v': 'version',
    '--version': 'version'
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
    const minab = createMinab({
        schema: config.schema,
        ruleContext: config.ruleContext,
        mode: 'production'
    });
    try {
        const source = readFileSync(filePath, 'utf8');
        const program = await minab.prepare(source);
        const diagnostics = program.diagnostics.map(toCliDiagnostic);
        const label = displayPath(filePath, io.cwd);
        for (const diagnostic of diagnostics) {
            io.err(formatDiagnostic(diagnostic, source, label));
        }
        if (diagnostics.some(isError)) {
            io.err(`minab: ${summarize(diagnostics)} — ${STOPPED[options.command]}`);
            if (options.command === 'check' && options.json) {
                // Tools read this: each diagnostic carries its stable `code` and `data.params`.
                io.out(JSON.stringify({ ok: false, diagnostics }, null, 2));
            }
            return EXIT_PROGRAM_ERROR;
        }

        switch (options.command) {
            case 'check':
                return reportCheck(diagnostics, label, options, io);
            case 'compile':
                return compile(program, options, io);
            case 'run':
                return await run(program, config, options, io);
        }
    } finally {
        minab.dispose();
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

function compile(program: PreparedProgram, options: Options, io: CliIo): number {
    const compiled = program.compile();
    if (!compiled.ok) {
        if (compiled.error.code === 'compile.nothingToCompile') {
            io.err('minab: nothing to compile — the program has no query or expression');
            return EXIT_PROGRAM_ERROR;
        }
        // Refusing to compile is how the compiler tells the interpreter to
        // take a node itself (ADR 0001), so this is a legitimate answer to
        // `compile` — not a crash, and `run` may well still work.
        io.err(
            `minab: this program does not compile to SQL on its own: ${errorReason(compiled.error)}\n` +
                `Use "minab run" to evaluate it — the interpreter handles what SQL can't, and pushes the rest down.`
        );
        return EXIT_PROGRAM_ERROR;
    }
    io.out(options.json ? JSON.stringify(compiled.sql, null, 2) : formatSql(compiled.sql));
    return EXIT_OK;
}

/** Most failures carry their plain reason in `params.reason`; the others have it in the message. */
function errorReason(error: MinabError): string {
    return typeof error.params.reason === 'string' ? error.params.reason : error.message;
}

async function run(program: PreparedProgram, config: LoadedConfig, options: Options, io: CliIo): Promise<number> {
    const databaseUrl = options.database ?? process.env.MINAB_DATABASE_URL ?? config.database;
    const postgres = databaseUrl ? await connectPostgres(databaseUrl) : undefined;
    const base: DataPort = postgres ?? new FixtureExecutor(config.responses);

    // The runtime hides the driver's text, because a host must not leak SQL. A person at a
    // terminal needs it, so the CLI keeps the first data source failure and prints it itself.
    let sourceFailure: DataSourceError | undefined;
    const data: DataPort = {
        async execute(query, context) {
            try {
                return await base.execute(query, context);
            } catch (e) {
                if (e instanceof DataSourceError) sourceFailure ??= e;
                throw e;
            }
        }
    };

    try {
        const result = await program.run(
            { record: config.record, fieldValue: config.fieldValue },
            {
                data,
                events: options.trace
                    ? {
                          emit(event) {
                              if (event.kind === 'statement') io.err(formatSql({ text: event.sql, params: event.params }));
                          }
                      }
                    : undefined
            }
        );
        if (sourceFailure) {
            io.err(`minab: ${(sourceFailure as DataSourceError).message}`);
            return EXIT_PROGRAM_ERROR;
        }
        if (!result.ok) {
            io.err(`minab: cannot evaluate this program: ${errorReason(result.error)}`);
            // Tools read the code. Human output stays as it was.
            if (options.json) io.out(JSON.stringify({ ok: false, error: result.error }, null, 2));
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
        config = {
            ...config,
            record: loadRecordFile(resolvePath(options.record, io.cwd))
        };
    }
    if (options.field !== undefined) {
        config = { ...config, fieldValue: parseFieldValue(options.field) };
    }
    return config;
}

/** `--field 42` and `--field '"paid"'` are both JSON; a bare word is taken as the string it plainly is. */
function parseFieldValue(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
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
            const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
                name?: string;
                version?: string;
            };
            if (parsed.version && parsed.name?.includes('minab')) return parsed.version;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return 'unknown';
}
