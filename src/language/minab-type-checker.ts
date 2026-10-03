/**
 * Type inference/checking (roadmap Phase 4) over the expression grammar:
 * literals, sigil types (`.`/`$`/`^`/`#alias`/`KEY`), function return types
 * (built-in aggregates reduce a collection to a scalar; predicates return
 * `BOOLEAN`), and the scalar/`ref`/`collection` traversal and broadcast
 * rules from spec §3. No-implicit-coercion (spec §5.5) and the §3.4
 * collection-vs-scalar boundary are enforced by `minab-validator.ts`,
 * which calls `inferType` at each scalar-expecting position — this file
 * only answers "what type does this expression have?", the same
 * `{ok:false, reason}` discriminated-union shape `MinabScopeResolver`
 * (Phase 2) already established for "what does this sigil refer to?".
 *
 * Depends on `SchemaProvider` for column/table lookups and
 * `MinabScopeResolver` for the *base table* of a sigil (`.`/`^`/`#alias`) —
 * this is exactly the "one hop" Phase 2 already resolves. Everything past
 * that hop (chained `.field` traversal through `ref`/`collection`
 * columns, which Phase 2 explicitly punted on) is this file's job.
 */

import { AstUtils, type AstNode } from 'langium';
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
    isGroupByClause,
    isGroupKeyRef,
    isIfExpr,
    isIndexRef,
    isJsonObjectLiteral,
    isListLiteral,
    isLoopStatement,
    isMemberAccess,
    isModel,
    isNamedScope,
    isNameRef,
    isNullLiteral,
    isNumberLiteral,
    isParam,
    isParentRecord,
    isQuery,
    isStringLiteral,
    isSubquery,
    isSwitchExpr,
    isTableRef,
    isTupleAccess,
    isTupleLiteral,
    isTypeRef,
    isTypeTestExpression,
    isUnaryExpression,
    isVariableDecl,
    type BinaryExpression,
    type CallExpression,
    type CurrentRecord,
    type Expression,
    type FilterAccess,
    type FunctionDecl,
    type GroupKeyRef,
    type IfExpr,
    type ListLiteral,
    type MainStatement,
    type MemberAccess,
    type NamedScope,
    type NameRef,
    type NumberLiteral,
    type Query,
    type Subquery,
    type SwitchExpr,
    type TupleAccess,
    type TupleLiteral,
    type Type,
    type TypeRef,
    type UnaryExpression
} from './generated/ast.js';
import { coded, type CodedMessage, type DiagnosticCode, type ParamsArgs } from './diagnostics/codes.js';
import { checkBuiltin, getBuiltin } from './minab-builtins.js';
import { type ScopeResolution, type MinabScopeResolver } from './minab-scope-resolver.js';
import {
    baseTypesEqual,
    formatType,
    isNumeric,
    isOrderable,
    isTextual,
    NULL_TYPE,
    NUMERIC_BASES,
    scalarType,
    widenNumeric,
    type LogicalTypeBase,
    type MinabType,
    type ScalarType
} from './minab-types.js';
import type { ResolvedHostFunction } from './host-declarations.js';
import type { MinabRuleContext, SchemaProvider } from './schema.js';

/**
 * `origin` is the AST node whose own inference first produced the failure —
 * left `undefined` by every `err(...)` call site and stamped once, by
 * `inferType`'s public wrapper, on the innermost node in a recursive chain.
 * `MinabValidator` uses it to report a failure exactly once, at the node
 * that actually caused it, rather than once per enclosing node that
 * re-infers the same failing subexpression.
 */
export type TypeResult = { ok: true; type: MinabType } | ({ ok: false; origin?: AstNode } & CodedMessage);

function ok(type: MinabType): TypeResult {
    return { ok: true, type };
}

function err<C extends DiagnosticCode>(code: C, ...args: ParamsArgs<C>): TypeResult {
    return { ok: false, ...coded(code, ...args) };
}

/** Passes on a failure that a scope resolver or a built-in check already coded. */
function failWith(failure: CodedMessage): TypeResult {
    return { ok: false, code: failure.code, params: failure.params, reason: failure.reason };
}

