/**
 * SQL compilation (roadmap Phase 5, ADR 0001) — the relational half of the
 * hybrid execution strategy.
 *
 * Compiles the parts of Minab that *are* relational algebra: a `Query`
 * pipeline (spec §4), an ad-hoc `#Table` scope (§3.3), a relation
 * traversal (§3.1), and the built-in aggregates/predicates over either
 * (§5.3.1), plus `if`/`switch` (as `CASE`), `is`/`isnot` and JSON literals.
 * Everything else — user functions, loops, tuples, statements in a block — is
 * deliberately *not* compiled here; it belongs to `MinabInterpreter`, and
 * this compiler answers `{ok:false, reason}` for it rather than inventing
 * a SQL encoding. That refusal is load-bearing: it's how the interpreter
 * knows to evaluate a node itself and push down only its relational parts.
 *
 * Two rules from the spec drive most of the non-obvious codegen here:
 *
 *  - **Null-safe equality (§7.7).** A user-written `==`/`!=` compiles to
 *    `IS NOT DISTINCT FROM`/`IS DISTINCT FROM`, never `=`/`<>`, because
 *    Minab's equality is total (`null == null` is `true`) where SQL's is
 *    three-valued. Join predicates the *compiler itself* synthesizes are
 *    the opposite case and use plain `=` — see `refSubquery`.
 *  - **Null propagation through a `ref` (§7.7 rule 1).** `.customer.name`
 *    compiles to a correlated scalar subquery rather than a join, so a
 *    null FK yields `NULL` instead of dropping the row the way an inner
 *    join would.
 *
 * Errors are thrown internally as `CompileError` and converted to the
 * `{ok, reason}` union at the public entry points — same discriminated
 * union the rest of the codebase uses, without threading a Result type
 * through every recursive call.
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
    isGroupKeyRef,
    isIfExpr,
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
    isTypeTestExpression,
    isUnaryExpression,
    type BinaryExpression,
    type CallExpression,
    type Expression,
    type IfExpr,
    type JsonObjectLiteral,
    type ListLiteral,
    type NameRef,
    type NumberLiteral,
    type Query,
    type SwitchExpr,
    type TypeRef,
    type TypeTestExpression,
    type UnaryExpression
} from './generated/ast.js';
import { coded, type DiagnosticCode, type DiagnosticParams, type ParamsArgs } from './diagnostics/codes.js';
import { isBuiltinName } from './minab-builtins.js';
import type { SqlQuery } from './minab-executor.js';
import { sqlParameter } from './values.js';
import type { LogicalTypeBase } from './minab-types.js';
import type { MinabColumnSchema, SchemaProvider } from './schema.js';

/** A refusal has an English `reason`. When the refusal has a stable code (see the registry), `code` and `params` come with it. */
export type SqlResult = { ok: true; query: SqlQuery } | { ok: false; reason: string; code?: DiagnosticCode; params?: DiagnosticParams };

/** A row held outside the statement being compiled: its identity (all SQL can compare against — see spec §6.1's `. != ^`) plus the table it belongs to, so its relations can still be followed. */
export interface OuterRecord {
    table?: string;
    key: unknown;
}

/**
 * How the compiler asks its caller for anything it can't express in SQL
 * itself. `MinabInterpreter` implements this with its own runtime scope
 * stack: an escaping `^`/`^.field`/`$`/variable is evaluated in memory and
 * bound as a query parameter, which is exactly how a correlated check
 * inside an interpreted validation rule stays one indexed lookup.
 *
 * `depth` is how many scope-stack levels (spec §2.2) the compiled
 * statement had pushed at the point of the reference. The caller needs it
 * to land on the right frame: the full stack is the compiler's levels
 * stacked on top of the caller's, so a `^` escaping from `depth` 1 means
 * the caller's innermost record, and from `depth` 0 means the one above
 * that.
 */
export interface OuterResolver {
    /** A scalar the caller already holds (`^.field`, `$`, a `let` variable), to bind as a parameter. */
    resolve(expr: Expression, depth: number): { found: true; value: unknown } | { found: false; reason: string };
    /** The record `frameIndex` levels outside the compiled statement, innermost first. */
    resolveRecord(frameIndex: number): { found: true; record: OuterRecord } | { found: false; reason: string };
}

const NO_OUTER_REASON = 'reaches outside the query being compiled, with no enclosing runtime scope to supply it';

export const NO_OUTER_SCOPE: OuterResolver = {
    resolve: () => ({ found: false, reason: NO_OUTER_REASON }),
    resolveRecord: () => ({ found: false, reason: NO_OUTER_REASON })
};

class CompileError extends Error {
    constructor(
        reason: string,
        readonly code?: DiagnosticCode,
        readonly params?: DiagnosticParams
    ) {
        super(reason);
    }
}

function fail(reason: string): never {
    throw new CompileError(reason);
}

/** A refusal with a stable code from the registry. */
function failCoded<C extends DiagnosticCode>(code: C, ...args: ParamsArgs<C>): never {
    const message = coded(code, ...args);
    throw new CompileError(message.reason, code, message.params);
}

interface NamedEntry {
    alias: string;
    table: string;
}

interface SqlScope {
    /** The SQL alias qualifying bare `.field` at this level. */
    alias: string;
    table: string;
    /** `FROM ... AS x` / `JOIN ... AS y` names, reachable as `x.field` or `#x`. */
    named: Map<string, NamedEntry>;
    /** Set once a `GROUPBY` is in effect, so `KEY` has something to resolve to. */
    groupKeys?: Expression[];
    /** For each group key that walks a relation: the SQL of the joined column it groups by. */
    groupKeySql?: Map<Expression, string>;
    /** The `LEFT JOIN` clauses those keys need, in order. */
    groupJoins?: string[];
    /** `SELECT ... AS n` names, which `ORDERBY` may reference by name. */
    selectAliases?: Set<string>;
}

