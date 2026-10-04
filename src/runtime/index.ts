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
    RunStats,
    SourceRange
} from './types.js';
export type { MinabRuleContext, MinabSchema } from '../language/schema.js';
export type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';
export { DEFAULT_LIMITS } from './limits.js';
export type { Limits } from './limits.js';
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
export { WIRE_VERSIONS, WireError, decodeValue, encodeValue, parseRequest, parseResponse, wireErrorResponse, wireScalar } from './wire.js';
export type {
    Json,
    ParseRequestOptions,
    WireErrorResponse,
    WireParse,
    WireProgramRef,
    WireProgramSource,
    WireRequest,
    WireResponse,
    WireResult,
    WireRun,
    WireRunOptions,
    WireType
} from './wire.js';