export function typeRefToMinabType(t: TypeRef): ScalarType {
    return scalarType(t.base as LogicalTypeBase, { nullable: t.nullable, array: t.array, arrayNullable: t.arrayNullable });
}

export function astTypeToMinabType(t: Type): MinabType {
    if (isTypeRef(t)) return typeRefToMinabType(t);
    return { kind: 'tuple', elements: t.elementTypes.map(astTypeToMinabType) };
}

function numberLiteralBase(node: NumberLiteral): 'INTEGER' | 'DECIMAL' {
    const text = node.$cstNode?.text ?? String(node.value);
    return text.includes('.') ? 'DECIMAL' : 'INTEGER';
}

export class MinabTypeChecker {
    constructor(
        private readonly schema: SchemaProvider,
        private readonly scopeResolver: MinabScopeResolver,
        private readonly ruleContext: MinabRuleContext
    ) {}

    /**
     * Stamps `origin` on a failure the dispatch didn't already tag — which,
     * since every recursive call in this file goes back through this same
     * public method, happens exactly once: at the innermost node whose own
     * inference first failed. Outer nodes that re-infer that subexpression
     * see the same failure with `origin` already set, and leave it alone.
     */
    inferType(node: Expression): TypeResult {
        const result = this.inferTypeDispatch(node);
        return !result.ok && result.origin === undefined ? { ...result, origin: node } : result;
    }

    private inferTypeDispatch(node: Expression): TypeResult {
        // A document with syntax errors is still validated — Langium runs
        // the `Validator` over whatever AST the parser recovered, which is
        // the whole point in an editor. An incomplete node (`.a >` parses
        // to a `BinaryExpression` with no `right`) therefore arrives here
        // as `undefined`, and the alternative to this guard is a
        // `TypeError` reaching the user as a stack trace. Found by running
        // the Phase 6 CLI over a file with a typo in it.
        if (node === undefined) return err('syntax.incompleteExpression');
        if (isStringLiteral(node)) return ok(scalarType('TEXT'));
        if (isBooleanLiteral(node)) return ok(scalarType('BOOLEAN'));
        if (isNullLiteral(node)) return ok(NULL_TYPE);
        if (isNumberLiteral(node)) return ok(scalarType(numberLiteralBase(node)));
        if (isCurrentRecord(node)) return this.inferCurrentRecord(node);
        if (isParentRecord(node)) return this.inferSigilRecord(this.scopeResolver.resolveParentRecord(node));
        if (isNamedScope(node)) return this.inferNamedScope(node);
        if (isFieldValue(node)) return this.inferFieldValue();
        if (isGroupKeyRef(node)) return this.inferGroupKeyRef(node);
        if (isMemberAccess(node)) return this.inferMemberAccess(node);
        if (isTupleAccess(node)) return this.inferTupleAccess(node);
        if (isFilterAccess(node)) return this.inferFilterAccess(node);
        if (isCallExpression(node)) return this.inferCallExpression(node);
        if (isCastExpr(node)) return ok(typeRefToMinabType(node.targetType));
        if (isTypeTestExpression(node)) return ok(scalarType('BOOLEAN'));
        if (isBinaryExpression(node)) return this.inferBinaryExpression(node);
        if (isUnaryExpression(node)) return this.inferUnaryExpression(node);
        if (isListLiteral(node)) return this.inferListLiteral(node);
        if (isJsonObjectLiteral(node)) return ok(scalarType('JSON'));
        if (isTupleLiteral(node)) return this.inferTupleLiteral(node);
        if (isSubquery(node)) return this.inferSubquery(node);
        if (isIfExpr(node)) return this.inferIfExpr(node);
        if (isSwitchExpr(node)) return this.inferSwitchExpr(node);
        if (isBlock(node)) return node.tail ? this.inferMainStatement(node.tail) : err('type.blockNoValue');
        if (isIndexRef(node)) return ok(scalarType('INTEGER'));
        if (isNameRef(node)) return this.inferNameRef(node);
        if (isTableRef(node)) {
            const res = this.scopeResolver.resolveTableRef(node);
            return this.inferSigilRecord(res);
        }
        return err('type.cannotInfer', { nodeType: node.$type });
    }