/** A reference to a *row*, as opposed to a scalar value. */
type RowRef =
    | { kind: 'scope'; alias: string; table: string }
    | { kind: 'key'; table: string; keyExpr: string }
    | { kind: 'outer'; table: string | undefined; keyExpr: string };

/** A table to read rows from, plus every predicate that narrows it — the shape every aggregate/`EXISTS` subquery is built from. */
interface CollectionSource {
    table: string;
    alias: string;
    predicates: string[];
}

const SQL_TYPES: Record<LogicalTypeBase, string> = {
    TEXT: 'text',
    CITEXT: 'citext',
    INTEGER: 'integer',
    DECIMAL: 'numeric',
    BOOLEAN: 'boolean',
    DATE: 'date',
    TIME: 'time',
    DATETIME: 'timestamp',
    UUID: 'uuid',
    JSON: 'jsonb'
};

const COMPARISONS: Record<string, string> = {
    '==': 'IS NOT DISTINCT FROM',
    '!=': 'IS DISTINCT FROM',
    '<': '<',
    '<=': '<=',
    '>': '>',
    '>=': '>=',
    LIKE: 'LIKE'
};

/** The `jsonb_typeof` name of each kind that `is` / `isnot` can test, besides `null` (spec §5.6). */
const JSON_KINDS: Record<string, string> = {
    ArrayKind: 'array',
    ObjectKind: 'object',
    StringKind: 'string',
    NumberKind: 'number',
    BooleanKind: 'boolean'
};

const ARITHMETIC: Record<string, string> = {
    '+': '+',
    '-': '-',
    '*': '*',
    '/': '/',
    '%': '%'
};

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

export class MinabSqlCompiler {
    constructor(private readonly schema: SchemaProvider) {}

    /** Compile a pipeline `Query` (spec §4) to a full `SELECT`. */
    compileQuery(query: Query, outer: OuterResolver = NO_OUTER_SCOPE): SqlResult {
        return this.run(ctx => this.query(query, ctx, []), outer);
    }

    /**
     * Compile a single expression as a one-row, one-column `SELECT` —
     * how the interpreter pushes down a relational subexpression
     * (`EXISTS(#Booking[...])`, `COUNT(.orders[...])`, a scalar subquery)
     * and reads one value back.
     */
    compileValue(expr: Expression, outer: OuterResolver = NO_OUTER_SCOPE): SqlResult {
        return this.run(ctx => `SELECT ${this.expression(expr, ctx, [])} AS "value"`, outer);
    }

    private run(build: (ctx: Ctx) => string, outer: OuterResolver = NO_OUTER_SCOPE): SqlResult {
        const ctx = new Ctx(outer);
        try {
            const text = build(ctx);
            return { ok: true, query: { text, params: ctx.params } };
        } catch (e) {
            if (e instanceof CompileError) {
                return e.code ? { ok: false, reason: e.message, code: e.code, params: e.params } : { ok: false, reason: e.message };
            }
            throw e;
        }
    }

    // ---- query ---------------------------------------------------------

    private query(query: Query, ctx: Ctx, outerScopes: SqlScope[]): string {
        const source = this.querySource(query, ctx, outerScopes);
        const scope = this.scopeOf(query, source);
        const scopes = [scope, ...outerScopes];
        this.joinGroupKeys(query, scope, ctx, scopes);

        // Compiled in SQL's own textual order so `$1`, `$2`, ... read left
        // to right in the emitted statement.
        const select = this.selectClause(query, ctx, scopes);
        const from = this.fromClause(query, scope, ctx, scopes);
        // A related collection brings its own predicates (`<fk> = <outer key>`, `[filter]`). The user's WHERE follows them.
        const predicates = [...source.predicates, ...(query.whereClause ? [this.expression(query.whereClause.condition, ctx, scopes)] : [])];
        const where = predicates.length > 0 ? ` WHERE ${predicates.join(' AND ')}` : '';
        const groupBy = query.groupByClause ? ` GROUP BY ${query.groupByClause.keys.map(k => this.groupKey(k, ctx, scopes)).join(', ')}` : '';
        const having = query.havingClause ? ` HAVING ${this.expression(query.havingClause.condition, ctx, scopes)}` : '';
        const orderBy = query.orderByClause
            ? ` ORDER BY ${query.orderByClause.items
                  .map(i => `${this.expression(i.expression, ctx, scopes)}${i.direction === 'DESC' ? ' DESC' : ''}`)
                  .join(', ')}`
            : '';
        const limit = query.limitClause
            ? ` LIMIT ${query.limitClause.limit}${query.limitClause.offset !== undefined ? ` OFFSET ${query.limitClause.offset}` : ''}`
            : '';

        return `${select}${from}${where}${groupBy}${having}${orderBy}${limit}`;
    }

    private scopeOf(query: Query, source: CollectionSource): SqlScope {
        const { table, alias } = source;
        const named = new Map<string, NamedEntry>([[alias, { alias, table }]]);
        // `FROM .orders[...] AS o`: the user's name and the generated alias are the same row.
        if (query.alias) named.set(query.alias, { alias, table });
        for (const join of query.joins) {
            const joinTable = this.table(join.source).name;
            named.set(join.alias, { alias: join.alias, table: joinTable });
        }
        const scope: SqlScope = { alias, table, named };
        if (query.groupByClause) {
            scope.groupKeys = query.groupByClause.keys;
        }
        scope.selectAliases = new Set((query.selectClause?.items ?? []).flatMap(i => (i.alias ? [i.alias] : [])));
        return scope;
    }

