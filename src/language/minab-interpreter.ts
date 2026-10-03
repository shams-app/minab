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
 * Deliberately not implemented in Phase 5 (each fails with an explicit
 * reason rather than a wrong answer): loops (§9.4), `INSERT`/`UPDATE`/
 * `DELETE` execution (§10), and `.$index` (§3.5). ADR 0001 covers how
 * writes execute; building them is the next increment, not this one.
 */

import {
    isBinaryExpression,
    isBlock,
    isBooleanLiteral,
    isCallExpression,
    isCastExpr,
    isCurrentRecord,
    isFieldValue,
    isFilterAccess,
    isFunctionDecl,
    isGroupKeyRef,
    isIfExpr,
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
    type BinaryExpression,
    type Expression,
    type FunctionDecl,
    type MainStatement,
    type Model,
    type SwitchExpr,
    type Type
} from './generated/ast.js';
import { isBuiltinName } from './minab-builtins.js';
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

/** The structured result of `MinabInterpreter.run` (R4). `evaluate` keeps the old shape. */
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
    /**
     * Kept until R8 moves the playground to `events`. Same moment as the
     * `statement` event, but it hands over the AST node instead of the range.
     *
     * Called just before each statement goes to the executor, with the AST
     * node it was compiled from — the whole `Query` for a query program,
     * or the smallest subexpression pushed down for a rule. The executor
     * only ever sees SQL; this is how a host shows *which part* of the
     * source reached the database and which was answered in memory.
     */
    onStatement?: (query: SqlQuery, origin: AstNode) => void;
}

class EvalError extends Error {
    /** The node that failed. The innermost expression sets it. */
    range?: SourceRange;

