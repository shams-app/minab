/**
 * The interpreted half of the hybrid execution strategy (roadmap Phase 5,
 * ADR 0001).
 *
 * Evaluates a Minab program against a record the host already holds — the
 * row being validated (spec §6) — walking the AST the same way
 * `MinabScopeResolver` and `MinabTypeChecker` already do, but at runtime.
 * This is where the parts of the language that aren't relational algebra
 * live: `let`, `if`/`switch`, `&fn` calls, and the operators themselves.
 *
 * **The seam with SQL.** Before evaluating any expression natively, the
 * interpreter asks whether that expression reaches into table data
 * (`isRelational`) and, if so, hands it to `MinabSqlCompiler` and runs the
 * result through the host's `QueryExecutor`. That is what keeps spec
 * §6.1's correlated `EXISTS(#Booking[...])` a single indexed lookup
 * instead of a full-table fetch — the failure mode ADR 0001 rejects
 * Option B for. When compilation refuses (the subexpression contains a
 * `&fn` call, say), evaluation falls back to interpreting the node and
 * pushing down its smaller relational parts instead, so a program is never
 * rejected just because one node straddles the seam.
 *
 * Values outside the compiled region are bound as query parameters through
 * `OuterResolver` — `^`, `^.field`, `$`, and `let` variables are all
 * evaluated here, in memory, and handed to the compiler as values.
 *
 * Evaluation is async throughout: every user function is implicitly
 * asynchronous (spec §8) and every pushdown is a round trip.
 *
 * Statements (X3, X4) run in one place, `runStatements`: `let`, assignment to a
 * local name, `if!` and the three loops with `break` and `continue`. A block gets its own scope. A write (a record path
 * as an assignment target) fails with `eval.writesNotSupported`.
 *
 * Not implemented yet (each fails with an explicit reason rather than a
 * wrong answer): `INSERT`/`UPDATE`/`DELETE` execution (§10, X5, X6). ADR 0001
 * covers how writes execute.
 */

import {
    isAssignmentStatement,
    isCallStatement,
    isBinaryExpression,
    isBlock,
    isBooleanLiteral,
    isBreakStatement,
    isContinueStatement,
    isLoopStatement,
    isTupleLiteral,
    isCallExpression,
    isCastExpr,
    isCurrentRecord,
    isFieldValue,
    isFilterAccess,
    isFunctionDecl,
    isGroupKeyRef,
    isIfExpr,
    isIfStatement,
    isIndexRef,
    isJsonObjectLiteral,
    isListLiteral,
    isMemberAccess,
    isNamedScope,
    isNameRef,
    isNullLiteral,
    isNumberLiteral,
    isParentRecord,
    isQuery,
    isStringLiteral,
    isSubquery,
    isSwitchExpr,
    isTableRef,
    isTupleAccess,
    isTypeRef,
    isTypeTestExpression,
    isUnaryExpression,
    isVariableDecl,
    type AssignmentStatement,
    type CallExpression,
    type BinaryExpression,
    type Block,
    type BodyStatement,
    type Expression,
    type FunctionDecl,
    type IfStatement,
    type IfStatementElse,
    type LoopStatement,
    type MainStatement,
    type Model,
    type SwitchExpr,
    type Type
} from './generated/ast.js';
import { BuiltinError, getBuiltin, isBuiltinName, type BuiltinArgInfo, type BuiltinClock, type BuiltinSignature } from './minab-builtins.js';
import type { AstNode } from 'langium';
import type { Row, SqlQuery } from './minab-executor.js';
import type { DataPort, EventSink, HostFunctions, WritePort } from '../runtime/ports.js';
import type { MinabTypeChecker } from './minab-type-checker.js';
import type { MinabSqlCompiler, OuterRecord, OuterResolver } from './minab-sql-compiler.js';
import type { SchemaProvider } from './schema.js';
import {
    arithmetic,
    decimalCompare,
    decimalEqual,
    externalize,
    jsonNumber,
    literal,
    negate,
    normalizeIn,
    NumberError,
    toNumeric,
    type Arithmetic,
    type Numeric
} from './values.js';
import { castValue } from './casts.js';
import { dataFailure } from '../runtime/errors.js';
import { formatLogMessage } from '../runtime/log-format.js';
import { NO_LIMITS, RunBudget, RunStopped } from '../runtime/limits.js';
import { PortError } from '../runtime/ports.js';
import type { MinabError, SourceRange } from '../runtime/types.js';
import { coded } from './diagnostics/codes.js';
import type { LogicalTypeBase } from './minab-types.js';

export type MinabValue = unknown;

/** `code` and `params` are set when the failure has a stable code (for example `eval.missingInput`). */
export type EvalResult =
    | { ok: true; value: MinabValue }
    | {
          ok: false;
          reason: string;
          code?: string;
          params?: Record<string, string | number>;
      };

/** The structured result of `MinabInterpreter.run` (R4). */
export type InterpretResult = { ok: true; value: MinabValue } | { ok: false; error: MinabError; cause?: unknown };

/** What the host supplies for one evaluation: the connection, the record under validation (spec §6), and `$` when this is a field rule (§6.2). */
export interface EvalContext {
    /** The data port (ADR 0002, 4.1). A plain `QueryExecutor` fits: it ignores the second argument. */
    executor: DataPort;
    /** The write port (X5 builds it). Not used yet. */
    write?: WritePort;
    /** Values of the declared host inputs (D27). A declared input with no value is the run error `eval.missingInput`. */
    hostInputs?: Record<string, MinabValue>;
    hostFunctions?: HostFunctions;
    /** The instant the run started: read once from the clock port. L6's `NOW()` returns it. */
    now?: Date;
    /** IANA name from the clock port. */
    timeZone?: string;
    /** One stream for statements, logs and timing (D33). */
    events?: EventSink;
    /**
     * Limits, counters and the abort signal of this run. `prepare.run` makes it. When it is
     * missing, the interpreter makes one with no limits that still honors `signal`.
     */
    budget?: RunBudget;
    /** The host's abort signal. Only used when there is no `budget`. */
    signal?: AbortSignal;
    record?: Row;
    recordTable?: string;
    fieldValue?: MinabValue;
}

class EvalError extends Error {
    /** The node that failed. The innermost expression sets it. */
    range?: SourceRange;