    /**
     * The table a query reads, the alias that names its rows, and the predicates that narrow them
     * (none for a plain table). The predicates of a related collection bind their parameters here,
     * before the SELECT list, so in that one form `$n` does not follow the text order.
     */
    private querySource(query: Query, ctx: Ctx, outerScopes: SqlScope[]): CollectionSource {
        const source = query.source;
        if (isTableRef(source) || isNamedScope(source)) {
            const table = this.table(source.name).name;
            return { table, alias: query.alias ?? table, predicates: [] };
        }
        // `FROM .orders` or `FROM .orders[.status == "x"]` — a collection field on an enclosing record.
        return this.collectionSource(source, ctx, outerScopes);
    }

    private fromClause(query: Query, scope: SqlScope, ctx: Ctx, scopes: SqlScope[]): string {
        const physical = this.sqlTable(scope.table);
        const source = scope.alias === physical ? ` FROM ${quoteIdent(physical)}` : ` FROM ${quoteIdent(physical)} AS ${quoteIdent(scope.alias)}`;
        const joins = query.joins.map(join => {
            const keyword = join.cross ? 'CROSS JOIN' : join.left ? 'LEFT JOIN' : 'JOIN';
            const target = `${quoteIdent(this.sqlTable(join.source))} AS ${quoteIdent(join.alias)}`;
            if (join.cross) return ` ${keyword} ${target}`;
            if (!join.condition) fail(`"${join.alias}" is joined without an ON condition`);
            return ` ${keyword} ${target} ON ${this.expression(join.condition, ctx, scopes)}`;
        });
        return source + joins.join('') + (scope.groupJoins ?? []).join('');
    }

    /**
     * A `GROUPBY` key such as `.customer.country` walks a relation. A
     * subquery per use would not match the `GROUP BY` expression (Postgres
     * rejects it as an ungrouped column), so each hop becomes one `LEFT JOIN`
     * and the key is the joined column. `LEFT` keeps rows whose relation is
     * null: they form one `null` group (spec §7.7 rule 1).
     */
    private joinGroupKeys(query: Query, scope: SqlScope, ctx: Ctx, scopes: SqlScope[]): void {
        for (const key of query.groupByClause?.keys ?? []) {
            const path: string[] = [];
            let base: Expression = key;
            while (isMemberAccess(base)) {
                path.unshift(base.member);
                base = base.receiver;
            }
            let row: { alias: string; table: string } | undefined;
            if (isCurrentRecord(base) && base.field && scopes.length > 0) {
                path.unshift(base.field);
                row = { alias: scope.alias, table: scope.table };
            } else if (isNameRef(base) || isNamedScope(base)) {
                row = this.lookupNamed(base.name, [scope]);
            }
            if (!row || path.length < 2) continue;
            let current = row;
            const joins: string[] = [];
            for (const field of path.slice(0, -1)) {
                const column = this.columnSchema(current.table, field);
                if (column.type.kind !== 'ref') break;
                const target = this.table(column.type.table).name;
                const alias = ctx.freshGroupAlias();
                joins.push(
                    ` LEFT JOIN ${quoteIdent(target)} AS ${quoteIdent(alias)} ON ${quoteIdent(alias)}.${quoteIdent(this.primaryKey(target))} = ${quoteIdent(current.alias)}.${quoteIdent(this.refForeignKey(current.table, column))}`
                );
                current = { alias, table: target };
            }
            if (joins.length !== path.length - 1) continue;
            const last = this.columnSchema(current.table, path[path.length - 1]);
            if (last.type.kind !== 'scalar') continue;
            (scope.groupJoins ??= []).push(...joins);
            (scope.groupKeySql ??= new Map()).set(key, `${quoteIdent(current.alias)}.${quoteIdent(path[path.length - 1])}`);
        }
    }

    /** A `GROUPBY` key as SQL: the joined column when `joinGroupKeys` made one, else the plain expression. */
    private groupKey(key: Expression, ctx: Ctx, scopes: SqlScope[]): string {
        return scopes[0]?.groupKeySql?.get(key) ?? this.expression(key, ctx, scopes);
    }

    private selectClause(query: Query, ctx: Ctx, scopes: SqlScope[]): string {
        const clause = query.selectClause;
        if (!clause || clause.all || clause.items.length === 0) {
            return `SELECT ${clause?.distinct ? 'DISTINCT ' : ''}${this.star(scopes[0])}`;
        }
        const items = clause.items.map(item => {
            const sql = this.expression(item.expression, ctx, scopes);
            const alias = item.alias ?? this.renamedField(item.expression, ctx, scopes);
            return alias ? `${sql} AS ${quoteIdent(alias)}` : sql;
        });
        return `SELECT ${clause.distinct ? 'DISTINCT ' : ''}${items.join(', ')}`;
    }

    /**
     * The Minab name of a bare field in a `SELECT` item without `AS`, when
     * the column's `sqlName` is different. Without this alias the row would
     * come back keyed by the physical name.
     */
    private renamedField(expr: Expression, ctx: Ctx, scopes: SqlScope[]): string | undefined {
        const field = isCurrentRecord(expr) ? expr.field : isMemberAccess(expr) ? expr.member : undefined;
        if (!field) return undefined;
        const table = isCurrentRecord(expr) ? this.currentTable(ctx, scopes) : this.staticTable(expr, ctx, scopes);
        const column = table ? this.schema.getColumn(table, field) : undefined;
        return column?.type.kind === 'scalar' && column.sqlName !== undefined && column.sqlName !== column.name ? column.name : undefined;
    }