    constructor(
        reason: string,
        readonly code?: string,
        readonly params?: Record<string, string | number>,
        /** The original error, when a port failed. The old `evaluate` entry throws it again. */
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

function fail(reason: string, code?: string, params?: Record<string, string | number>): never {
    throw new EvalError(reason, code, params);
}

/** One level of the spec §2.2 scope stack, at runtime: what `.` means here, and what names are bound. */
interface Frame {
    record?: Row;
    table?: string;
    variables: Map<string, MinabValue>;
}

export class MinabInterpreter {
    constructor(
        private readonly schema: SchemaProvider,
        private readonly compiler: MinabSqlCompiler,
        private readonly typeChecker?: MinabTypeChecker
    ) {}

    /**
     * The old entry, kept until R7 and R8 move the CLI and the playground to `PreparedProgram.run`.
     * It turns the structured result of `run` into the old shape. A port failure is thrown again, as before.
     *
     * @deprecated Use `run` (or `PreparedProgram.run`). Remove it in R8, or in whichever of R7 and R8 merges last.
     */
    async evaluate(model: Model, context: EvalContext): Promise<EvalResult> {
        const result = await this.run(model, context);
        if (result.ok) return result;
        if (result.cause !== undefined) throw result.cause;
        const { error } = result;
        // The old shape has no code for a plain failure.
        if (error.code === 'eval.failed') return { ok: false, reason: error.message };
        return { ok: false, reason: error.message, code: error.code, params: error.params };
    }

    /**
     * Runs a program. A program failure, a limit and a cancel come back as `{ ok: false, error }`
     * with a code. Only a bug in Minab throws.
     */
    async run(model: Model, context: EvalContext): Promise<InterpretResult> {
        const ownBudget = context.budget === undefined;
        const budget = context.budget ?? new RunBudget(NO_LIMITS, context.signal);
        const state = new State(context, budget, [], this.collectFunctions(model), name => this.readHostInput(name, context));
        try {
            state.frames.push({
                record: this.normalizeRecord(context.record, context.recordTable),
                table: context.recordTable,
                variables: new Map()
            });
            budget.check();
            for (const declaration of model.declarations) {
                if (isVariableDecl(declaration)) {
                    const value = declaration.value ? this.coerce(declaration.type, await this.expression(declaration.value, state)) : null;
                    state.frames[0].variables.set(declaration.name, value);
                } else if (!isFunctionDecl(declaration)) {
                    fail(`"${declaration.$type}" is not executed yet (Phase 5 covers queries and validation rules)`);
                }
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

    /** An error thrown inside a run, as a structured result. A bug (anything else) is thrown again. */
    private failure(e: unknown): InterpretResult {
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
                const compiled = this.compiler.compileQuery(statement, this.outerResolver(state));
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
        context.onStatement?.(query, origin);
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
        const compiled = this.compiler.compileValue(expr, this.outerResolver(state));
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
        if (isBlock(expr)) {
            if (expr.statements.length > 0) fail('statements inside a block are not executed yet (Phase 5 covers expressions)');
            return expr.tail ? await this.mainStatement(expr.tail, state) : null;
        }
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
                operand?.array
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
            return await this.filterArray(receiver, expr.filter, state);
        }
        if (isGroupKeyRef(expr)) fail('KEY is only meaningful inside a grouped query, which runs as SQL');
        if (isIndexRef(expr)) fail('".$index" is not evaluated yet (Phase 5 scope)');
        fail(`"${expr.$type}" is not evaluated yet (Phase 5 scope)`);
    }

    private async filterArray(rows: MinabValue[], filter: Expression, state: State): Promise<MinabValue[]> {
        const kept: MinabValue[] = [];
        for (const row of rows) {
            const frame: Frame = {
                record: row as Row,
                table: undefined,
                variables: new Map()
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
        for (let i = 0; i < args.length; i++) {
            variables.set(declaration.params[i].name, this.coerce(declaration.params[i].type, await this.expression(args[i], state)));
        }
        const leave = state.budget.enterCall();
        try {
            const inner = state.push({
                record: state.currentRecord(),
                table: state.currentTable(),
                variables
            });
            for (const statement of declaration.body) {
                if (!isVariableDecl(statement)) {
                    fail(`"${statement.$type}" inside a function body is not executed yet (Phase 5 scope)`);
                }
                variables.set(statement.name, statement.value ? this.coerce(statement.type, await this.expression(statement.value, inner)) : null);
            }
            if (!declaration.tail) fail(`${name} has no tail expression to return`);
            return this.coerce(declaration.returnType, await this.mainStatement(declaration.tail, inner));
        } finally {
            leave();
        }
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

    private async builtin(expr: { callee: Expression; args: Expression[] }, state: State): Promise<MinabValue> {
        const callee = expr.callee;
        if (!isNameRef(callee)) fail('only a named function can be called');
        if (!isBuiltinName(callee.name)) {
            if (!state.functions.has(callee.name) && this.schema.getHostFunction(callee.name)) {
                return await this.callHostFunction(callee.name, expr.args, state);
            }
            return await this.callFunction(callee.name, expr.args, state);
        }
        const values = await this.expression(expr.args[0], state);
        const items = Array.isArray(values) ? values : values === null ? [] : [values];
        switch (callee.name) {
            case 'COUNT':
                return items.length;
            case 'EXISTS':
                return items.length > 0;
            case 'ALL':
                return items.every(i => this.truthy(i));
            case 'ANY':
                return items.some(i => this.truthy(i));
            case 'SUM':
                return this.sum(items);
            case 'AVG':
                return items.length === 0 ? null : arithmetic('/', this.sum(items), items.length);
            case 'MIN':
                return items.length === 0 ? null : items.map(i => this.number(i)).reduce((a, b) => (this.compareNumbers(b, a) < 0 ? b : a));
            case 'MAX':
                return items.length === 0 ? null : items.map(i => this.number(i)).reduce((a, b) => (this.compareNumbers(b, a) > 0 ? b : a));
            default:
                fail(`built-in "${callee.name}" is not evaluated yet`);
        }
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
            return items.some(i => this.equal(left, i, false));
        }
        if (operator === 'LIKE') {
            if (left === null || right === null) fail('LIKE is not a valid operator against null (spec §7.7)');
            return this.like(String(left), String(right));
        }
        if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
            if (left === null || right === null) {
                fail(`"${operator}" is not a valid operator against null (spec §7.7)`);
            }
            const exact = decimalCompare(left, right);
            const a = exact ?? (left as number);
            const b = exact === undefined ? (right as number) : 0;
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
        if (operator !== '+' && operator !== '-' && operator !== '*' && operator !== '/' && operator !== '%') {
            fail(`operator "${operator}" is not evaluated yet`);
        }
        const a = this.number(left);
        const b = this.number(right);
        if (operator === '+' && typeof left === 'string') return String(left) + String(right);
        return arithmetic(operator as Arithmetic, a, b);
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
        return this.isCitext(expr.left, state) || this.isCitext(expr.right, state);
    }

    private isCitext(expr: Expression, state: State): boolean {
        const table = isCurrentRecord(expr) ? state.currentTable() : isMemberAccess(expr) ? this.staticTable(expr.receiver, state) : undefined;
        const field = isCurrentRecord(expr) ? expr.field : isMemberAccess(expr) ? expr.member : undefined;
        if (!table || !field) return false;
        const column = this.schema.getColumn(table, field);
        return column?.type.kind === 'scalar' && column.type.type.base === 'CITEXT';
    }

    private like(value: string, pattern: string): boolean {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`).test(value);
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

    private compareNumbers(a: Numeric, b: Numeric): number {
        return decimalCompare(a, b) ?? (a as number) - (b as number);
    }

    /** `SUM` is exact: `INTEGER` items give an `INTEGER`, any `DECIMAL` item gives a `DECIMAL`. */
    private sum(items: MinabValue[]): Numeric {
        return items.reduce((total: Numeric, i) => arithmetic('+', total, this.number(i)), 0);
    }

    /** A number literal reads its own text, so `0.30` and 20-digit numbers are not rounded by JavaScript. */
    private numberLiteral(expr: { value: number; $cstNode?: { text: string } }): Numeric {
        return literal(expr.$cstNode?.text ?? String(expr.value));
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

    push(frame: Frame): State {
        return new State(this.context, this.budget, [frame, ...this.frames], this.functions, this.readHostInput);
    }

    /** Frame `n` levels out, innermost first. A negative index would name a level inside a compiled statement, which this interpreter doesn't hold. */
    frame(index: number): Frame | undefined {
        return index < 0 ? undefined : this.frames[index];
    }

    currentRecord(): Row | undefined {
        return this.frames[0]?.record;
    }

    currentTable(): string | undefined {
        return this.frames[0]?.table;
    }

    parentRecord(): Row | undefined {
        return this.frames[1]?.record;
    }

    parentTable(): string | undefined {
        return this.frames[1]?.table;
    }

    lookup(name: string): MinabValue {
        for (const frame of this.frames) {
            if (frame.variables.has(name)) return frame.variables.get(name)!;
        }
        return this.readHostInput(name);
    }
}