    // ---- sigils --------------------------------------------------------

    private inferSigilRecord(res: ScopeResolution): TypeResult {
        if (!res.found) return failWith(res);
        const tableName = res.scope.tableName ?? this.rootFallbackTable(res.scope.owner);
        if (!tableName) return err('scope.noStaticTable');
        return ok({ kind: 'record', table: tableName });
    }

    /**
     * When a scope level's table is unknown *because it's the implicit
     * root level* (spec §6's "record under validation" — see
     * `MinabScopeResolver.stackAt`'s doc comment), fall back to the
     * host-supplied `ruleContext.recordTable`. Anywhere else an unknown
     * table stays unknown — this is deliberately narrow, not a general
     * "assume `recordTable` whenever we're stuck."
     */
    private rootFallbackTable(owner: AstNode): string | undefined {
        return isModel(owner) ? this.ruleContext.recordTable : undefined;
    }

    /**
     * `#alias` is ambiguous by design (spec §3.3, §4.2): resolved against
     * an actual `FROM`/`JOIN` alias, it names a single joined row (a
     * `record`); resolved by falling through to the schema directly (no
     * alias of this name in scope), it's spec §3.3's "opens the whole
     * Table as a scope" — a `collection`, the same as any other to-many
     * relation. `MinabScopeResolver.resolveNamedScope` doesn't itself
     * distinguish these — but its fallback path sets `owner` to the
     * `NamedScope` node itself (nothing else to point at), which is
     * exactly the discriminator needed here.
     */
    private inferNamedScope(node: NamedScope): TypeResult {
        const res = this.scopeResolver.resolveNamedScope(node);
        if (!res.found) return failWith(res);
        if (!res.scope.tableName) return err('scope.noStaticTable');
        if (res.scope.owner === node) {
            return ok({ kind: 'collection', table: res.scope.tableName });
        }
        return ok({ kind: 'record', table: res.scope.tableName });
    }

    private inferCurrentRecord(node: CurrentRecord): TypeResult {
        const base = this.scopeResolver.resolveCurrentRecordBase(node);
        if (!base.found) return failWith(base);
        const tableName = base.scope.tableName ?? this.rootFallbackTable(base.scope.owner);
        if (!node.field) {
            if (!tableName) return err('scope.currentRecordNoTable');
            return ok({ kind: 'record', table: tableName });
        }
        if (!tableName) return err('type.columnNeedsTable', { column: node.field });
        return this.lookupColumn(tableName, node.field);
    }

    private inferFieldValue(): TypeResult {
        if (!this.ruleContext.isFieldRule) return err('rule.fieldValueOutsideFieldRule');
        if (!this.ruleContext.fieldType) return err('rule.fieldTypeMissing');
        return ok(this.ruleContext.fieldType);
    }

    private inferGroupKeyRef(node: GroupKeyRef): TypeResult {
        const res = this.scopeResolver.resolveGroupKeyRef(node);
        if (!res.found) return failWith(res);
        const groupBy = res.scope.owner;
        if (!isGroupByClause(groupBy)) return err('scope.keyWithoutGroupBy');
        if (groupBy.keys.length === 1) return this.inferType(groupBy.keys[0]);
        const elements: MinabType[] = [];
        for (const key of groupBy.keys) {
            const keyType = this.inferType(key);
            if (!keyType.ok) return keyType;
            elements.push(keyType.type);
        }
        return ok({ kind: 'tuple', elements });
    }

    private inferNameRef(node: NameRef): TypeResult {
        const res = this.scopeResolver.resolveNameRef(node);
        if (!res.found) return failWith(res);
        if (res.scope.hostInput) return ok(res.scope.hostInput);
        if (res.scope.tableName) {
            return ok({ kind: 'record', table: res.scope.tableName });
        }
        const owner = res.scope.owner;
        if (isVariableDecl(owner)) return ok(astTypeToMinabType(owner.type));
        if (isParam(owner)) return ok(astTypeToMinabType(owner.type));
        if (isLoopStatement(owner)) {
            if (owner.lowerBound) return ok(scalarType('INTEGER'));
            if (owner.iterable) {
                const iterableType = this.inferType(owner.iterable);
                if (!iterableType.ok) return iterableType;
                return this.elementOfIterable(iterableType.type);
            }
        }
        return err('type.cannotDetermine', { name: node.name });
    }