    /**
     * `*`. A row must keep Minab names as keys, so when a column has a
     * `sqlName` the columns are listed with `AS <Minab name>`. Otherwise
     * plain `*` is the same and shorter.
     */
    private star(scope: SqlScope): string {
        const entries = [...scope.named.values()];
        const renamed = entries.some(e => this.table(e.table).columns.some(c => c.type.kind === 'scalar' && c.sqlName !== undefined && c.sqlName !== c.name));
        if (!renamed) return '*';
        return entries
            .flatMap(e =>
                this.table(e.table).columns.flatMap(c => {
                    if (c.type.kind === 'collection') return [];
                    if (c.type.kind === 'ref') return c.type.foreignKey ? [`${quoteIdent(e.alias)}.${quoteIdent(c.type.foreignKey)}`] : [];
                    return [`${quoteIdent(e.alias)}.${quoteIdent(c.sqlName ?? c.name)} AS ${quoteIdent(c.name)}`];
                })
            )
            .join(', ');
    }

    // ---- expressions ---------------------------------------------------

    /** A literal with a fraction is a `DECIMAL`: it is bound as its own text, so Postgres reads it exactly (D17). */
    private numberLiteralValue(expr: NumberLiteral): number | string {
        const text = expr.$cstNode?.text;
        return text?.includes('.') ? text : expr.value;
    }

    private expression(expr: Expression, ctx: Ctx, scopes: SqlScope[]): string {
        if (isStringLiteral(expr)) return ctx.bind(expr.value);
        if (isNumberLiteral(expr)) return ctx.bind(this.numberLiteralValue(expr));
        if (isBooleanLiteral(expr)) return expr.value === 'true' ? 'TRUE' : 'FALSE';
        if (isNullLiteral(expr)) return 'NULL';
        if (isBinaryExpression(expr)) return this.binary(expr, ctx, scopes);
        if (isUnaryExpression(expr)) return this.unary(expr, ctx, scopes);
        if (isCallExpression(expr)) return this.call(expr, ctx, scopes);
        if (isCastExpr(expr)) {
            return `CAST(${this.expression(expr.value, ctx, scopes)} AS ${this.sqlType(expr.targetType)})`;
        }
        if (isSubquery(expr)) return `(${this.query(expr.query, ctx, scopes)})`;
        if (isIfExpr(expr)) return this.ifExpr(expr, ctx, scopes);
        if (isSwitchExpr(expr)) return this.switchExpr(expr, ctx, scopes);
        if (isBlock(expr)) return this.branch(expr, ctx, scopes);
        if (isTypeTestExpression(expr)) return this.typeTest(expr, ctx, scopes);
        if (isJsonObjectLiteral(expr)) return this.jsonObject(expr, ctx, scopes);
        if (isListLiteral(expr)) return this.jsonArray(expr, ctx, scopes);
        // `$` (spec §6.2) is always the host's, never a column: the value
        // of the field under validation, bound as a parameter.
        if (isFieldValue(expr)) return this.outerScalar(expr, ctx, scopes.length);
        if (isCurrentRecord(expr) || isMemberAccess(expr) || isGroupKeyRef(expr) || isNameRef(expr)) {
            return this.fieldOrOuter(expr, ctx, scopes);
        }
        if (isParentRecord(expr) || isNamedScope(expr)) {
            fail(`"${expr.$type}" refers to a record, not a value — use one of its fields`);
        }
        fail(`"${expr.$type}" has no SQL form (it belongs to the interpreted layer)`);
    }

    // ---- if, switch, is, JSON literals (spec §5.6, §7.3, §9) -------------

    /** `if c { a } else { b }` is `CASE WHEN c THEN a ELSE b END`. Without `else`, the answer is `NULL`. */
    private ifExpr(expr: IfExpr, ctx: Ctx, scopes: SqlScope[]): string {
        const condition = this.expression(expr.condition, ctx, scopes);
        const then = this.branch(expr.thenBranch, ctx, scopes);
        const otherwise = expr.elseIf ?? expr.elseBranch;
        const fallback = otherwise ? this.branch(otherwise, ctx, scopes) : 'NULL';
        return `CASE WHEN ${condition} THEN ${then} ELSE ${fallback} END`;
    }

    /**
     * `switch s { a => x, _ => d }` is `CASE s WHEN a THEN x ELSE d END`.
     * A `null` case value cannot use that form (`= NULL` never matches),
     * so a switch with one uses `CASE WHEN s IS NULL THEN …` for every arm.
     * An arm with several values becomes several `WHEN`s with one result.
     */
    private switchExpr(expr: SwitchExpr, ctx: Ctx, scopes: SqlScope[]): string {
        const subject = this.expression(expr.subject, ctx, scopes);
        const searched = expr.cases.some(arm => arm.values.some(isNullLiteral));
        const arms: string[] = [];
        for (const arm of expr.cases) {
            for (const value of arm.values) {
                const when = !searched
                    ? this.expression(value, ctx, scopes)
                    : isNullLiteral(value)
                      ? `${subject} IS NULL`
                      : `${subject} = ${this.expression(value, ctx, scopes)}`;
                // The result is compiled again for each value, so `$n` follows the text order.
                arms.push(`WHEN ${when} THEN ${this.branch(arm.result, ctx, scopes)}`);
            }
        }
        const fallback = this.branch(expr.defaultResult, ctx, scopes);
        return `CASE${searched ? '' : ` ${subject}`} ${arms.join(' ')} ELSE ${fallback} END`;
    }

    /**
     * The result of an `if` or `switch` arm. A block with statements has no SQL
     * form: a statement cannot run inside a query. A block with only a tail is its tail.
     * A literal result gets its type (`$1::text`), because `CASE` over bare parameters
     * would read them as text.
     */
    private branch(expr: Expression, ctx: Ctx, scopes: SqlScope[]): string {
        if (isBlock(expr)) {
            if (expr.statements.length > 0) failCoded('compile.blockInQuery');
            if (!expr.tail) fail('a block with no tail expression has no value');
            return isQuery(expr.tail) ? `(${this.query(expr.tail, ctx, scopes)})` : this.branch(expr.tail, ctx, scopes);
        }
        return this.typedValue(expr, ctx, scopes);
    }

