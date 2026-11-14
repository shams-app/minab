/** The public entry of `@shamsine/minab`: no Node, no DOM, no database driver. */

export { createMinab } from './minab.js';
export type {
    CacheStats,
    CompileExpressionOptions,
    CompileExpressionResult,
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
    SourceRange,
    WriteMode,
    WriteStatement
} from './types.js';
export type {
    ColumnType,
    DirectorySchema,
    MinabColumnSchema,
    MinabRuleContext,
    MinabSchema,
    MinabTableSchema,
    SpecialUserDeclaration
} from '../language/schema.js';
export { scalarType } from '../language/schema.js';
export type { LogicalTypeBase, ScalarType } from '../language/minab-types.js';
export type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';
export { LANGUAGE_VERSION, MIGRATIONS, migrate } from './migrate.js';
export type { MigrateResult, Migration } from './migrate.js';
export { DEFAULT_LIMITS } from './limits.js';
export type { Limits } from './limits.js';
export { NO_DIRECTORY_PORT, PortError, REFUSING_WRITE_PORT, SYSTEM_CLOCK } from './ports.js';
export { DirectoryRuntime, GroupValue, UserGroupValue, UserValue } from '../language/directory-values.js';
export type { DirectoryBudget, DirectoryErrorCode, DirectoryRaise, UserFilterSet, UserSet } from '../language/directory-values.js';
export type {
    ClockPort,
    DataContext,
    DataPort,
    DirectoryContext,
    DirectoryFilter,
    DirectoryGroup,
    DirectoryPort,
    DirectoryUser,
    HostCallContext,
    RouteContext,
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