    private elementOfIterable(t: MinabType): TypeResult {
        if (t.kind === 'collection') return ok({ kind: 'record', table: t.table });
        if (t.kind === 'scalar' && t.array) return ok(scalarType(t.base, { nullable: t.nullable }));
        return err('type.notIterable', { actual: formatType(t) });
    }

    // ---- traversal (spec §3) -------------------------------------------

    private lookupColumn(table: string, field: string): TypeResult {
        const col = this.schema.getColumn(table, field);
        if (!col) return err('scope.unknownColumn', { column: field, table });
        switch (col.type.kind) {
            case 'scalar':
                return ok(col.type.type);
            case 'ref':
                return ok({ kind: 'record', table: col.type.table });
            case 'collection':
                return ok({ kind: 'collection', table: col.type.table });
        }
    }

    private lookupBroadcastColumn(table: string, field: string): TypeResult {
        const col = this.schema.getColumn(table, field);
        if (!col) return err('scope.unknownColumn', { column: field, table });
        switch (col.type.kind) {
            case 'scalar':
                return ok(scalarType(col.type.type.base, { nullable: col.type.type.nullable, array: true }));
            case 'ref':
            case 'collection':
                // Broadcasting a relation field across a collection flattens
                // into a collection of the related table — spec §3.1/§3.4
                // don't give a worked example of this specific case; revisit
                // with a concrete example if one surfaces.
                return ok({ kind: 'collection', table: col.type.table });
        }
    }

    private inferMemberAccess(node: MemberAccess): TypeResult {
        const receiver = this.inferType(node.receiver);
        if (!receiver.ok) return receiver;
        const t = receiver.type;
        if (t.kind === 'record') return this.lookupColumn(t.table, node.member);
        if (t.kind === 'collection') return this.lookupBroadcastColumn(t.table, node.member);
        return err('type.memberOnNonRecord', { member: node.member, actual: formatType(t) });
    }

    /**
     * `[NUMBER]` is ambiguous in the grammar (spec §12 item 4) between
     * `TupleAccess` and a `FilterAccess` whose filter happens to be an
     * integer literal — Chevrotain resolves it to `TupleAccess`
     * structurally for *any* bare-literal index, regardless of whether the
     * receiver is actually a tuple. So `.orders[2]` (spec §3.5's positional-
     * access-on-a-relational-collection example) parses as `TupleAccess`,
     * not `FilterAccess` — this method has to cover both the real tuple
     * case and §3.5's array/JSON/collection cases. Only a *non-literal*
     * index (`.tags[i]`) actually reaches `inferFilterAccess` instead.
     */
    private inferTupleAccess(node: TupleAccess): TypeResult {
        const receiver = this.inferType(node.receiver);
        if (!receiver.ok) return receiver;
        const t = receiver.type;
        if (t.kind === 'tuple') {
            const idx = node.index;
            if (idx < 0 || idx >= t.elements.length) {
                return err('type.tupleIndexOutOfBounds', { index: idx, count: t.elements.length });
            }
            return ok(t.elements[idx]);
        }
        if (t.kind === 'scalar' && t.base === 'JSON' && !t.array) {
            return ok(scalarType('JSON', { nullable: true }));
        }
        if (t.kind === 'scalar' && t.array) {
            return ok(scalarType(t.base, { nullable: t.nullable }));
        }
        if (t.kind === 'collection') {
            return err('type.positionalIndexOnCollection');
        }
        return err('type.indexOnNonTuple', { index: node.index, actual: formatType(t) });
    }