    /** Text and number literals carry their type; everything else compiles as usual. */
    private typedValue(expr: Expression, ctx: Ctx, scopes: SqlScope[]): string {
        if (isStringLiteral(expr)) return `${ctx.bind(expr.value)}::text`;
        if (isNumberLiteral(expr)) return `${ctx.bind(expr.value)}::numeric`;
        return this.expression(expr, ctx, scopes);
    }

    /** `x is null` is `x IS NULL`. The other kinds read `jsonb_typeof`, and a `null` answers `false` (`isnot`: `true`), as in the interpreter. */
    private typeTest(expr: TypeTestExpression, ctx: Ctx, scopes: SqlScope[]): string {
        const value = this.expression(expr.value, ctx, scopes);
        const is = expr.operator === 'is';
        if (isNullLiteral(expr.test)) return `(${value} IS ${is ? '' : 'NOT '}NULL)`;
        const kind = JSON_KINDS[expr.test.$type];
        if (!kind) fail(`"${expr.test.$type}" is not a JSON kind`);
        return `(jsonb_typeof(${value}) IS ${is ? 'NOT ' : ''}DISTINCT FROM '${kind}')`;
    }

    private jsonObject(expr: JsonObjectLiteral, ctx: Ctx, scopes: SqlScope[]): string {
        const pairs = expr.properties.flatMap(property => {
            // `{ id }` is `{ id: id }`: the value is the variable of that name.
            const value = property.value ?? ({ $type: 'NameRef', name: property.key } as NameRef);
            return [`${ctx.bind(property.key)}::text`, this.typedValue(value, ctx, scopes)];
        });
        return `jsonb_build_object(${pairs.join(', ')})`;
    }

    private jsonArray(expr: ListLiteral, ctx: Ctx, scopes: SqlScope[]): string {
        return `jsonb_build_array(${expr.items.map(item => this.typedValue(item, ctx, scopes)).join(', ')})`;
    }

    /**
     * A `.field`/`alias.field`/`KEY.field` chain, or — when its base
     * reaches outside this statement — a bound parameter carrying the
     * value the caller already has in memory.
     */
    private fieldOrOuter(expr: Expression, ctx: Ctx, scopes: SqlScope[]): string {
        if (isNameRef(expr)) {
            // An `ORDERBY` item naming a `SELECT ... AS n` column.
            if (scopes[0]?.selectAliases?.has(expr.name)) return quoteIdent(expr.name);
            if (this.lookupNamed(expr.name, scopes)) {
                fail(`"${expr.name}" refers to a record, not a value — use one of its fields`);
            }
            return this.outerScalar(expr, ctx, scopes.length);
        }
        if (isCurrentRecord(expr)) {
            if (!expr.field) fail('a bare "." refers to a record, not a value');
            if (scopes.length === 0) return this.outerScalar(expr, ctx, scopes.length);
            return this.column({ kind: 'scope', alias: scopes[0].alias, table: scopes[0].table }, expr.field, ctx);
        }
        if (isGroupKeyRef(expr)) {
            const keys = scopes[0]?.groupKeys;
            if (!keys) fail('KEY is only valid after a GROUPBY clause');
            if (keys.length !== 1) fail('KEY over a multi-key GROUPBY has no single SQL form');
            return this.groupKey(keys[0], ctx, scopes);
        }
        if (isMemberAccess(expr)) {
            const mark = ctx.mark();
            const receiver = this.rowRef(expr.receiver, ctx, scopes);
            // A scalar field of a record the *caller* holds (`^.room_id`)
            // is already in memory — bind it rather than emitting a
            // subquery to fetch back something we were handed.
            const inMemory = receiver?.kind === 'outer' && this.columnSchema(this.tableOf(receiver), expr.member).type.kind === 'scalar';
            if (!receiver || inMemory) {
                ctx.reset(mark);
                return this.outerScalar(expr, ctx, scopes.length);
            }
            return this.column(receiver, expr.member, ctx);
        }
        fail(`"${expr.$type}" is not a field reference`);
    }

    /**
     * The row an expression denotes, or `undefined` when it escapes this
     * statement entirely (the caller then asks the `OuterResolver` for the
     * whole chain as a value, rather than trying to build SQL around a row
     * SQL can't see).
     */
    private rowRef(expr: Expression, ctx: Ctx, scopes: SqlScope[]): RowRef | undefined {
        if (isCurrentRecord(expr)) {
            const base: RowRef = scopes.length === 0 ? this.outerRow(0, ctx) : { kind: 'scope', alias: scopes[0].alias, table: scopes[0].table };
            return expr.field ? this.follow(base, expr.field, ctx) : base;
        }
        if (isParentRecord(expr)) {
            if (scopes.length < 2) {
                return this.outerRow(1 - scopes.length, ctx);
            }
            return { kind: 'scope', alias: scopes[1].alias, table: scopes[1].table };
        }
        if (isNamedScope(expr) || isNameRef(expr)) {
            const named = this.lookupNamed(expr.name, scopes);
            if (named) return { kind: 'scope', alias: named.alias, table: named.table };
            if (isNamedScope(expr)) {
                // `#Table` with no alias of that name in scope: spec §3.3's
                // "opens the whole table," which is a collection, not a row.
                fail(`"#${expr.name}" opens a whole table — use it inside an aggregate, EXISTS, or a filter`);
            }
            return undefined;
        }
        if (isMemberAccess(expr)) {
            const receiver = this.rowRef(expr.receiver, ctx, scopes);
            if (!receiver) return undefined;
            return this.follow(receiver, expr.member, ctx);
        }
        if (isGroupKeyRef(expr)) {
            const keys = scopes[0]?.groupKeys;
            if (!keys) fail('KEY is only valid after a GROUPBY clause');
            if (keys.length !== 1) fail('KEY over a multi-key GROUPBY has no single SQL form');
            return this.rowRef(keys[0], ctx, scopes);
        }
        return undefined;
    }