    constructor(
        reason: string,
        readonly code?: string,
        readonly params?: Record<string, string | number>,
        /** The original error, when a port failed. A test helper (`test/support/evaluate.ts`) throws it again. */
        readonly cause?: unknown
    ) {
        super(reason);
    }
}

/** Puts the range of the innermost failing node on an error that has none yet. */
function placeError(e: unknown, node: AstNode): void {
    if (e instanceof EvalError || e instanceof NumberError || (e instanceof RunStopped && e.code !== 'cancelled')) {
        e.range ??= node.$cstNode?.range;
    }
}

/** `break` and `continue` travel up to their loop as a thrown value. A loop catches the ones that name it. */
class LoopSignal {
    constructor(
        readonly kind: 'break' | 'continue',
        readonly label?: string
    ) {}
}

function fail(reason: string, code?: string, params?: Record<string, string | number>): never {
    throw new EvalError(reason, code, params);
}

/** One level of the spec §2.2 scope stack, at runtime: what `.` means here, and what names are bound. */
interface Frame {
    record?: Row;
    table?: string;
    variables: Map<string, MinabValue>;
    /** The position of `.` in an array source (`.$index`, spec §3.5). Not set for the rows of a table. */
    index?: number;
    /** The declared type of each name in `variables`, so an assignment keeps the type (`DECIMAL` stays exact). */
    types: Map<string, Type>;
    /**
     * A block's scope (X3): it holds names only. `.`, `^` and the compiler's frame counting skip it,
     * so a block does not change what `^` means.
     */
    scopeOnly?: boolean;
}

/**
 * The Postgres `LIKE` matcher (`MatchText`), on arrays of characters. It is
 * a copy of the algorithm and not a regular expression, so a pattern that
 * ends with `\` fails at the same moments: only when the matcher reaches the
 * `\` (Postgres: `'Hello' LIKE 'Hello\'` is `false`, `'Hello!' LIKE 'Hello\'` fails).
 */
function likeMatch(t: string[], ti: number, p: string[], pi: number): 'true' | 'false' | 'abort' {
    const trailing = (): never => fail('LIKE pattern must not end with escape character');
    while (ti < t.length && pi < p.length) {
        if (p[pi] === '\\') {
            pi++;
            if (pi >= p.length) trailing();
            if (p[pi] !== t[ti]) return 'false';
        } else if (p[pi] === '%') {
            pi++;
            while (pi < p.length) {
                if (p[pi] === '%') pi++;
                else if (p[pi] === '_') {
                    if (ti >= t.length) return 'abort';
                    ti++;
                    pi++;
                } else break;
            }
            if (pi >= p.length) return 'true';
            let first = p[pi];
            if (first === '\\') {
                if (pi + 1 >= p.length) trailing();
                first = p[pi + 1];
            }
            while (ti < t.length) {
                if (t[ti] === first) {
                    const matched = likeMatch(t, ti, p, pi);
                    if (matched !== 'false') return matched;
                }
                ti++;
            }
            return 'abort';
        } else if (p[pi] === '_') {
            ti++;
            pi++;
            continue;
        } else if (p[pi] !== t[ti]) {
            return 'false';
        }
        pi++;
        ti++;
    }
    if (ti < t.length) return 'false';
    while (pi < p.length && p[pi] === '%') pi++;
    return pi >= p.length ? 'true' : 'abort';
}

export class MinabInterpreter {
    constructor(
        private readonly schema: SchemaProvider,
        private readonly compiler: MinabSqlCompiler,
        private readonly typeChecker?: MinabTypeChecker
    ) {}

    /**
     * Runs a program. A program failure, a limit and a cancel come back as `{ ok: false, error }`
     * with a code. Only a bug in Minab throws.
     */
    async run(model: Model, given: EvalContext): Promise<InterpretResult> {
        // The clock is read once: every `NOW()` in this run is the same instant (D21).
        const context: EvalContext = { ...given, now: given.now ?? new Date(), timeZone: given.timeZone ?? 'UTC' };
        const ownBudget = context.budget === undefined;
        const budget = context.budget ?? new RunBudget(NO_LIMITS, context.signal);
        const state = new State(context, budget, [], this.collectFunctions(model), name => this.readHostInput(name, context));
        try {
            state.frames.push({
                record: this.normalizeRecord(context.record, context.recordTable),
                table: context.recordTable,
                variables: new Map(),
                types: new Map()
            });
            budget.check();
            // Top-level statements run in order. A function is known from the start (`collectFunctions`).
            for (const declaration of model.declarations) {
                if (!isFunctionDecl(declaration)) await this.runStatements([declaration], state);
            }
            if (!model.tail) return { ok: true, value: null };
            return {
                ok: true,
                value: externalize(await this.mainStatement(model.tail, state))
            };
        } catch (e) {
            return this.failure(e);
        } finally {
            if (ownBudget) budget.dispose();
        }
    }

    /** The run's clock, for the compiler (it binds the instant and the zone as parameters). */
    private clockOf(state: State): BuiltinClock {
        return { now: state.context.now!, timeZone: state.context.timeZone! };
    }

    /** An error thrown inside a run, as a structured result. A bug (anything else) is thrown again. */
    private failure(e: unknown): InterpretResult {
        if (e instanceof LoopSignal)
            return {
                ok: false,
                error: { code: 'eval.failed', message: `"${e.kind}" is not inside a loop`, params: { reason: `"${e.kind}" is not inside a loop` } }
            };
        if (e instanceof EvalError || e instanceof NumberError) {
            const params = { ...e.params };
            // `reason` carries the text of an uncoded failure, so the message can be built from the registry.
            const code = e.code ?? 'eval.failed';
            if (e.code === undefined) params.reason = e.message;
            const error: MinabError = { code, message: e.message, params };
            if (e.range) error.range = e.range;
            return { ok: false, error, cause: e instanceof EvalError ? e.cause : undefined };
        }
        if (e instanceof RunStopped) {
            const error: MinabError = { code: e.code, message: e.message, params: e.params };
            if (e.range) error.range = e.range;
            return { ok: false, error };
        }
        if (e instanceof PortError) return { ok: false, error: { code: e.code, message: e.message, params: {} }, cause: e };
        throw e;
    }