    private inferFilterAccess(node: FilterAccess): TypeResult {
        const receiver = this.inferType(node.receiver);
        if (!receiver.ok) return receiver;
        const filter = this.inferType(node.filter);
        if (!filter.ok) return filter;

        // A JSON value's shape isn't known statically (spec §3.5/§7.3) —
        // both filtering and positional indexing are always legal on one,
        // and the result is likewise an unshaped JSON value.
        if (receiver.type.kind === 'scalar' && receiver.type.base === 'JSON' && !receiver.type.array) {
            if (this.isBoolean(filter.type)) return ok(receiver.type);
            if (isNumeric(filter.type) && filter.type.kind === 'scalar' && filter.type.base === 'INTEGER') {
                return ok(scalarType('JSON', { nullable: true }));
            }
            return err('type.invalidFilter');
        }

        if (this.isBoolean(filter.type)) {
            if (receiver.type.kind === 'collection' || (receiver.type.kind === 'scalar' && receiver.type.array)) {
                return ok(receiver.type);
            }
            return err('type.filterOnNonCollection', { actual: formatType(receiver.type) });
        }
        if (filter.type.kind === 'scalar' && filter.type.base === 'INTEGER' && !filter.type.array) {
            if (receiver.type.kind === 'collection') {
                return err('type.positionalIndexOnCollection');
            }
            if (receiver.type.kind === 'scalar' && receiver.type.array) {
                return ok(scalarType(receiver.type.base, { nullable: receiver.type.nullable }));
            }
            return err('type.indexOnNonArray', { actual: formatType(receiver.type) });
        }
        return err('type.invalidFilter');
    }

    // ---- functions (spec §5.3, §8) --------------------------------------

    private findFunctionDecl(node: AstNode, name: string): FunctionDecl | undefined {
        const model = AstUtils.getContainerOfType(node, isModel);
        return model?.declarations.find((d): d is FunctionDecl => isFunctionDecl(d) && d.name === name);
    }

    private inferCallExpression(node: CallExpression): TypeResult {
        if (!isNameRef(node.callee)) {
            return err('call.calleeNotName');
        }
        const name = node.callee.name;
        const builtin = getBuiltin(name);
        if (!builtin) {
            const host = this.schema.getHostFunction(name);
            return host ? this.inferHostCall(node, host) : this.inferUserCall(node, name);
        }
        const argTypes: MinabType[] = [];
        for (const arg of node.args) {
            const argType = this.inferType(arg);
            if (!argType.ok) return argType;
            argTypes.push(argType.type);
        }
        const result = checkBuiltin(builtin, argTypes);
        if (result.ok) return ok(result.type);
        // In a grouped query an aggregate reads the group: `SUM(.total)` has one value per row.
        const promoted = builtin.kind === 'scalar' || argTypes.length !== 1 ? undefined : this.promoteForGroupedAggregate(node, argTypes[0]);
        if (promoted) {
            const retried = checkBuiltin(builtin, [promoted]);
            if (retried.ok) return ok(retried.type);
        }
        return failWith(result);
    }

    /** A call to a function the host declared (D27). Same rules as a user `fn`. */
    private inferHostCall(node: CallExpression, host: ResolvedHostFunction): TypeResult {
        const name = host.name;
        if (node.args.length !== host.params.length) {
            return err('call.userArity', { name, expected: host.params.length, actual: node.args.length });
        }
        for (let i = 0; i < node.args.length; i++) {
            const argType = this.inferType(node.args[i]);
            if (!argType.ok) return argType;
            const paramType = host.params[i].type;
            if (argType.type.kind !== 'null' && !baseTypesEqual(argType.type, paramType)) {
                return err('call.argumentType', { name, position: i + 1, expected: formatType(paramType), actual: formatType(argType.type) });
            }
        }
        return ok(host.returns);
    }

    /** A call whose name is not a built-in or a host function: it must be a declared `fn` (D10). */
    private inferUserCall(node: CallExpression, name: string): TypeResult {
        const decl = this.findFunctionDecl(node, name);
        if (!decl) return err('call.unknownFunction', { name });
        if (node.args.length !== decl.params.length) {
            return err('call.userArity', { name, expected: decl.params.length, actual: node.args.length });
        }
        for (let i = 0; i < node.args.length; i++) {
            const argType = this.inferType(node.args[i]);
            if (!argType.ok) return argType;
            const paramType = astTypeToMinabType(decl.params[i].type);
            if (argType.type.kind !== 'null' && !baseTypesEqual(argType.type, paramType)) {
                return err('call.argumentType', { name, position: i + 1, expected: formatType(paramType), actual: formatType(argType.type) });
            }
        }
        return ok(astTypeToMinabType(decl.returnType));
    }