    /**
     * Step from a row onto one of its `ref` columns — the related row,
     * identified by the FK value. Answers `undefined` for a scalar column,
     * which is a *value*, not a row: that distinction is what keeps
     * `.room_id == ^.room_id` an ordinary comparison rather than an
     * identity comparison between two things that aren't records.
     */
    private follow(receiver: RowRef, field: string, ctx: Ctx): RowRef | undefined {
        const table = this.tableOf(receiver);
        if (this.columnSchema(table, field).type.kind !== 'ref') return undefined;
        return { kind: 'key', table: this.refTable(table, field), keyExpr: this.column(receiver, field, ctx) };
    }

    private refTable(table: string, field: string): string {
        const column = this.columnSchema(table, field);
        if (column.type.kind !== 'ref') fail(`"${field}" is not a reference`);
        return column.type.table;
    }

    /** A scalar column off a row: a direct qualified reference when the row is a real SQL alias, a correlated scalar subquery when the row is only identified by a key. */
    private column(row: RowRef, field: string, ctx: Ctx): string {
        const table = this.tableOf(row);
        const schema = this.columnSchema(table, field);
        if (schema.type.kind === 'collection') {
            fail(`"${field}" is a collection — use it inside an aggregate, EXISTS, or a filter (spec §3.4)`);
        }
        const name = schema.type.kind === 'ref' ? this.refForeignKey(table, schema) : (schema.sqlName ?? schema.name);
        if (row.kind === 'scope') {
            return `${quoteIdent(row.alias)}.${quoteIdent(name)}`;
        }
        return this.refSubquery({ table, keyExpr: row.keyExpr }, name, ctx);
    }

    private tableOf(row: RowRef): string {
        if (row.kind === 'outer' && !row.table) {
            fail('the host did not say which table the enclosing record belongs to');
        }
        return row.table as string;
    }

    /**
     * `(SELECT <alias>.<column> FROM <table> AS <alias> WHERE <alias>.<pk> = <key>)`.
     *
     * A subquery rather than a join because spec §7.7 rule 1 makes
     * traversal through a null `ref` evaluate to `null` — an inner join
     * would drop the row instead. The `=` here is the compiler's own join
     * predicate, not a user-written `==`, so it stays plain: a null FK
     * must match nothing, which is precisely SQL's default behavior and
     * the opposite of what `IS NOT DISTINCT FROM` would do.
     */
    private refSubquery(row: { table: string; keyExpr: string }, column: string, ctx: Ctx): string {
        const alias = ctx.freshAlias();
        const pk = this.primaryKey(row.table);
        return `(SELECT ${quoteIdent(alias)}.${quoteIdent(column)} FROM ${quoteIdent(this.sqlTable(row.table))} AS ${quoteIdent(alias)} WHERE ${quoteIdent(alias)}.${quoteIdent(pk)} = ${row.keyExpr})`;
    }

    private binary(expr: BinaryExpression, ctx: Ctx, scopes: SqlScope[]): string {
        const op = expr.operator;
        if (op === 'AND' || op === 'OR') {
            return `(${this.expression(expr.left, ctx, scopes)} ${op} ${this.expression(expr.right, ctx, scopes)})`;
        }
        if (op === 'IN') {
            return `${this.expression(expr.left, ctx, scopes)} IN ${this.inList(expr.right, ctx, scopes)}`;
        }
        if (op === '==' || op === '!=') {
            const identity = this.identityComparison(expr, ctx, scopes);
            if (identity) return identity;
        }
        const comparison = COMPARISONS[op];
        if (comparison) {
            return `${this.expression(expr.left, ctx, scopes)} ${comparison} ${this.expression(expr.right, ctx, scopes)}`;
        }
        const arithmetic = ARITHMETIC[op];
        if (arithmetic) {
            return `(${this.expression(expr.left, ctx, scopes)} ${arithmetic} ${this.expression(expr.right, ctx, scopes)})`;
        }
        fail(`operator "${op}" has no SQL form`);
    }

    /**
     * `. != ^` (spec §6.1) compares two *records*, which SQL can only do
     * by their identity — so both sides compile to their primary key.
     * Returns `undefined` when neither side is a record, leaving ordinary
     * value comparison to the caller.
     */
    private identityComparison(expr: BinaryExpression, ctx: Ctx, scopes: SqlScope[]): string | undefined {
        const mark = ctx.mark();
        const left = this.rowRef(expr.left, ctx, scopes);
        const right = this.rowRef(expr.right, ctx, scopes);
        if (!left && !right) {
            ctx.reset(mark);
            return undefined;
        }
        if (!left || !right) {
            fail('cannot compare a record against a value — compare one of its fields instead');
        }
        const op = expr.operator === '==' ? 'IS NOT DISTINCT FROM' : 'IS DISTINCT FROM';
        return `${this.identity(left)} ${op} ${this.identity(right)}`;
    }

    private identity(row: RowRef): string {
        if (row.kind === 'scope') return `${quoteIdent(row.alias)}.${quoteIdent(this.primaryKey(row.table))}`;
        return row.keyExpr;
    }

    private inList(right: Expression, ctx: Ctx, scopes: SqlScope[]): string {
        if (isListLiteral(right)) {
            return `(${right.items.map(i => this.expression(i, ctx, scopes)).join(', ')})`;
        }
        if (isSubquery(right)) {
            return `(${this.query(right.query, ctx, scopes)})`;
        }
        fail('IN is compiled only against a list literal or a subquery');
    }

    private unary(expr: UnaryExpression, ctx: Ctx, scopes: SqlScope[]): string {
        const operand = this.expression(expr.operand, ctx, scopes);
        if (expr.negated) return `(NOT ${operand})`;
        return `(${expr.operator}${operand})`;
    }

    // ---- built-in functions (spec §5.3.1) -------------------------------