    /** The record under validation, with each column read by its type: `DECIMAL` is exact, `INTEGER` is a number in range (spec §7.2). */
    private normalizeRecord(record: Row | undefined, table: string | undefined): Row | undefined {
        if (!record || !table) return record;
        const normalized: Row = { ...record };
        for (const column of this.schema.getTable(table)?.columns ?? []) {
            if (column.type.kind !== 'scalar' || !(column.name in record)) continue;
            normalized[column.name] = normalizeIn(record[column.name], column.type.type.base, column.type.type.array);
        }
        return normalized;
    }

    /** A declared host input, read by bare name. The value comes from the host, per run. */
    private readHostInput(name: string, context: EvalContext): MinabValue {
        if (!this.schema.getHostInput(name)) fail(`unknown name "${name}"`);
        const inputs = context.hostInputs;
        if (!inputs || !Object.hasOwn(inputs, name) || inputs[name] === undefined) {
            fail(coded('eval.missingInput', { name }).reason, 'eval.missingInput', { name });
        }
        return inputs[name];
    }

    private collectFunctions(model: Model): Map<string, FunctionDecl> {
        const functions = new Map<string, FunctionDecl>();
        for (const declaration of model.declarations) {
            if (isFunctionDecl(declaration)) functions.set(declaration.name, declaration);
        }
        return functions;
    }

    private async mainStatement(statement: MainStatement, state: State): Promise<MinabValue> {
        if (isQuery(statement)) {
            try {
                const compiled = this.compiler.compileQuery(statement, this.outerResolver(state), this.clockOf(state));
                if (!compiled.ok) fail(compiled.reason, compiled.code === 'compile.notSql' ? undefined : compiled.code, compiled.params);
                return await this.runStatement(compiled.query, statement, state);
            } catch (e) {
                placeError(e, statement);
                throw e;
            }
        }
        return await this.expression(statement, state);
    }

    /**
     * Sends one statement to the data port. The `statement` event goes out
     * just before the call (the playground's execution map relies on that
     * order), so it cannot hold the duration. The `timing` event after the
     * call does.
     */
    private async runStatement(query: SqlQuery, origin: AstNode, state: State): Promise<Row[]> {
        const { context, budget } = state;
        budget.beforeStatement();
        context.events?.emit({
            kind: 'statement',
            sql: query.text,
            params: query.params,
            range: origin.$cstNode?.range
        });
        const started = performance.now();
        let rows: Row[];
        try {
            // The port gets the signal, and the run also stops waiting for a port that ignores it.
            rows = await budget.race(Promise.resolve().then(() => context.executor.execute(query, { signal: budget.signal })));
        } catch (e) {
            if (e instanceof RunStopped || e instanceof PortError) throw e;
            // Never the SQL text, and not the driver's message: only a code and the SQLSTATE.
            const failure = dataFailure(e);
            throw new EvalError(failure.message, failure.code, failure.params, e);
        } finally {
            context.events?.emit({
                kind: 'timing',
                phase: 'data',
                durationMs: performance.now() - started
            });
        }
        budget.afterStatement(rows.length);
        return rows;
    }

    // ---- expressions ---------------------------------------------------

    private async expression(expr: Expression, state: State): Promise<MinabValue> {
        // Every step checks the abort signal and the wall time (ADR 0002, section 6).
        state.budget.check();
        try {
            if (this.isRelational(expr, state)) {
                const pushed = await this.pushDown(expr, state);
                if (pushed.pushed) return pushed.value;
            }
            return await this.interpret(expr, state);
        } catch (e) {
            placeError(e, expr);
            throw e;
        }
    }

    /**
     * Compile an expression to SQL and run it. Answers `{pushed:false}`
     * (rather than failing) when the compiler refuses, so the caller can
     * interpret the node instead and push down its parts.
     */
    private async pushDown(expr: Expression, state: State): Promise<{ pushed: true; value: MinabValue } | { pushed: false }> {
        const compiled = this.compiler.compileValue(expr, this.outerResolver(state), this.clockOf(state));
        if (!compiled.ok) return { pushed: false };
        const rows = await this.runStatement(compiled.query, expr, state);
        return {
            pushed: true,
            value: this.readPushed(expr, rows.length > 0 ? rows[0].value : null)
        };
    }

    /** The static scalar type of an expression, when the checker knows it. */
    private staticScalar(expr: Expression): { base: LogicalTypeBase; array: boolean } | undefined {
        if (!this.typeChecker) return undefined;
        try {
            const inferred = this.typeChecker.inferType(expr);
            return inferred.ok && inferred.type.kind === 'scalar' ? { base: inferred.type.base, array: inferred.type.array } : undefined;
        } catch {
            return undefined;
        }
    }

    /** A value that SQL computed: read by the static type of the expression, so a `numeric` (text from the driver) becomes an exact decimal. */
    private readPushed(expr: Expression, value: MinabValue): MinabValue {
        if (!this.typeChecker || value === null || value === undefined) return value;
        let inferred;
        try {
            inferred = this.typeChecker.inferType(expr);
        } catch {
            return value;
        }
        return inferred.ok && inferred.type.kind === 'scalar' ? normalizeIn(value, inferred.type.base, inferred.type.array) : value;
    }

    /**
     * Whether evaluating this expression needs table data the host hasn't
     * already handed us. A record in hand carries its own scalar columns,
     * but nothing about related rows — so any table reference, or any hop
     * across a `ref`/`collection` column, has to reach the database.
     *
     * Deliberately *not* true for operators, even when an operand is
     * relational: pushing down `COUNT(.orders) < 5` whole would compile the
     * `5` and any local field to bare parameters, leaving SQL comparing two
     * untyped placeholders. Pushing down the smallest node that actually
     * needs the database keeps each generated statement grounded in real
     * columns, and keeps the operators themselves under the null/CITEXT
     * rules implemented here.
     */
    private isRelational(expr: Expression, state: State): boolean {
        if (isQuery(expr) || isSubquery(expr) || isNamedScope(expr) || isTableRef(expr)) return true;
        if (isCurrentRecord(expr)) {
            return expr.field !== undefined && this.isRelationColumn(state.currentTable(), expr.field);
        }
        if (isMemberAccess(expr)) {
            if (this.isRelational(expr.receiver, state)) return true;
            const table = this.staticTable(expr.receiver, state);
            return table !== undefined && this.isRelationColumn(table, expr.member);
        }
        if (isFilterAccess(expr)) return this.isRelational(expr.receiver, state);
        if (isCallExpression(expr)) return expr.args.some(a => this.isRelational(a, state));
        return false;
    }