    /**
     * Spec §4.1 point 4: "Inside and after [GROUPBY], `.` refers to a row
     * within the current group (so aggregate functions like `SUM(.total)`
     * still work)." A bare per-row expression like `.total` isn't
     * statically a collection the way `.orders.total` is (§3.4) — it's
     * only collection-shaped *because* it's the direct argument to an
     * aggregate inside a grouped query. Promote it (scalar → scalar[],
     * record → collection) only as a fallback, so an already-legitimate
     * collection argument (`SUM(.orders.total)`) isn't double-wrapped.
     */
    private promoteForGroupedAggregate(node: AstNode, t: MinabType): MinabType | undefined {
        const query = AstUtils.getContainerOfType(node, isQuery);
        if (!query?.groupByClause) return undefined;
        if (t.kind === 'scalar' && !t.array) return scalarType(t.base, { nullable: t.nullable, array: true });
        if (t.kind === 'record') return { kind: 'collection', table: t.table };
        return undefined;
    }

    // ---- queries used as values (spec §5.4, §7.1) -----------------------

    /**
     * A query used as a value infers as its single `SELECT` column's own
     * (scalar) type — matching every worked example in the spec (`let
     * base: DECIMAL = (FROM Order WHERE .id == orderId SELECT .total)`,
     * §8.2; `let top_customer_id: UUID = (...)`, §7.1), none of which
     * carry any marker distinguishing "this yields one row" from "this
     * yields many." Real SQL resolves the same ambiguity by context, not
     * by inspecting the subquery itself: a *scalar* context (an
     * initializer, a comparison operand) takes the single column's type
     * directly; a *set* context (`IN (subquery)`) is handled separately by
     * `inferIn`, which reads the same single column but doesn't reduce it
     * to one value. There's no `LIMIT`-based heuristic here — a query
     * that's genuinely multi-row and used where a scalar is required is a
     * *runtime* concern (too many rows), the same way an unsatisfiable
     * `CAST` is (spec §5.5), not something this static check can catch.
     */
    private inferQueryShape(query: Query): TypeResult {
        if (!query.selectClause || query.selectClause.all || query.selectClause.items.length !== 1) {
            return err('query.singleColumnRequired');
        }
        return this.inferType(query.selectClause.items[0].expression);
    }

    private inferSubquery(node: Subquery): TypeResult {
        return this.inferQueryShape(node.query);
    }

    private inferMainStatement(stmt: MainStatement): TypeResult {
        if (isQuery(stmt)) return this.inferQueryShape(stmt);
        return this.inferType(stmt);
    }

    // ---- operators (spec §5.5, §7.7) ------------------------------------

    private isBoolean(t: MinabType): boolean {
        return t.kind === 'scalar' && t.base === 'BOOLEAN' && !t.array;
    }

    private inferBinaryExpression(node: BinaryExpression): TypeResult {
        switch (node.operator) {
            case 'AND':
            case 'OR':
                return this.inferLogical(node);
            case '+':
            case '-':
            case '*':
            case '/':
            case '%':
                return this.inferArithmetic(node);
            case '==':
            case '!=':
                return this.inferEquality(node);
            case '<':
            case '<=':
            case '>':
            case '>=':
                return this.inferOrdering(node);
            case 'IN':
                return this.inferIn(node);
            case 'LIKE':
                return this.inferLike(node);
            default:
                return err('type.unsupportedOperator', { operator: node.operator });
        }
    }

    private inferLogical(node: BinaryExpression): TypeResult {
        const left = this.inferType(node.left);
        if (!left.ok) return left;
        const right = this.inferType(node.right);
        if (!right.ok) return right;
        if (!this.isBoolean(left.type) || !this.isBoolean(right.type)) {
            return err('type.logicalNeedsBoolean', { operator: node.operator, left: formatType(left.type), right: formatType(right.type) });
        }
        return ok(scalarType('BOOLEAN'));
    }