    private call(expr: CallExpression, ctx: Ctx, scopes: SqlScope[]): string {
        const callee = expr.callee;
        if (isNameRef(callee) && this.schema.getHostFunction(callee.name)) {
            // A host function is the host's code. Emitting `name(...)` would call a database function of that name.
            failCoded('compile.hostFunctionInSql', { name: callee.name });
        }
        if (!isNameRef(callee) || !isBuiltinName(callee.name)) {
            // A user `fn` runs in the interpreter. Emitting `name(...)` would call a database function of that name: a wrong answer.
            fail(
                isNameRef(callee)
                    ? `"${callee.name}" is a user function — it has no SQL form (it belongs to the interpreted layer)`
                    : 'only the built-in aggregate/predicate functions have a SQL form'
            );
        }
        const name = callee.name;
        const arg = expr.args[0];
        if (!arg) fail(`${name} takes one argument`);

        const source = this.tryCollectionSource(arg, ctx, scopes);
        if (source) {
            return this.aggregateOverSource(name, source, undefined);
        }
        // A broadcast traversal — `SUM(.orders.total)`: the collection is
        // the receiver, the aggregated value a column on its element.
        if (isMemberAccess(arg)) {
            const receiverSource = this.tryCollectionSource(arg.receiver, ctx, scopes);
            if (receiverSource) {
                const inner = { alias: receiverSource.alias, table: receiverSource.table };
                const column = this.column({ kind: 'scope', ...inner }, arg.member, ctx);
                return this.aggregateOverSource(name, receiverSource, column);
            }
        }
        if (name === 'EXISTS' || name === 'ALL' || name === 'ANY') {
            fail(`${name} needs a collection — a table, a relation field, or a filtered one`);
        }
        // An ordinary grouped aggregate over the current query scope.
        const inner = isCurrentRecord(arg) && !arg.field ? '*' : this.expression(arg, ctx, scopes);
        return `${name}(${inner})`;
    }

    private aggregateOverSource(name: string, source: CollectionSource, column: string | undefined): string {
        const from = ` FROM ${quoteIdent(this.sqlTable(source.table))} AS ${quoteIdent(source.alias)}`;
        const where = source.predicates.length > 0 ? ` WHERE ${source.predicates.join(' AND ')}` : '';
        if (name === 'EXISTS') {
            return `EXISTS (SELECT 1${from}${where})`;
        }
        if (name === 'COUNT') {
            return `(SELECT COUNT(${column ?? '*'})${from}${where})`;
        }
        if (name === 'SUM' || name === 'AVG' || name === 'MIN' || name === 'MAX') {
            if (!column) fail(`${name} needs a value to aggregate, e.g. ${name}(.orders.total)`);
            return `(SELECT ${name}(${column})${from}${where})`;
        }
        fail(`${name} has no SQL form yet`);
    }

    /**
     * `collectionSource`, but answering `undefined` when the expression
     * simply isn't a collection (`SUM(.total)` in a grouped query, say).
     * The structural check comes first so that a genuine failure *inside*
     * a real collection — an undeclared foreign key, an unknown column —
     * still surfaces its own reason instead of being flattened into
     * "that isn't a collection".
     */
    private tryCollectionSource(expr: Expression, ctx: Ctx, scopes: SqlScope[]): CollectionSource | undefined {
        if (!this.looksLikeCollection(expr, ctx, scopes)) return undefined;
        return this.collectionSource(expr, ctx, scopes);
    }

    private looksLikeCollection(expr: Expression, ctx: Ctx, scopes: SqlScope[]): boolean {
        if (isTableRef(expr)) return true;
        if (isNamedScope(expr)) return !this.lookupNamed(expr.name, scopes);
        if (isFilterAccess(expr)) return this.looksLikeCollection(expr.receiver, ctx, scopes);
        const field = isCurrentRecord(expr) ? expr.field : isMemberAccess(expr) ? expr.member : undefined;
        if (!field) return false;
        const table = isCurrentRecord(expr) ? this.currentTable(ctx, scopes) : this.staticTable(expr, ctx, scopes);
        if (!table) return false;
        return this.schema.getColumn(table, field)?.type.kind === 'collection';
    }

    /** What `.` ranges over: this statement's innermost scope, or — at the top of a validation rule, where there is none — the caller's record. */
    private currentTable(ctx: Ctx, scopes: SqlScope[]): string | undefined {
        if (scopes.length > 0) return scopes[0].table;
        const resolved = ctx.outer.resolveRecord(0);
        return resolved.found ? resolved.record.table : undefined;
    }

    /** The table a member-access receiver ranges over, as far as the schema alone can tell — enough to spot a collection without compiling anything. */
    private staticTable(expr: Expression, ctx: Ctx, scopes: SqlScope[]): string | undefined {
        if (!isMemberAccess(expr)) return undefined;
        const receiver = expr.receiver;
        if (isCurrentRecord(receiver)) {
            const table = this.currentTable(ctx, scopes);
            if (!table) return undefined;
            if (!receiver.field) return table;
            const column = this.schema.getColumn(table, receiver.field);
            return column && column.type.kind !== 'scalar' ? column.type.table : undefined;
        }
        if (isParentRecord(receiver)) {
            if (scopes.length >= 2) return scopes[1].table;
            const resolved = ctx.outer.resolveRecord(1 - scopes.length);
            return resolved.found ? resolved.record.table : undefined;
        }
        if (isNamedScope(receiver) || isNameRef(receiver)) {
            return this.lookupNamed(receiver.name, scopes)?.table ?? this.schema.getTable(receiver.name)?.name;
        }
        return undefined;
    }