    private isRelationColumn(table: string | undefined, field: string): boolean {
        if (!table) return false;
        const column = this.schema.getColumn(table, field);
        return column !== undefined && column.type.kind !== 'scalar';
    }

    /** The table a receiver's rows come from, when the interpreter can tell without evaluating it. */
    private staticTable(expr: Expression, state: State): string | undefined {
        if (isCurrentRecord(expr)) {
            if (!expr.field) return state.currentTable();
            const column = state.currentTable() ? this.schema.getColumn(state.currentTable()!, expr.field) : undefined;
            return column && column.type.kind !== 'scalar' ? column.type.table : undefined;
        }
        if (isParentRecord(expr)) return state.parentTable();
        if (isNamedScope(expr) || isTableRef(expr)) return this.schema.getTable(expr.name)?.name;
        if (isNameRef(expr)) {
            const input = this.schema.getHostInput(expr.name);
            return input?.kind === 'record' ? input.table : undefined;
        }
        return undefined;
    }

    private async interpret(expr: Expression, state: State): Promise<MinabValue> {
        if (isStringLiteral(expr)) return expr.value;
        if (isNumberLiteral(expr)) return this.numberLiteral(expr);
        if (isBooleanLiteral(expr)) return expr.value === 'true';
        if (isNullLiteral(expr)) return null;
        if (isCurrentRecord(expr)) {
            const record = state.currentRecord();
            if (!expr.field) return record;
            return this.readField(record, expr.field);
        }
        if (isParentRecord(expr)) {
            const parent = state.parentRecord();
            if (!parent) fail('"^" has no enclosing scope here');
            return parent;
        }
        if (isFieldValue(expr)) {
            if (state.context.fieldValue === undefined) fail('"$" was used but the host supplied no field value');
            return this.fieldValue(state);
        }
        if (isMemberAccess(expr)) {
            const receiver = await this.expression(expr.receiver, state);
            return this.readField(receiver, expr.member);
        }
        if (isNameRef(expr)) return state.lookup(expr.name);
        if (isBinaryExpression(expr)) return await this.binary(expr, state);
        if (isUnaryExpression(expr)) {
            const operand = await this.expression(expr.operand, state);
            if (expr.negated) return !this.truthy(operand);
            if (expr.operator === '-') return negate(this.number(operand));
            return this.number(operand);
        }
        if (isListLiteral(expr)) {
            const items: MinabValue[] = [];
            for (const item of expr.items) items.push(await this.expression(item, state));
            return items;
        }
        if (isJsonObjectLiteral(expr)) {
            const object: Record<string, MinabValue> = {};
            for (const property of expr.properties) {
                // Numbers inside a JSON value are JSON numbers (D17).
                object[property.key] = jsonNumber(property.value ? await this.expression(property.value, state) : state.lookup(property.key));
            }
            return object;
        }
        if (isCallExpression(expr)) return await this.builtin(expr, state);
        if (isIfExpr(expr)) {
            if (this.truthy(await this.expression(expr.condition, state))) {
                return await this.expression(expr.thenBranch, state);
            }
            if (expr.elseIf) return await this.expression(expr.elseIf, state);
            if (expr.elseBranch) return await this.expression(expr.elseBranch, state);
            return null;
        }
        if (isSwitchExpr(expr)) return await this.switchExpr(expr, state);
        if (isBlock(expr)) return await this.block(expr, state);
        if (isTypeTestExpression(expr)) {
            const value = await this.expression(expr.value, state);
            const matches = this.jsonKindMatches(value, expr.test);
            return expr.operator === 'is' ? matches : !matches;
        }
        if (isCastExpr(expr)) {
            const value = await this.expression(expr.value, state);
            const operand = this.staticScalar(expr.value);
            return castValue(
                value,
                {
                    base: expr.targetType.base as LogicalTypeBase,
                    array: !!expr.targetType.array
                },
                operand?.base,
                operand?.array,
                state.context.timeZone
            );
        }
        if (isTupleAccess(expr)) {
            const receiver = await this.expression(expr.receiver, state);
            if (!Array.isArray(receiver)) fail('a positional index needs an array (spec §3.5)');
            return receiver[expr.index] ?? null;
        }
        if (isFilterAccess(expr)) {
            const receiver = await this.expression(expr.receiver, state);
            if (!Array.isArray(receiver)) fail('a filter needs a collection');
            // The rows of a table have no position (spec §3.5): only an array source sets `.$index`.
            return await this.filterArray(receiver, expr.filter, state, !this.isRelational(expr.receiver, state));
        }
        if (isGroupKeyRef(expr)) fail('KEY is only meaningful inside a grouped query, which runs as SQL');
        if (isIndexRef(expr)) {
            const index = state.currentIndex();
            if (index === undefined) fail(coded('eval.indexNeedsArray').reason, 'eval.indexNeedsArray');
            return index;
        }
        if (isTupleLiteral(expr)) {
            // A tuple is an array of fixed size; `[n]` reads a position.
            const items: MinabValue[] = [];
            for (const item of expr.items) items.push(await this.expression(item, state));
            return items;
        }
        fail(`"${expr.$type}" is not evaluated yet (Phase 5 scope)`);
    }