    private inferArithmetic(node: BinaryExpression): TypeResult {
        const left = this.inferType(node.left);
        if (!left.ok) return left;
        const right = this.inferType(node.right);
        if (!right.ok) return right;

        if (node.operator === '+' && isTextual(left.type) && isTextual(right.type)) {
            if (left.type.kind === 'scalar' && right.type.kind === 'scalar' && left.type.base === right.type.base) {
                return ok(scalarType(left.type.base, { nullable: left.type.nullable || right.type.nullable }));
            }
            return err('type.implicitCoercion', { operator: '+', left: formatType(left.type), right: formatType(right.type) });
        }

        if (!isNumeric(left.type) || !isNumeric(right.type)) {
            return err('type.arithmeticNeedsNumeric', { operator: node.operator, left: formatType(left.type), right: formatType(right.type) });
        }
        const base = widenNumeric((left.type as ScalarType).base, (right.type as ScalarType).base);
        const nullable = (left.type as ScalarType).nullable || (right.type as ScalarType).nullable;
        return ok(scalarType(base, { nullable }));
    }

    private inferEquality(node: BinaryExpression): TypeResult {
        const left = this.inferType(node.left);
        if (!left.ok) return left;
        const right = this.inferType(node.right);
        if (!right.ok) return right;
        if (left.type.kind === 'null' || right.type.kind === 'null') return ok(scalarType('BOOLEAN'));
        if (!baseTypesEqual(left.type, right.type)) {
            return err('type.implicitCoercion', { operator: node.operator, left: formatType(left.type), right: formatType(right.type) });
        }
        return ok(scalarType('BOOLEAN'));
    }

    private inferOrdering(node: BinaryExpression): TypeResult {
        const left = this.inferType(node.left);
        if (!left.ok) return left;
        const right = this.inferType(node.right);
        if (!right.ok) return right;
        if (left.type.kind === 'null' || right.type.kind === 'null') {
            return err('null.orderingWithNull', { operator: node.operator });
        }
        if (!isOrderable(left.type) || !isOrderable(right.type)) {
            return err('type.orderingNeedsOrderable', { operator: node.operator, left: formatType(left.type), right: formatType(right.type) });
        }
        if (!baseTypesEqual(left.type, right.type)) {
            return err('type.implicitCoercion', { operator: node.operator, left: formatType(left.type), right: formatType(right.type) });
        }
        return ok(scalarType('BOOLEAN'));
    }

    private arrayOrCollectionElement(t: MinabType): MinabType | undefined {
        if (t.kind === 'scalar' && t.array) return scalarType(t.base, { nullable: t.nullable });
        if (t.kind === 'collection') return { kind: 'record', table: t.table };
        return undefined;
    }

    private inferIn(node: BinaryExpression): TypeResult {
        const left = this.inferType(node.left);
        if (!left.ok) return left;

        // `IN (subquery)` (spec §5.4) — unlike every other consumer of a
        // query-as-value, this is a *set* context: compare against the
        // subquery's single SELECT column directly, without reducing it
        // to one row the way `inferQueryShape`'s ordinary (scalar) result
        // would (see its doc comment for why there's no static way to
        // tell "one row" from "many" other than the consuming context).
        if (isSubquery(node.right)) {
            const q = node.right.query;
            if (!q.selectClause || q.selectClause.all || q.selectClause.items.length !== 1) {
                return err('query.inSingleColumnRequired');
            }
            const itemType = this.inferType(q.selectClause.items[0].expression);
            if (!itemType.ok) return itemType;
            if (left.type.kind !== 'null' && itemType.type.kind !== 'null' && !baseTypesEqual(left.type, itemType.type)) {
                return err('type.inSubqueryMismatch', { left: formatType(left.type), right: formatType(itemType.type) });
            }
            return ok(scalarType('BOOLEAN'));
        }

        const right = this.inferType(node.right);
        if (!right.ok) return right;
        const rightElement = this.arrayOrCollectionElement(right.type);
        if (!rightElement) {
            return err('type.inNeedsCollection', { actual: formatType(right.type) });
        }
        if (left.type.kind !== 'null' && rightElement.kind !== 'null' && !baseTypesEqual(left.type, rightElement)) {
            return err('type.inCollectionMismatch', { left: formatType(left.type), right: formatType(rightElement) });
        }
        return ok(scalarType('BOOLEAN'));
    }