    /** The rows an expression ranges over: a whole table (`#Booking`), a relation field (`.orders`), or either of those filtered (`[...]`). */
    private collectionSource(expr: Expression, ctx: Ctx, scopes: SqlScope[]): CollectionSource {
        if (isNamedScope(expr) && !this.lookupNamed(expr.name, scopes)) {
            return { table: this.table(expr.name).name, alias: ctx.freshAlias(), predicates: [] };
        }
        if (isTableRef(expr)) {
            return { table: this.table(expr.name).name, alias: ctx.freshAlias(), predicates: [] };
        }
        if (isFilterAccess(expr) || isTupleAccess(expr)) {
            if (isTupleAccess(expr)) {
                fail('a positional index is only meaningful on a JSON array, which has no SQL form here (spec §3.5)');
            }
            const source = this.collectionSource(expr.receiver, ctx, scopes);
            const inner: SqlScope = {
                alias: source.alias,
                table: source.table,
                named: new Map([[source.alias, { alias: source.alias, table: source.table }]])
            };
            const predicate = this.expression(expr.filter, ctx, [inner, ...scopes]);
            return { ...source, predicates: [...source.predicates, predicate] };
        }
        if (isCurrentRecord(expr) || isMemberAccess(expr)) {
            return this.relationSource(expr, ctx, scopes);
        }
        fail(`"${expr.$type}" is not a collection`);
    }

    /** A to-many relation field (`.orders`): its own table, correlated back to the owning row. */
    private relationSource(expr: Expression, ctx: Ctx, scopes: SqlScope[]): CollectionSource {
        const field = isCurrentRecord(expr) ? expr.field : isMemberAccess(expr) ? expr.member : undefined;
        if (!field) fail('not a relation field');
        const owner = isCurrentRecord(expr)
            ? scopes.length > 0
                ? ({ kind: 'scope', alias: scopes[0].alias, table: scopes[0].table } as RowRef)
                : this.outerRow(0, ctx)
            : this.rowRef((expr as { receiver: Expression }).receiver, ctx, scopes);
        if (!owner) fail(`"${field}" has no owning row here`);
        const column = this.columnSchema(this.tableOf(owner), field);
        if (column.type.kind !== 'collection') fail(`"${field}" is not a to-many relation`);
        const foreignKey = column.type.foreignKey;
        if (!foreignKey) {
            fail(
                `the schema does not say which column on "${column.type.table}" links back to "${this.tableOf(owner)}" (set foreignKey on the "${field}" column)`
            );
        }
        const alias = ctx.freshAlias();
        const ownerKey = this.identity(owner);
        return {
            table: column.type.table,
            alias,
            predicates: [`${quoteIdent(alias)}.${quoteIdent(foreignKey)} = ${ownerKey}`]
        };
    }

    // ---- schema lookups ------------------------------------------------

    private table(name: string) {
        const table = this.schema.getTable(name);
        if (!table) fail(`unknown table "${name}"`);
        return table;
    }

    private columnSchema(table: string, field: string): MinabColumnSchema {
        const column = this.schema.getColumn(table, field);
        if (!column) fail(`unknown column "${field}" on table "${table}"`);
        return column;
    }

    /** The table's name in the database. */
    private sqlTable(name: string): string {
        const table = this.table(name);
        return table.sqlName ?? table.name;
    }

    /** The physical name of the column that identifies a row (`primaryKey` is a schema column name, so it goes through `sqlName`). */
    private primaryKey(table: string): string {
        const schema = this.table(table);
        const key = schema.primaryKey;
        if (!key) fail(`the schema does not say which column identifies a row of "${table}" (set primaryKey)`);
        const column = schema.columns.find(c => c.name === key);
        return column?.sqlName ?? key;
    }

    private refForeignKey(table: string, column: MinabColumnSchema): string {
        if (column.type.kind !== 'ref') fail(`"${column.name}" is not a relation`);
        const foreignKey = column.type.foreignKey;
        if (!foreignKey) {
            fail(`the schema does not say which column on "${table}" holds the "${column.name}" reference (set foreignKey)`);
        }
        return foreignKey;
    }

    private lookupNamed(name: string, scopes: SqlScope[]): NamedEntry | undefined {
        for (const scope of scopes) {
            const entry = scope.named.get(name);
            if (entry) return entry;
        }
        return undefined;
    }

    private sqlType(type: TypeRef): string {
        const base = SQL_TYPES[type.base as LogicalTypeBase];
        if (!base) fail(`unknown type "${type.base}"`);
        return type.array ? `${base}[]` : base;
    }

    private outerScalar(expr: Expression, ctx: Ctx, depth: number): string {
        const resolved = ctx.outer.resolve(expr, depth);
        if (!resolved.found) fail(resolved.reason);
        return ctx.bind(resolved.value);
    }

    private outerRow(frameIndex: number, ctx: Ctx): RowRef {
        const resolved = ctx.outer.resolveRecord(frameIndex);
        if (!resolved.found) fail(resolved.reason);
        return { kind: 'outer', table: resolved.record.table, keyExpr: ctx.bind(resolved.record.key) };
    }
}

/** Per-compilation mutable state: bound parameters and generated aliases. */
class Ctx {
    readonly params: unknown[] = [];
    private aliasCount = 0;
    private groupCount = 0;

    constructor(readonly outer: OuterResolver) {}

    bind(value: unknown): string {
        this.params.push(sqlParameter(value));
        return `$${this.params.length}`;
    }

    freshGroupAlias(): string {
        return `_g${this.groupCount++}`;
    }

    freshAlias(): string {
        return `_r${this.aliasCount++}`;
    }

    mark(): { params: number; aliases: number } {
        return { params: this.params.length, aliases: this.aliasCount };
    }

    /** Undo the parameters/aliases a speculative compilation consumed, so an abandoned attempt doesn't leave gaps in `$n` numbering. */
    reset(mark: { params: number; aliases: number }): void {
        this.params.length = mark.params;
        this.aliasCount = mark.aliases;
    }
}
