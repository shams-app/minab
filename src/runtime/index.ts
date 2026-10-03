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
    ProgramKind,
    RunInputs,
    RunOptions,
    RunPorts,
    RunResult,
    SourceRange
} from './types.js';
export type { MinabRuleContext, MinabSchema } from '../language/schema.js';
export type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';