    private inferLike(node: BinaryExpression): TypeResult {
        const left = this.inferType(node.left);
        if (!left.ok) return left;
        const right = this.inferType(node.right);
        if (!right.ok) return right;
        if (left.type.kind === 'null' || right.type.kind === 'null') {
            return err('null.likeWithNull');
        }
        if (!isTextual(left.type) || !isTextual(right.type)) {
            return err('type.likeNeedsText', { left: formatType(left.type), right: formatType(right.type) });
        }
        return ok(scalarType('BOOLEAN'));
    }

    private inferUnaryExpression(node: UnaryExpression): TypeResult {
        const operand = this.inferType(node.operand);
        if (!operand.ok) return operand;
        if (node.negated) {
            if (!this.isBoolean(operand.type)) return err('type.notNeedsBoolean', { actual: formatType(operand.type) });
            return ok(scalarType('BOOLEAN'));
        }
        if (!isNumeric(operand.type)) return err('type.unaryNeedsNumeric', { operator: String(node.operator), actual: formatType(operand.type) });
        return ok(operand.type);
    }

    // ---- literals that need element-unification -------------------------

    private inferListLiteral(node: ListLiteral): TypeResult {
        if (node.items.length === 0) {
            return ok(scalarType('JSON', { array: true }));
        }
        let base: LogicalTypeBase | undefined;
        let nullable = false;
        for (const item of node.items) {
            const itemType = this.inferType(item);
            if (!itemType.ok) return itemType;
            if (itemType.type.kind === 'null') {
                nullable = true;
                continue;
            }
            if (itemType.type.kind !== 'scalar' || itemType.type.array) {
                return err('type.listElementNotScalar', { actual: formatType(itemType.type) });
            }
            if (itemType.type.nullable) nullable = true;
            if (base === undefined) {
                base = itemType.type.base;
            } else if (base !== itemType.type.base) {
                if (NUMERIC_BASES.has(base) && NUMERIC_BASES.has(itemType.type.base)) {
                    base = widenNumeric(base, itemType.type.base);
                } else {
                    return err('type.listElementsMixed', { first: base, second: itemType.type.base });
                }
            }
        }
        if (base === undefined) return ok(scalarType('JSON', { array: true, nullable: true }));
        return ok(scalarType(base, { nullable, array: true }));
    }

    private inferTupleLiteral(node: TupleLiteral): TypeResult {
        const elements: MinabType[] = [];
        for (const item of node.items) {
            const t = this.inferType(item);
            if (!t.ok) return t;
            elements.push(t.type);
        }
        return ok({ kind: 'tuple', elements });
    }

    // ---- if/switch (spec §9.1, §9.2) -------------------------------------

    private makeNullable(t: MinabType): MinabType {
        if (t.kind === 'scalar') return { ...t, nullable: true };
        return t;
    }

    private inferIfExpr(node: IfExpr): TypeResult {
        const thenType = this.inferType(node.thenBranch);
        if (!thenType.ok) return thenType;
        if (!node.elseBranch && !node.elseIf) {
            return ok(this.makeNullable(thenType.type));
        }
        const elseNode = node.elseBranch ?? node.elseIf!;
        const elseType = this.inferType(elseNode);
        if (!elseType.ok) return elseType;
        if (!baseTypesEqual(thenType.type, elseType.type)) {
            return err('type.ifBranchesDiffer', { then: formatType(thenType.type), else: formatType(elseType.type) });
        }
        return ok(thenType.type);
    }

    private inferSwitchExpr(node: SwitchExpr): TypeResult {
        const defaultType = this.inferType(node.defaultResult);
        if (!defaultType.ok) return defaultType;
        const result = defaultType.type;
        for (const c of node.cases) {
            const caseType = this.inferType(c.result);
            if (!caseType.ok) return caseType;
            if (!baseTypesEqual(result, caseType.type)) {
                return err('type.switchArmsDiffer', { first: formatType(result), second: formatType(caseType.type) });
            }
        }
        return ok(result);
    }
}