    private async filterArray(rows: MinabValue[], filter: Expression, state: State, indexed = true): Promise<MinabValue[]> {
        const kept: MinabValue[] = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const frame: Frame = {
                record: row as Row,
                table: undefined,
                variables: new Map(),
                types: new Map(),
                index: indexed ? i : undefined
            };
            if (this.truthy(await this.expression(filter, state.push(frame)))) kept.push(row);
        }
        return kept;
    }

    private async switchExpr(expr: SwitchExpr, state: State): Promise<MinabValue> {
        const subject = await this.expression(expr.subject, state);
        for (const branch of expr.cases) {
            for (const value of branch.values) {
                if (this.equal(subject, await this.expression(value, state), false)) {
                    return await this.expression(branch.result, state);
                }
            }
        }
        return await this.expression(expr.defaultResult, state);
    }

    private async callFunction(name: string, args: Expression[], state: State): Promise<MinabValue> {
        const declaration = state.functions.get(name);
        if (!declaration) fail(`unknown function "${name}"`);
        if (declaration.params.length !== args.length) {
            fail(`${name} takes ${declaration.params.length} argument(s), got ${args.length}`);
        }
        const variables = new Map<string, MinabValue>();
        const types = new Map<string, Type>();
        for (let i = 0; i < args.length; i++) {
            const param = declaration.params[i];
            variables.set(param.name, this.coerce(param.type, await this.expression(args[i], state)));
            types.set(param.name, param.type);
        }
        const leave = state.budget.enterCall();
        try {
            const inner = state.push({
                record: state.currentRecord(),
                table: state.currentTable(),
                variables,
                types
            });
            await this.runStatements(declaration.body, inner);
            if (!declaration.tail) fail(`${name} has no tail expression to return`);
            return this.coerce(declaration.returnType, await this.mainStatement(declaration.tail, inner));
        } finally {
            leave();
        }
    }

    // ---- statements (X3) ------------------------------------------------

    /** A block: its own scope, its statements in order, then its tail (or `null`). */
    private async block(block: Block, state: State): Promise<MinabValue> {
        const inner = state.push({ variables: new Map(), types: new Map(), scopeOnly: true });
        await this.runStatements(block.statements, inner);
        return block.tail ? await this.mainStatement(block.tail, inner) : null;
    }

    /** Runs statements in order in the innermost scope of `state`. X5 and X6 add writes. */
    private async runStatements(statements: BodyStatement[], state: State): Promise<void> {
        for (const statement of statements) {
            state.budget.check();
            try {
                if (isVariableDecl(statement)) {
                    const frame = state.frames[0];
                    frame.variables.set(statement.name, statement.value ? this.coerce(statement.type, await this.expression(statement.value, state)) : null);
                    frame.types.set(statement.name, statement.type);
                } else if (isAssignmentStatement(statement)) {
                    await this.assign(statement, state);
                } else if (isCallStatement(statement)) {
                    // A call that stands alone: the value is dropped (D19).
                    await this.expression(statement.call, state);
                } else if (isIfStatement(statement)) {
                    await this.ifStatement(statement, state);
                } else if (isLoopStatement(statement)) {
                    await this.loop(statement, state);
                } else if (isBreakStatement(statement)) {
                    throw new LoopSignal('break', statement.label);
                } else if (isContinueStatement(statement)) {
                    throw new LoopSignal('continue', statement.label);
                } else {
                    fail(`"${statement.$type}" is not executed yet`);
                }
            } catch (e) {
                placeError(e, statement);
                throw e;
            }
        }
    }

    // ---- loops (X4) -----------------------------------------------------

    /**
     * A loop (§9.4). Every step, also a skipped one, counts toward `limits.loopIterations`.
     * Each step runs in a new frame. The loop gives no value: the tail of the body is dropped.
     */
    private async loop(loop: LoopStatement, state: State): Promise<void> {
        const step = async (frame: Frame): Promise<'next' | 'stop'> => {
            state.budget.countIteration();
            const inner = state.push(frame);
            if (loop.whereClause && !this.truthy(await this.expression(loop.whereClause.condition, inner))) return 'next';
            try {
                await this.runStatements(loop.statements, inner);
                if (loop.tail) await this.mainStatement(loop.tail, inner);
            } catch (e) {
                // An unlabeled signal belongs to the innermost loop; a labeled one to the loop with that label.
                if (e instanceof LoopSignal && (e.label === undefined || e.label === loop.label)) return e.kind === 'break' ? 'stop' : 'next';
                throw e;
            }
            return 'next';
        };
        const names = (value?: MinabValue): Frame => ({
            variables: new Map(loop.variable ? [[loop.variable, value ?? null]] : []),
            types: new Map(),
            scopeOnly: true
        });

        if (loop.lowerBound && loop.upperBound) {
            const from = this.loopInteger(await this.expression(loop.lowerBound, state));
            const to = this.loopInteger(await this.expression(loop.upperBound, state));
            const by = loop.stepClause ? this.loopInteger(await this.expression(loop.stepClause.step, state)) : 1;
            if (by <= 0) fail('the step of a loop must be a positive whole number');
            for (let i = from; i <= to; i += by) {
                if ((await step(names(i))) === 'stop') return;
            }
        } else if (loop.iterable) {
            const { source, table, relational } = await this.loopSource(loop.iterable, state);
            if (source === null) return;
            if (!Array.isArray(source)) fail('a loop needs an array or a collection to go through');
            for (let i = 0; i < source.length; i++) {
                const frame: Frame = {
                    record: source[i] as Row,
                    table,
                    variables: new Map(loop.variable ? [[loop.variable, source[i]]] : []),
                    types: new Map(),
                    index: relational ? undefined : i
                };
                if ((await step(frame)) === 'stop') return;
            }
        } else if (loop.condition) {
            while (this.truthy(await this.expression(loop.condition, state))) {
                if ((await step(names())) === 'stop') return;
            }
        }
    }

    /**
     * What a for-in loop goes through. A collection over a table is read once, as rows, with one
     * statement; the loop then runs in memory. Anything else is an ordinary value (an array).
     */
    private async loopSource(iterable: Expression, state: State): Promise<{ source: MinabValue; table?: string; relational: boolean }> {
        if (this.isRelational(iterable, state)) {
            const compiled = this.compiler.compileRows(iterable, this.outerResolver(state), this.clockOf(state));
            if (compiled.ok) {
                const rows = await this.runStatement(compiled.query, iterable, state);
                return { source: rows.map(row => this.normalizeRecord(row, compiled.table)), table: compiled.table, relational: true };
            }
        }
        return { source: await this.expression(iterable, state), relational: false };
    }

    /** A loop bound or step: a whole number. */
    private loopInteger(value: MinabValue): number {
        const numeric = this.number(value);
        if (typeof numeric !== 'number' || !Number.isInteger(numeric)) fail('the bounds and the step of a loop must be whole numbers');
        return numeric;
    }

    /** `if!`: the first branch whose condition is true runs. A branch is a block; its tail value is dropped. */
    private async ifStatement(statement: IfStatement | IfStatementElse, state: State): Promise<void> {
        let branch: IfStatement | IfStatementElse | undefined = statement;
        while (branch) {
            if (this.truthy(await this.expression(branch.condition, state))) {
                await this.block(branch.thenBranch as Block, state);
                return;
            }
            if (branch.elseBranch) {
                await this.block(branch.elseBranch as Block, state);
                return;
            }
            branch = branch.elseIf;
        }
    }

    /** Assignment to a local name. Any other target is a write, and writes come with X5 and X6. */
    private async assign(statement: AssignmentStatement, state: State): Promise<void> {
        const target = statement.target;
        const frame = isNameRef(target) ? state.frameOf(target.name) : undefined;
        if (!isNameRef(target) || !frame) {
            fail(coded('eval.writesNotSupported').reason, 'eval.writesNotSupported');
        }
        const name = target.name;
        const type = frame.types.get(name);
        const current = frame.variables.get(name) ?? null;
        const operator = statement.operator;
        let next: MinabValue;
        if (operator === '?=') {
            if (current !== null) return;
            next = await this.expression(statement.value, state);
        } else {
            const value = await this.expression(statement.value, state);
            if (operator === '=') next = value;
            else if (operator === '|=') next = this.merge(current, value);
            else if (operator === '+=' && this.isTextAssign(current, value, type))
                next = current === null || value === null ? null : String(current) + String(value);
            else next = arithmetic(operator.slice(0, 1) as Arithmetic, this.number(current), this.number(value));
        }
        frame.variables.set(name, type ? this.coerce(type, next) : next);
    }

    /** `+=` joins texts (D13). With two `null`s, the declared type decides. */
    private isTextAssign(current: MinabValue, value: MinabValue, type: Type | undefined): boolean {
        if (typeof current === 'string' || typeof value === 'string') return true;
        return current === null && value === null && type !== undefined && isTypeRef(type) && !type.array && (type.base === 'TEXT' || type.base === 'CITEXT');
    }

    /** `|=` on a `JSON` local: the keys of the object on the right replace or join the keys on the left. A `null` is an empty object. */
    private merge(current: MinabValue, value: MinabValue): MinabValue {
        const isObject = (v: MinabValue): v is Record<string, MinabValue> => typeof v === 'object' && v !== null && !Array.isArray(v);
        if (current !== null && !isObject(current)) fail('"|=" needs a JSON object on the left');
        if (!isObject(value)) fail('"|=" needs an object on the right');
        return { ...current, ...value };
    }

    /** A host function runs in the host, with the values of its arguments. Never in SQL. */
    private async callHostFunction(name: string, args: Expression[], state: State): Promise<MinabValue> {
        const { hostFunctions } = state.context;
        const { budget } = state;
        if (!hostFunctions) fail(coded('eval.hostFunctionMissing', { name }).reason, 'eval.hostFunctionMissing', { name });
        const values: MinabValue[] = [];
        for (const arg of args) values.push(await this.expression(arg, state));
        budget.check();
        try {
            // The run stops waiting at its wall time, also when the function ignores the signal.
            return await budget.race(Promise.resolve().then(() => hostFunctions.call(name, values, { signal: budget.signal })));
        } catch (e) {
            if (e instanceof RunStopped) throw e;
            // The text of the host's error stays with the host: it may hold personal data.
            throw new EvalError(coded('eval.hostFunctionFailed', { name }).reason, 'eval.hostFunctionFailed', { name }, e);
        }
    }

    // ---- built-ins over in-memory collections ---------------------------

    private async builtin(expr: CallExpression, state: State): Promise<MinabValue> {
        const callee = expr.callee;
        if (!isNameRef(callee)) fail('only a named function can be called');
        if (!isBuiltinName(callee.name)) {
            if (!state.functions.has(callee.name) && this.schema.getHostFunction(callee.name)) {
                return await this.callHostFunction(callee.name, expr.args, state);
            }
            return await this.callFunction(callee.name, expr.args, state);
        }
        const builtin = getBuiltin(callee.name)!;
        if (builtin.kind !== 'scalar') {
            if (expr.args.length !== 1) fail(`${builtin.name} takes one argument`);
            const values = await this.expression(expr.args[0], state);
            const items = Array.isArray(values) ? values : values === null ? [] : [values];
            return this.runBuiltin(builtin, [items], [], state);
        }
        const values: MinabValue[] = [];
        for (const arg of expr.args) values.push(await this.expression(arg, state));
        // A function without `nullPropagates: false` gives `null` for a `null` argument (spec §7.7).
        if (builtin.nullPropagates !== false && values.some(v => v === null || v === undefined)) return null;
        const info = expr.args.map((arg): BuiltinArgInfo => {
            const base = this.staticScalar(arg);
            return {
                citext: this.isCitextArg(arg, state),
                base: base && !base.array ? base.base : undefined,
                literal: isStringLiteral(arg) ? arg.value : undefined
            };
        });
        const answer = this.runBuiltin(builtin, values, info, state);
        if (builtin.logs) this.log(expr, values, state);
        return answer;
    }

    /**
     * `LOG(value, label?)`: keeps the entry in the run result and sends a `log` event, unless the run
     * already has `logEntries` entries (D36). The value itself goes back to the caller unchanged.
     */
    private log(expr: AstNode, values: MinabValue[], state: State): void {
        const value = externalize(values[0]);
        const label = typeof values[1] === 'string' ? values[1] : undefined;
        const message = formatLogMessage(value, label);
        const time = state.budget.addLog(message);
        if (time === undefined) return;
        state.context.events?.emit({ kind: 'log', message, value, ...(label === undefined ? {} : { label }), range: expr.$cstNode?.range, time });
    }

    private runBuiltin(builtin: BuiltinSignature, args: MinabValue[], info: BuiltinArgInfo[], state: State): MinabValue {
        try {
            return builtin.evaluate(args, info, this.clockOf(state)) as MinabValue;
        } catch (e) {
            if (e instanceof BuiltinError) fail(e.message);
            throw e;
        }
    }

    /** True when the argument is `CITEXT`: by its inferred type, or (without a checker) when it is a `CITEXT` column. */
    private isCitextArg(expr: Expression, state: State): boolean {
        if (this.typeChecker) {
            try {
                const inferred = this.typeChecker.inferType(expr);
                if (inferred.ok) return inferred.type.kind === 'scalar' && !inferred.type.array && inferred.type.base === 'CITEXT';
            } catch {
                // fall through to the column check
            }
        }
        return this.isCitext(expr, state);
    }

    // ---- operators ------------------------------------------------------

    private async binary(expr: BinaryExpression, state: State): Promise<MinabValue> {
        const operator = expr.operator;
        if (operator === 'AND') {
            return this.truthy(await this.expression(expr.left, state)) ? this.truthy(await this.expression(expr.right, state)) : false;
        }
        if (operator === 'OR') {
            return this.truthy(await this.expression(expr.left, state)) ? true : this.truthy(await this.expression(expr.right, state));
        }

        const left = await this.expression(expr.left, state);
        const right = await this.expression(expr.right, state);

        if (operator === '==' || operator === '!=') {
            const caseInsensitive = this.isCaseInsensitive(expr, state);
            const equal = this.equal(left, right, caseInsensitive);
            return operator === '==' ? equal : !equal;
        }
        if (operator === 'IN') {
            const items = Array.isArray(right) ? right : fail('IN needs a collection on the right');
            const caseInsensitive = this.isCitextArg(expr.left, state) || this.isCitextElements(expr.right, state);
            return items.some(i => this.equal(left, i, caseInsensitive));
        }
        if (operator === 'LIKE') {
            if (left === null || right === null) fail('LIKE is not a valid operator against null (spec §7.7)');
            return this.like(String(left), String(right), this.isCaseInsensitive(expr, state));
        }
        if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
            if (left === null || right === null) {
                fail(`"${operator}" is not a valid operator against null (spec §7.7)`);
            }
            const exact = decimalCompare(left, right);
            const folded = exact === undefined && typeof left === 'string' && typeof right === 'string' && this.isCaseInsensitive(expr, state);
            const a = folded ? (left as string).toLowerCase() : (exact ?? (left as number));
            const b = folded ? (right as string).toLowerCase() : exact === undefined ? (right as number) : 0;
            switch (operator) {
                case '<':
                    return a < b;
                case '<=':
                    return a <= b;
                case '>':
                    return a > b;
                default:
                    return a >= b;
            }
        }
        if (operator !== '+' && operator !== '-' && operator !== '*' && operator !== '/' && operator !== '%' && operator !== '\\') {
            fail(`operator "${operator}" is not evaluated yet`);
        }
        if (operator === '+' && this.isTextSum(expr, left, right)) {
            return left === null || right === null ? null : String(left) + String(right);
        }
        const a = this.number(left);
        const b = this.number(right);
        return arithmetic(operator as Arithmetic, a, b);
    }

    /** `+` joins texts (D13). A `null` side gives `null`. */
    private isTextSum(expr: BinaryExpression, left: MinabValue, right: MinabValue): boolean {
        if (typeof left === 'string' || typeof right === 'string') return true;
        if (left !== null || right !== null || !this.typeChecker) return false;
        try {
            const inferred = this.typeChecker.inferType(expr);
            return inferred.ok && inferred.type.kind === 'scalar' && inferred.type.base === 'TEXT';
        } catch {
            return false;
        }
    }

    /**
     * Minab's `==`/`!=` are total and null-safe (spec §7.7): `null == null`
     * is `true`, not SQL's `UNKNOWN`. That falls out of host-language
     * equality for free — `CITEXT` is the one case that doesn't, since a
     * case-insensitive column compares case-insensitively in SQL and would
     * otherwise silently disagree here (ADR 0001).
     */
    private equal(left: MinabValue, right: MinabValue, caseInsensitive: boolean): boolean {
        if (left === null || right === null) return left === right;
        if (caseInsensitive && typeof left === 'string' && typeof right === 'string') {
            return left.toLowerCase() === right.toLowerCase();
        }
        if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
        return decimalEqual(left, right) ?? left === right;
    }

    /** True when either side of a comparison is a `CITEXT` column. */
    private isCaseInsensitive(expr: BinaryExpression, state: State): boolean {
        return this.isCitextArg(expr.left, state) || this.isCitextArg(expr.right, state);
    }

    /** True when the right side of `IN` is a `CITEXT` array (D15). */
    private isCitextElements(expr: Expression, state: State): boolean {
        if (isListLiteral(expr)) return expr.items.some(item => this.isCitextArg(item, state));
        if (!this.typeChecker) return false;
        try {
            const inferred = this.typeChecker.inferType(expr);
            return inferred.ok && inferred.type.kind === 'scalar' && inferred.type.array && inferred.type.base === 'CITEXT';
        } catch {
            return false;
        }
    }

    private isCitext(expr: Expression, state: State): boolean {
        const table = isCurrentRecord(expr) ? state.currentTable() : isMemberAccess(expr) ? this.staticTable(expr.receiver, state) : undefined;
        const field = isCurrentRecord(expr) ? expr.field : isMemberAccess(expr) ? expr.member : undefined;
        if (!table || !field) return false;
        const column = this.schema.getColumn(table, field);
        return column?.type.kind === 'scalar' && column.type.type.base === 'CITEXT';
    }

    /**
     * `LIKE` as in Postgres (spec §7.2): `%` is any run, `_` is one character,
     * `\` makes the next character plain. With `ignoreCase` (a `CITEXT` side,
     * D15) both sides are lower-cased first.
     */
    private like(value: string, pattern: string, ignoreCase: boolean): boolean {
        const text = Array.from(ignoreCase ? value.toLowerCase() : value);
        const pat = Array.from(ignoreCase ? pattern.toLowerCase() : pattern);
        return likeMatch(text, 0, pat, 0) === 'true';
    }

    /** Traversal through a `null` propagates `null` unconditionally (spec §7.7 rule 1) — no error, no opt-in operator. */
    private readField(receiver: MinabValue, field: string): MinabValue {
        if (receiver === null || receiver === undefined) return null;
        if (typeof receiver !== 'object') fail(`"${field}" accessed on a non-record value`);
        const value = (receiver as Row)[field];
        return value === undefined ? null : value;
    }

    private jsonKindMatches(value: MinabValue, test: Expression): boolean {
        if (isNullLiteral(test)) return value === null;
        switch (test.$type) {
            case 'ArrayKind':
                return Array.isArray(value);
            case 'ObjectKind':
                return typeof value === 'object' && value !== null && !Array.isArray(value);
            case 'StringKind':
                return typeof value === 'string';
            case 'NumberKind':
                return typeof value === 'number';
            case 'BooleanKind':
                return typeof value === 'boolean';
            default:
                return false;
        }
    }

    private truthy(value: MinabValue): boolean {
        if (typeof value === 'boolean') return value;
        if (value === null || value === undefined) return false;
        fail('expected a boolean');
    }

    /** A value that meets a declared type: a `DECIMAL` slot holds a `Big`, even when the value is a whole number (`let x: DECIMAL = 5`). */
    private coerce(type: Type, value: MinabValue): MinabValue {
        if (isTypeRef(type)) return normalizeIn(value, type.base, type.array);
        if (Array.isArray(value) && value.length === type.elementTypes.length) return value.map((item, i) => this.coerce(type.elementTypes[i], item));
        return value;
    }

    /** A number operand: an `INTEGER` (a number) or a `DECIMAL` (a `Big`). Number text from a driver is read as one of them. */
    private number(value: MinabValue): Numeric {
        const numeric = toNumeric(value);
        if (numeric === undefined) fail('expected a number');
        return numeric;
    }

    /** A number literal reads its own text, so `0.30` and 20-digit numbers are not rounded by JavaScript. */
    private numberLiteral(expr: { value: number; $cstNode?: { text: string } }): Numeric {
        // The first item of a tuple shares its syntax node with the tuple, so the text can start with "(".
        return literal(expr.$cstNode?.text.replace(/^[\s(]+/, '') ?? String(expr.value));
    }

    /** `$`: the value the host supplied. A number with a fraction is a `DECIMAL`. */
    private fieldValue(state: State): MinabValue {
        const value = state.context.fieldValue;
        return typeof value === 'number' && !Number.isInteger(value) ? (toNumeric(value) ?? value) : value;
    }

    // ---- the SQL seam ---------------------------------------------------

    /**
     * How the compiler gets at values this interpreter holds. Anything the
     * compiler finds reaching outside the statement it's building lands
     * here, is evaluated in memory, and comes back as a bind parameter —
     * which is what makes a correlated `#Table` check one parameterized
     * lookup rather than a table scan.
     */
    private outerResolver(state: State): OuterResolver {
        const guard = <T>(produce: () => T): { found: true; value: T } | { found: false; reason: string } => {
            try {
                return { found: true, value: produce() };
            } catch (e) {
                if (e instanceof EvalError) return { found: false, reason: e.message };
                throw e;
            }
        };
        return {
            resolve: (expr: Expression, depth: number) => guard(() => this.outerValue(expr, state, depth)),
            resolveRecord: (frameIndex: number) => {
                const result = guard(() => this.outerRecord(state, frameIndex));
                return result.found ? { found: true, record: result.value } : result;
            }
        };
    }

    private outerRecord(state: State, frameIndex: number): OuterRecord {
        const frame = state.frame(frameIndex);
        if (!frame?.record) fail('no record in scope');
        if (!frame.table) fail('the host did not say which table the record under validation belongs to');
        const primaryKey = this.schema.getTable(frame.table)?.primaryKey;
        if (!primaryKey) fail(`the schema does not say which column identifies a row of "${frame.table}" (set primaryKey)`);
        return {
            table: frame.table,
            key: this.readField(frame.record, primaryKey)
        };
    }

    /**
     * `depth` is how many levels the compiled statement had already pushed
     * (see `OuterResolver`). The combined scope stack is the compiler's
     * levels on top of this interpreter's frames, so a sigil that escapes
     * the compiled region lands `depth` frames higher than it would have
     * with no compiled region at all: `.` means stack[0] and `^` means
     * stack[1], which are frames `0 - depth` and `1 - depth` here.
     */
    private outerValue(expr: Expression, state: State, depth: number): MinabValue {
        if (isCurrentRecord(expr) || isParentRecord(expr)) {
            const frame = state.frame(isParentRecord(expr) ? 1 - depth : -depth);
            if (!frame?.record) fail('no record in scope');
            if (isParentRecord(expr) || !expr.field) fail('a record has no scalar value — use one of its fields');
            return this.readField(frame.record, expr.field);
        }
        if (isMemberAccess(expr)) {
            const receiver = expr.receiver;
            // `^.room_id` — the field belongs to the escaping record itself,
            // so read it straight off that frame.
            const base = isParentRecord(receiver)
                ? (state.frame(1 - depth)?.record ?? null)
                : isCurrentRecord(receiver) && !receiver.field
                  ? (state.frame(-depth)?.record ?? null)
                  : this.outerValue(receiver, state, depth);
            return this.readField(base, expr.member);
        }
        if (isFieldValue(expr)) {
            if (state.context.fieldValue === undefined) fail('"$" was used but the host supplied no field value');
            return this.fieldValue(state);
        }
        if (isNameRef(expr)) return state.lookup(expr.name);
        if (isStringLiteral(expr)) return expr.value;
        if (isNumberLiteral(expr)) return this.numberLiteral(expr);
        fail(`"${expr.$type}" cannot be evaluated outside the query`);
    }
}

