/** The public entry of `@shamsine/minab`: no Node, no DOM, no database driver. */

export { createMinab } from './minab.js';
export type {
    CacheStats,
    CompileResult,
    ExpectedType,
    Minab,
    MinabDiagnostic,
    MinabError,
    MinabOptions,
    MinabSeverity,
    PrepareOptions,
    PreparedProgram,
    ProgramAnalysis,
    ProgramKind,
    RunInputs,
    RunOptions,
    RunPorts,
    RunResult,
    SourceRange
} from './types.js';
export type { MinabRuleContext, MinabSchema } from '../language/schema.js';
export type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';
export { PortError, REFUSING_WRITE_PORT, SYSTEM_CLOCK } from './ports.js';
export type {
    ClockPort,
    DataContext,
    DataPort,
    EventSink,
    HostDeclarations,
    HostFunctionDeclaration,
    HostFunctions,
    HostInputType,
    MinabEvent,
    WritePort,
    WriteTransaction
} from './ports.js';
export { HostDeclarationError } from '../language/host-declarations.js';