/** Evaluation state: the runtime scope stack (spec §2.2), the declared functions, and the host's context. */
class State {
    constructor(
        readonly context: EvalContext,
        readonly budget: RunBudget,
        readonly frames: Frame[],
        readonly functions: Map<string, FunctionDecl>,
        private readonly readHostInput: (name: string) => MinabValue
    ) {}

    /** The frames that stand for a record scope (spec §2.2). A block's scope is not one. */
    private get recordFrames(): Frame[] {
        return this.frames.filter(frame => !frame.scopeOnly);
    }

    push(frame: Frame): State {
        return new State(this.context, this.budget, [frame, ...this.frames], this.functions, this.readHostInput);
    }

    /** Frame `n` levels out, innermost first. A negative index would name a level inside a compiled statement, which this interpreter doesn't hold. */
    frame(index: number): Frame | undefined {
        return index < 0 ? undefined : this.recordFrames[index];
    }

    currentRecord(): Row | undefined {
        return this.recordFrames[0]?.record;
    }

    currentTable(): string | undefined {
        return this.recordFrames[0]?.table;
    }

    /** `.$index`: the position of `.` when it comes from an array. `undefined` for the rows of a table. */
    currentIndex(): number | undefined {
        return this.recordFrames[0]?.index;
    }

    parentRecord(): Row | undefined {
        return this.recordFrames[1]?.record;
    }

    parentTable(): string | undefined {
        return this.recordFrames[1]?.table;
    }

    /** The innermost frame that holds this local name. */
    frameOf(name: string): Frame | undefined {
        return this.frames.find(frame => frame.variables.has(name));
    }

    lookup(name: string): MinabValue {
        for (const frame of this.frames) {
            if (frame.variables.has(name)) return frame.variables.get(name)!;
        }
        return this.readHostInput(name);
    }
}
