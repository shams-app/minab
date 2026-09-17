/**
 * Type inference and checking (roadmap Phase 4). Two halves in this file:
 *
 *  - `MinabTypeChecker.typeOf(expr)` — a pure, non-reporting, best-effort
 *    inference function over every `Expression` alternative in the grammar.
 *    Returns `MinabType`'s `unknown` marker on any failure, never throws,
 *    and is used both internally (recursively) and by every validator
 *    check below, so recursion never double-reports a problem.
 *
 *  - `registerTypeCheckingChecks` — the actual diagnostic-producing Langium
 *    validation checks (parallel to, not merged into, Phase 3's
 *    `minab-validator.ts`), each calling `typeOf` on its children and
 *    reporting exactly once at the most relevant node. This is where every
 *    "no implicit coercion" / traversal / collection-boundary rule from
 *    spec §3, §5.5, §7, §9 becomes an `accept('error', ...)` call.
 *
 * `MinabScopeResolver` (Phase 2) still only resolves *what a sigil refers
 * to*, bounded to one hop of column access — this file is what supersedes
 * that bound for real traversal: `ref` chains to arbitrary depth and
 * `collection` broadcast (§3.1), backed by `SchemaProvider` directly rather
 * than guessing.
 */

import { AstUtils, type AstNode, type ValidationAcceptor, type ValidationChecks } from 'langium';
import {
    isBlock,
    isCallExpression,
    isCastExpr,
    isCurrentRecord,
    isFieldValue,
    isFilterAccess,
    isFunctionCall,
    isFunctionDecl,
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
    isBooleanLiteral,
    isParam,
    isParentRecord,
    isQuery,
    isSelectItem,
    isStringLiteral,
    isSubquery,
    isSwitchExpr,
    isTableRef,
    isTupleAccess,
    isTupleLiteral,
    isTypeTestExpression,
    isUnaryExpression,
    isBinaryExpression,
    isVariableDecl,
    type AssignmentStatement,
    type BinaryExpression,
    type CallExpression,
    type CurrentRecord,
    type Expression,
    type FilterAccess,
    type FunctionCall,
    type FunctionDecl,
    type GroupKeyRef,
    type IfExpr,
    type ListLiteral,
    type LoopStatement,
    type MemberAccess,
    type Model,
    type NameRef,
    type Query,
    type TupleAccess,
    type UnaryExpression,
    type VariableDecl
} from './generated/ast.js';
import type { MinabScopeResolver, ScopeResolution } from './minab-scope-resolver.js';
import type { MinabFieldType, MinabRuleContext } from './schema.js';
import type { SchemaProvider } from './schema.js';
import {
    basesCompatible,
    describeType,
    equalityCompatible,
    isAssignable,
    orderingCompatible,
    typeFromTypeNode,
    type MinabType,
    type ScalarType
} from './types.js';

const AGGREGATES = new Set(['SUM', 'AVG', 'MIN', 'MAX']);
const PREDICATES = new Set(['EXISTS', 'ALL', 'ANY']);

function isNumeric(t: MinabType): t is ScalarType {
    return t.kind === 'scalar' && (t.base === 'INTEGER' || t.base === 'DECIMAL');
}

function isStringish(t: MinabType): t is ScalarType {
    return t.kind === 'scalar' && (t.base === 'TEXT' || t.base === 'CITEXT');
}

function isBoolean(t: MinabType): boolean {
    return t.kind === 'scalar' && t.base === 'BOOLEAN';
}

/** A field's schema type, expanded into the broader expression-inference `MinabType`. */
function fieldToType(f: MinabFieldType): MinabType {
    if (f.kind === 'collection') {
        return { kind: 'collection', table: f.table, element: { kind: 'ref', table: f.table, nullable: false } };
    }
    return f;
}

export class MinabTypeChecker {
    constructor(
        private readonly schema: SchemaProvider,
        private readonly scopeResolver: MinabScopeResolver,
        private readonly ruleContext: MinabRuleContext
    ) {}

    typeOf(node: Expression): MinabType {
        if (isStringLiteral(node)) return { kind: 'scalar', base: 'TEXT', nullable: false };
        if (isNumberLiteral(node)) {
            return { kind: 'scalar', base: Number.isInteger(node.value) ? 'INTEGER' : 'DECIMAL', nullable: false, literal: true };
        }
        if (isBooleanLiteral(node)) return { kind: 'scalar', base: 'BOOLEAN', nullable: false };
        if (isNullLiteral(node)) return { kind: 'null' };
        if (isJsonObjectLiteral(node)) return { kind: 'scalar', base: 'JSON', nullable: false };
        if (isListLiteral(node)) return this.typeOfList(node);
        if (isTupleLiteral(node)) return { kind: 'tuple', elements: node.items.map(i => this.typeOf(i)) };
        if (isCurrentRecord(node)) return this.typeOfCurrentRecord(node);
        if (isParentRecord(node)) return this.typeOfBaseScope(this.scopeResolver.resolveParentRecord(node));
        if (isNamedScope(node)) return this.typeOfNamedScope(node);
        if (isTableRef(node)) return this.typeOfTableRef(node);
        if (isNameRef(node)) return this.typeOfNameRef(node);
        if (isMemberAccess(node)) return this.typeOfMemberAccess(node);
        if (isFilterAccess(node)) return this.typeOfFilterAccess(node);
        if (isTupleAccess(node)) return this.typeOfTupleAccess(node);
        if (isFieldValue(node)) return this.ruleContext.fieldType ? fieldToType(this.ruleContext.fieldType) : { kind: 'unknown' };
        if (isGroupKeyRef(node)) return this.typeOfGroupKeyRef(node);
        if (isIndexRef(node)) return { kind: 'scalar', base: 'INTEGER', nullable: false };
        if (isCastExpr(node)) return typeFromTypeNode(node.targetType);
        if (isTypeTestExpression(node)) return { kind: 'scalar', base: 'BOOLEAN', nullable: false };
        if (isUnaryExpression(node)) return this.typeOfUnary(node);
        if (isBinaryExpression(node)) return this.typeOfBinary(node);
        if (isFunctionCall(node)) return this.typeOfFunctionCall(node);
        if (isCallExpression(node)) return this.typeOfCallExpression(node);
        if (isIfExpr(node)) return this.typeOfIf(node);
        if (isSwitchExpr(node)) return this.typeOfSwitch(node);
        if (isBlock(node)) return this.typeOfTail(node.tail);
        if (isSubquery(node)) return { kind: 'unknown' }; // a query's row-shape isn't representable here (out of scope, see roadmap Phase 4 deferrals)
        return { kind: 'unknown' }; // ArrayKind/ObjectKind/StringKind/NumberKind/BooleanKind — only ever appear as TypeTestExpression.test
    }

    /** Finds a top-level `FunctionDecl` by name, regardless of declaration order (spec §8.4 — recursion, including mutual recursion, is allowed). */
    findFunctionDecl(node: AstNode, name: string): FunctionDecl | undefined {
        const model = AstUtils.getContainerOfType(node, isModel);
        return model?.declarations.find((d): d is FunctionDecl => isFunctionDecl(d) && d.name === name);
    }

    private typeOfTail(tail: Model['tail']): MinabType {
        if (!tail || isQuery(tail)) {
            return { kind: 'unknown' };
        }
        return this.typeOf(tail);
    }

    private typeOfList(node: ListLiteral): MinabType {
        if (node.items.length === 0) {
            return { kind: 'unknown' };
        }
        const itemTypes = node.items.map(i => this.typeOf(i));
        const first = itemTypes.find((t): t is ScalarType => t.kind === 'scalar');
        if (!first) {
            return { kind: 'unknown' };
        }
        const nullable = itemTypes.some(t => t.kind === 'null' || (t.kind === 'scalar' && t.nullable));
        return { kind: 'array', elementBase: first.base, elementNullable: nullable, nullable: false };
    }

    private recordType(tableName: string | undefined): MinabType {
        return tableName ? { kind: 'ref', table: tableName, nullable: false } : { kind: 'unknown' };
    }

    private collectionOfTable(tableName: string | undefined): MinabType {
        return tableName ? { kind: 'collection', table: tableName, element: { kind: 'ref', table: tableName, nullable: false } } : { kind: 'unknown' };
    }

    private typeOfBaseScope(res: ScopeResolution): MinabType {
        return res.found ? this.recordType(res.scope.tableName) : { kind: 'unknown' };
    }

    /** A bare `TableRef` (`FROM Order`) always denotes the whole table — a collection to iterate, never a single bound record. */
    private typeOfTableRef(node: import('./generated/ast.js').TableRef): MinabType {
        const res = this.scopeResolver.resolveTableRef(node);
        return res.found ? this.collectionOfTable(res.scope.tableName) : { kind: 'unknown' };
    }

    /**
     * `#alias` is two different things depending on what it resolves to
     * (spec §3.3 vs. §4.2): opened directly against the schema with no
     * in-scope alias (`EXISTS(#Customer[...])`) — the whole table, a
     * collection; or disambiguating an already-bound join/query alias
     * (`#customer.name`) — one row per output row, a ref, same as bare
     * `alias.field`. `resolveNamedScope` sets `scope.owner` to the
     * `NamedScope` node itself only in the first case (no alias entry
     * matched), which is what distinguishes them here.
     */
    private typeOfNamedScope(node: import('./generated/ast.js').NamedScope): MinabType {
        const res = this.scopeResolver.resolveNamedScope(node);
        if (!res.found) {
            return { kind: 'unknown' };
        }
        if (res.scope.owner === node) {
            return this.collectionOfTable(res.scope.tableName);
        }
        return this.recordType(res.scope.tableName);
    }

    private typeOfCurrentRecord(node: CurrentRecord): MinabType {
        const base = this.scopeResolver.resolveCurrentRecordScope(node);
        if (!base.found) {
            return { kind: 'unknown' };
        }
        const receiver = this.recordType(base.scope.tableName);
        return node.field ? this.fieldAccessType(receiver, node.field) : receiver;
    }

    private typeOfMemberAccess(node: MemberAccess): MinabType {
        return this.fieldAccessType(this.typeOf(node.receiver), node.member);
    }

    /** Walks a `.field` step against a receiver's type — arbitrarily deep through `ref` chains, broadcasting through `collection` (spec §3.1), propagating nullability through a nullable `ref` (spec §7.7). */
    fieldAccessType(receiverType: MinabType, member: string): MinabType {
        if (receiverType.kind === 'unknown') {
            return { kind: 'unknown' };
        }
        if (receiverType.kind === 'ref') {
            if (!receiverType.table) {
                return { kind: 'unknown' };
            }
            const column = this.schema.getColumn(receiverType.table, member);
            if (!column) {
                return { kind: 'unknown' };
            }
            const fieldType = fieldToType(column.type);
            return receiverType.nullable ? this.withNullPropagation(fieldType) : fieldType;
        }
        if (receiverType.kind === 'collection') {
            const elementFieldType = this.fieldAccessType(receiverType.element, member);
            if (elementFieldType.kind === 'ref') {
                return { kind: 'collection', table: elementFieldType.table, element: elementFieldType };
            }
            return { kind: 'collection', element: elementFieldType };
        }
        return { kind: 'unknown' }; // scalar/array/tuple/null have no `.member`
    }

    private withNullPropagation(t: MinabType): MinabType {
        if (t.kind === 'scalar' || t.kind === 'array' || t.kind === 'ref') {
            return { ...t, nullable: true };
        }
        return t; // collection is never null (§7.7); tuple/null/unknown unaffected
    }

    /**
     * `[...]` with a non-literal index (`.tags[i]`) — a literal index
     * (`.tags[2]`) parses as `TupleAccess` instead, not `FilterAccess`, per
     * the grammar's documented ambiguity resolution (spec §12 item 4:
     * `TupleAccess`'s `[NUMBER]` wins over `FilterAccess` for a bare
     * number). Whether `node.filter` is itself an *index* rather than a
     * boolean predicate is therefore decided by its inferred type (spec
     * §3.5), not by its AST shape.
     */
    private typeOfFilterAccess(node: FilterAccess): MinabType {
        const receiverType = this.typeOf(node.receiver);
        const filterType = this.typeOf(node.filter);
        if (filterType.kind === 'scalar' && filterType.base === 'INTEGER') {
            return this.positionalElementType(receiverType);
        }
        return receiverType; // boolean filter — same shape, still a collection/array/JSON value
    }

    private typeOfTupleAccess(node: TupleAccess): MinabType {
        const receiverType = this.typeOf(node.receiver);
        if (receiverType.kind === 'tuple') {
            return receiverType.elements[node.index] ?? { kind: 'unknown' };
        }
        return this.positionalElementType(receiverType);
    }

    /** The result of a positional `[N]` access (spec §3.5) on a non-tuple receiver — an array's element type, or JSON's "unknown shape" passed through; a relational `collection` has no defined element order and is a semantic error, flagged by the validator checks below, not here. */
    private positionalElementType(receiverType: MinabType): MinabType {
        if (receiverType.kind === 'array') {
            return { kind: 'scalar', base: receiverType.elementBase, nullable: receiverType.elementNullable };
        }
        if (receiverType.kind === 'scalar' && receiverType.base === 'JSON') {
            return receiverType;
        }
        return { kind: 'unknown' };
    }

    private typeOfNameRef(node: NameRef): MinabType {
        const res = this.scopeResolver.resolveNameRef(node);
        if (!res.found) {
            return { kind: 'unknown' };
        }
        const owner = res.scope.owner;
        if (isVariableDecl(owner)) {
            return typeFromTypeNode(owner.type);
        }
        if (isParam(owner)) {
            return typeFromTypeNode(owner.type);
        }
        if (isLoopStatement(owner) && owner.lowerBound) {
            return { kind: 'scalar', base: 'INTEGER', nullable: false }; // range loop variable
        }
        if (isLoopStatement(owner) && owner.iterable) {
            return this.elementTypeOf(this.typeOf(owner.iterable)) ?? { kind: 'unknown' }; // for-in loop variable
        }
        if (isSelectItem(owner)) {
            return this.typeOf(owner.expression); // a SELECT alias, e.g. `SUM(.total) AS total_spent` referenced from ORDERBY
        }
        return this.recordType(res.scope.tableName); // a Query/JoinClause table alias
    }

    private elementTypeOf(t: MinabType): MinabType | undefined {
        if (t.kind === 'array') {
            return { kind: 'scalar', base: t.elementBase, nullable: t.elementNullable };
        }
        if (t.kind === 'collection') {
            return t.element;
        }
        return undefined;
    }

    private typeOfGroupKeyRef(node: GroupKeyRef): MinabType {
        const query = AstUtils.getContainerOfType(node, isQuery);
        if (!query?.groupByClause) {
            return { kind: 'unknown' };
        }
        const keys = query.groupByClause.keys;
        if (keys.length === 1) {
            return this.typeOf(keys[0]);
        }
        return { kind: 'tuple', elements: keys.map(k => this.typeOf(k)) };
    }

    private typeOfUnary(node: UnaryExpression): MinabType {
        if (node.negated) {
            return { kind: 'scalar', base: 'BOOLEAN', nullable: false };
        }
        return this.typeOf(node.operand); // best-effort; numeric-operand enforcement is a separate validator check
    }

    private typeOfBinary(node: BinaryExpression): MinabType {
        const op = node.operator;
        if (op === '+' || op === '-' || op === '*' || op === '/' || op === '%') {
            const l = this.typeOf(node.left);
            const r = this.typeOf(node.right);
            if (op === '+' && isStringish(l)) {
                return l;
            }
            if (isNumeric(l) && !l.literal) {
                return l;
            }
            if (isNumeric(r) && !r.literal) {
                return r;
            }
            if (isNumeric(l)) {
                return l;
            }
            return { kind: 'unknown' };
        }
        return { kind: 'scalar', base: 'BOOLEAN', nullable: false }; // ==, !=, <, <=, >, >=, IN, LIKE, AND, OR
    }

    private typeOfFunctionCall(node: FunctionCall): MinabType {
        const decl = this.findFunctionDecl(node, node.name);
        if (!decl || !decl.tail || isQuery(decl.tail)) {
            return { kind: 'unknown' }; // unresolved, or a Query-tailed function — §12 item 11 is unresolved upstream, not decided here
        }
        return typeFromTypeNode(decl.returnType);
    }

    private typeOfCallExpression(node: CallExpression): MinabType {
        if (!isNameRef(node.callee)) {
            return { kind: 'unknown' };
        }
        const name = node.callee.name;
        if (name === 'COUNT') {
            return { kind: 'scalar', base: 'INTEGER', nullable: false };
        }
        if (PREDICATES.has(name)) {
            return { kind: 'scalar', base: 'BOOLEAN', nullable: false };
        }
        if (AGGREGATES.has(name)) {
            if (name === 'SUM' || name === 'AVG') {
                return { kind: 'scalar', base: 'DECIMAL', nullable: false };
            }
            // MIN/MAX return the (unwrapped) element type
            const argType = node.args[0] ? this.typeOf(node.args[0]) : undefined;
            const elementType = argType ? this.elementTypeOf(argType) : undefined;
            return elementType && elementType.kind === 'scalar' ? elementType : { kind: 'unknown' };
        }
        const fn = this.schema.getFunction(name);
        return fn ? fn.returnType : { kind: 'unknown' };
    }

    private typeOfIf(node: IfExpr): MinabType {
        const thenType = this.typeOf(node.thenBranch);
        if (node.elseBranch) {
            return this.unify(thenType, this.typeOf(node.elseBranch));
        }
        if (node.elseIf) {
            return this.unify(thenType, this.typeOf(node.elseIf));
        }
        return this.makeNullable(thenType); // no else -> nullable (§9.1)
    }

    private typeOfSwitch(node: import('./generated/ast.js').SwitchExpr): MinabType {
        let result = this.typeOf(node.defaultResult);
        for (const c of node.cases) {
            result = this.unify(result, this.typeOf(c.result));
        }
        return result;
    }

    private makeNullable(t: MinabType): MinabType {
        if (t.kind === 'scalar' || t.kind === 'array' || t.kind === 'ref') {
            return { ...t, nullable: true };
        }
        return t;
    }

    private unify(a: MinabType, b: MinabType): MinabType {
        if (a.kind === 'unknown') return b;
        if (b.kind === 'unknown') return a;
        if (b.kind === 'null') return this.makeNullable(a);
        if (a.kind === 'null') return this.makeNullable(b);
        return a; // best-effort; a branch-type mismatch is reported separately (IfExpr check)
    }
}

/**
 * The diagnostic-producing checks, parallel to Phase 3's `MinabValidator`
 * (not merged into it — different phase, different file, same pattern).
 */
class MinabTypeValidator {
    constructor(
        private readonly checker: MinabTypeChecker,
        private readonly schema: SchemaProvider,
        private readonly scopeResolver: MinabScopeResolver
    ) {}

    checkVariableDecl = (node: VariableDecl, accept: ValidationAcceptor): void => {
        if (!node.value) {
            return;
        }
        const declared = typeFromTypeNode(node.type);
        const valueType = this.checker.typeOf(node.value);
        if (valueType.kind !== 'unknown' && !isAssignable(valueType, declared)) {
            accept('error', `cannot assign ${describeType(valueType)} to ${describeType(declared)}`, { node: node.value });
        }
    };

    checkAssignmentStatement = (node: AssignmentStatement, accept: ValidationAcceptor): void => {
        if (!this.isValidLvalue(node.target)) {
            accept('error', 'assignment target must be a name or a .field/[filter] chain, not an arbitrary expression', { node: node.target });
            return;
        }
        this.checkVivifyOnCollection(node.target, accept);
        const targetType = this.checker.typeOf(node.target);
        const valueType = this.checker.typeOf(node.value);
        if (targetType.kind !== 'unknown' && valueType.kind !== 'unknown' && !isAssignable(valueType, targetType)) {
            accept('error', `cannot assign ${describeType(valueType)} to ${describeType(targetType)}`, { node: node.value });
        }
        if (node.operator === '?=' && targetType.kind === 'scalar' && !targetType.nullable) {
            accept('error', "'?=' is only valid on a nullable target", { node: node.target });
        }
    };

    private isValidLvalue(expr: Expression): boolean {
        if (isNameRef(expr) || isCurrentRecord(expr) || isParentRecord(expr) || isNamedScope(expr)) {
            return true;
        }
        if (isMemberAccess(expr) || isFilterAccess(expr) || isTupleAccess(expr)) {
            return this.isValidLvalue(expr.receiver);
        }
        return false;
    }

    private checkVivifyOnCollection(expr: Expression, accept: ValidationAcceptor): void {
        if (isMemberAccess(expr)) {
            this.checkVivifyOnCollection(expr.receiver, accept);
            if (expr.vivify && this.checker.typeOf(expr).kind === 'collection') {
                accept('error', `'!' has no effect on a collection field ('${expr.member}') — a collection is never null`, { node: expr });
            }
        } else if (isCurrentRecord(expr)) {
            if (expr.vivify && expr.field && this.checker.typeOf(expr).kind === 'collection') {
                accept('error', `'!' has no effect on a collection field ('${expr.field}') — a collection is never null`, { node: expr });
            }
        } else if (isFilterAccess(expr) || isTupleAccess(expr)) {
            this.checkVivifyOnCollection(expr.receiver, accept);
        }
    }

    checkQuery = (node: Query, accept: ValidationAcceptor): void => {
        if (node.whereClause) this.checkBooleanCondition(node.whereClause.condition, accept);
        if (node.havingClause) this.checkBooleanCondition(node.havingClause.condition, accept);
        for (const j of node.joins) {
            if (j.condition) this.checkBooleanCondition(j.condition, accept);
        }
        if (node.selectClause) {
            for (const item of node.selectClause.items) {
                if (this.checker.typeOf(item.expression).kind === 'collection') {
                    accept(
                        'error',
                        'a collection-valued expression cannot be used as a SELECT column — reduce it with an aggregate (SUM/COUNT/AVG/MIN/MAX) or a predicate over a filter (EXISTS/ALL/ANY) first',
                        { node: item.expression }
                    );
                }
            }
        }
    };

    checkLoopStatement = (node: LoopStatement, accept: ValidationAcceptor): void => {
        if (node.condition) this.checkBooleanCondition(node.condition, accept);
        if (node.lowerBound) this.checkNumericExpr(node.lowerBound, accept);
        if (node.upperBound) this.checkNumericExpr(node.upperBound, accept);
        if (node.stepClause) this.checkNumericExpr(node.stepClause.step, accept);
        if (node.whereClause) this.checkBooleanCondition(node.whereClause.condition, accept);
        if (node.iterable) {
            const t = this.checker.typeOf(node.iterable);
            if (t.kind !== 'unknown' && t.kind !== 'array' && t.kind !== 'collection') {
                accept('error', `loop 'in' requires an array or collection, got ${describeType(t)}`, { node: node.iterable });
            }
        }
    };

    private checkNumericExpr(expr: Expression, accept: ValidationAcceptor): void {
        const t = this.checker.typeOf(expr);
        if (t.kind !== 'unknown' && !isNumeric(t)) {
            accept('error', `expected a numeric expression, got ${describeType(t)}`, { node: expr });
        }
    }

    private checkBooleanCondition(expr: Expression, accept: ValidationAcceptor): void {
        const t = this.checker.typeOf(expr);
        if (t.kind === 'unknown') return;
        if (t.kind === 'collection') {
            accept(
                'error',
                'a collection-valued expression cannot be used as a condition — reduce it with an aggregate (SUM/COUNT/AVG/MIN/MAX) or a predicate over a filter (EXISTS/ALL/ANY) first',
                { node: expr }
            );
            return;
        }
        if (!isBoolean(t)) {
            accept('error', `condition must be BOOLEAN, got ${describeType(t)}`, { node: expr });
        }
    }

    checkBinaryExpression = (node: BinaryExpression, accept: ValidationAcceptor): void => {
        const op = node.operator;
        const l = this.checker.typeOf(node.left);
        const r = this.checker.typeOf(node.right);

        if (op === 'AND' || op === 'OR') {
            if (l.kind !== 'unknown' && !isBoolean(l)) accept('error', `operand must be BOOLEAN, got ${describeType(l)}`, { node: node.left });
            if (r.kind !== 'unknown' && !isBoolean(r)) accept('error', `operand must be BOOLEAN, got ${describeType(r)}`, { node: node.right });
            return;
        }

        // A collection is a legitimate right-hand operand for `IN` (spec §5.1 —
        // "IN expects a ListLiteral or collection expression on the right");
        // everywhere else, and on IN's own left side, it must be reduced first.
        if (l.kind === 'collection' || (op !== 'IN' && r.kind === 'collection')) {
            accept(
                'error',
                `a collection-valued expression cannot be used with '${op}' — reduce it with an aggregate or a predicate-over-filter first`,
                { node }
            );
            return;
        }

        if (op === '==' || op === '!=') {
            if (!equalityCompatible(l, r)) {
                accept('error', `cannot compare ${describeType(l)} and ${describeType(r)} without an explicit CAST`, { node });
            }
            return;
        }

        if (op === '<' || op === '<=' || op === '>' || op === '>=') {
            if (l.kind === 'null' || r.kind === 'null') {
                accept('error', `'${op}' does not accept null as an operand`, { node });
                return;
            }
            if (!orderingCompatible(l, r)) {
                accept('error', `cannot order-compare ${describeType(l)} and ${describeType(r)}`, { node });
            }
            return;
        }

        if (op === 'LIKE') {
            if (l.kind === 'null' || r.kind === 'null') {
                accept('error', "'LIKE' does not accept null as an operand", { node });
                return;
            }
            if (l.kind !== 'unknown' && !isStringish(l)) accept('error', `'LIKE' requires a TEXT/CITEXT operand, got ${describeType(l)}`, { node: node.left });
            if (r.kind !== 'unknown' && !isStringish(r)) accept('error', `'LIKE' requires a TEXT/CITEXT operand, got ${describeType(r)}`, { node: node.right });
            return;
        }

        if (op === 'IN') {
            const elementType: MinabType | undefined =
                r.kind === 'array' ? { kind: 'scalar', base: r.elementBase, nullable: r.elementNullable } : r.kind === 'collection' ? r.element : undefined;
            if (elementType && !equalityCompatible(l, elementType)) {
                accept('error', `cannot check ${describeType(l)} IN a collection of ${describeType(elementType)} without an explicit CAST`, { node });
            }
            return;
        }

        // arithmetic: +, -, *, /, %
        if (op === '+' && isStringish(l) && isStringish(r)) {
            return; // string concatenation
        }
        if (l.kind === 'unknown' || r.kind === 'unknown') {
            return;
        }
        if (!isNumeric(l) || !isNumeric(r)) {
            accept('error', `'${op}' requires numeric operands, got ${describeType(l)} and ${describeType(r)}`, { node });
            return;
        }
        if (!basesCompatible(l.base, r.base, l.literal, r.literal)) {
            accept('error', `cannot use '${op}' between ${describeType(l)} and ${describeType(r)} without an explicit CAST`, { node });
        }
    };

    checkUnaryExpression = (node: UnaryExpression, accept: ValidationAcceptor): void => {
        const t = this.checker.typeOf(node.operand);
        if (t.kind === 'unknown') return;
        if (node.negated) {
            if (!isBoolean(t)) accept('error', `'NOT' requires a BOOLEAN operand, got ${describeType(t)}`, { node: node.operand });
            return;
        }
        if (!isNumeric(t)) {
            accept('error', `unary '${node.operator}' requires a numeric operand, got ${describeType(t)}`, { node: node.operand });
        }
    };

    checkMemberAccess = (node: MemberAccess, accept: ValidationAcceptor): void => {
        this.checkFieldAccess(this.checker.typeOf(node.receiver), node.member, node, accept);
    };

    checkCurrentRecord = (node: CurrentRecord, accept: ValidationAcceptor): void => {
        if (!node.field) return;
        const base = this.scopeResolver.resolveCurrentRecordScope(node);
        if (!base.found) {
            accept('error', base.reason, { node });
            return;
        }
        const receiverType: MinabType = base.scope.tableName ? { kind: 'ref', table: base.scope.tableName, nullable: false } : { kind: 'unknown' };
        this.checkFieldAccess(receiverType, node.field, node, accept);
    };

    private checkFieldAccess(receiverType: MinabType, member: string, node: AstNode, accept: ValidationAcceptor): void {
        if (receiverType.kind === 'unknown') return;
        if (receiverType.kind === 'ref') {
            if (!receiverType.table) return;
            if (!this.schema.getColumn(receiverType.table, member)) {
                accept('error', `unknown column "${member}" on table "${receiverType.table}"`, { node });
            }
            return;
        }
        if (receiverType.kind === 'collection') {
            this.checkFieldAccess(receiverType.element, member, node, accept);
            return;
        }
        accept('error', `cannot access field '.${member}' on ${describeType(receiverType)}`, { node });
    }

    checkNameRef = (node: NameRef, accept: ValidationAcceptor): void => {
        const container = node.$container;
        if (isCallExpression(container) && container.callee === node) {
            return; // a function-call callee (built-in or host-declared), not a variable/alias reference — checked (permissively, §12 item 10) by checkCallExpression instead
        }
        const res = this.scopeResolver.resolveNameRef(node);
        if (!res.found) {
            accept('error', res.reason, { node });
        }
    };

    checkTableRef = (node: import('./generated/ast.js').TableRef, accept: ValidationAcceptor): void => {
        const res = this.scopeResolver.resolveTableRef(node);
        if (!res.found) {
            accept('error', res.reason, { node });
        }
    };

    checkCallExpression = (node: CallExpression, accept: ValidationAcceptor): void => {
        if (!isNameRef(node.callee)) return;
        const name = node.callee.name;
        if (name === 'COUNT') return; // polymorphic (a group's rows via bare `.`, or a real collection) — not strictly typed
        if (PREDICATES.has(name) || AGGREGATES.has(name)) {
            if (node.args.length !== 1) {
                accept('error', `'${name}' takes exactly one argument`, { node });
                return;
            }
            const argType = this.checker.typeOf(node.args[0]);
            if (argType.kind === 'unknown') return;
            if (PREDICATES.has(name)) {
                if (argType.kind !== 'collection') {
                    accept('error', `'${name}' requires a collection (e.g. an inline-filtered relation), got ${describeType(argType)}`, { node: node.args[0] });
                }
                return;
            }
            // SUM/AVG/MIN/MAX accept either an explicit collection (`SUM(.orders.total)`)
            // or, after GROUPBY, a per-row scalar aggregated implicitly across the
            // current group (`.` means "a row within the group" there, spec §4.1,
            // so `SUM(.total)` is valid without `.total` itself being a collection).
            const elementType = argType.kind === 'collection' ? argType.element : argType;
            if ((name === 'SUM' || name === 'AVG') && !isNumeric(elementType)) {
                accept('error', `'${name}' requires a numeric value or collection, got ${describeType(argType)}`, { node: node.args[0] });
            }
            return;
        }
        const fn = this.schema.getFunction(name);
        if (fn) {
            this.checkCallArgs(node.args, fn.paramTypes, name, node, accept);
        }
    };

    checkFunctionCall = (node: FunctionCall, accept: ValidationAcceptor): void => {
        const decl = this.checker.findFunctionDecl(node, node.name);
        if (!decl) {
            accept('error', `unknown function "&${node.name}"`, { node });
            return;
        }
        this.checkCallArgs(node.args, decl.params.map(p => typeFromTypeNode(p.type)), `&${node.name}`, node, accept);
    };

    private checkCallArgs(args: Expression[], paramTypes: MinabType[], label: string, node: AstNode, accept: ValidationAcceptor): void {
        if (args.length !== paramTypes.length) {
            accept('error', `'${label}' expects ${paramTypes.length} argument(s), got ${args.length}`, { node });
            return;
        }
        args.forEach((arg, i) => {
            const argType = this.checker.typeOf(arg);
            if (argType.kind !== 'unknown' && !isAssignable(argType, paramTypes[i])) {
                accept('error', `argument ${i + 1} to '${label}' expects ${describeType(paramTypes[i])}, got ${describeType(argType)}`, { node: arg });
            }
        });
    }

    checkFunctionDecl = (node: FunctionDecl, accept: ValidationAcceptor): void => {
        if (!node.tail || isQuery(node.tail)) return;
        const tailType = this.checker.typeOf(node.tail);
        const returnType = typeFromTypeNode(node.returnType);
        if (tailType.kind !== 'unknown' && !isAssignable(tailType, returnType)) {
            accept('error', `function body's tail type ${describeType(tailType)} doesn't match declared return type ${describeType(returnType)}`, { node: node.tail });
        }
    };

    checkIfExpr = (node: IfExpr, accept: ValidationAcceptor): void => {
        this.checkBooleanCondition(node.condition, accept);
        const other = node.elseBranch ?? node.elseIf;
        if (!other) return;
        const t1 = this.checker.typeOf(node.thenBranch);
        const t2 = this.checker.typeOf(other);
        if (t1.kind !== 'unknown' && t2.kind !== 'unknown' && !isAssignable(t1, t2) && !isAssignable(t2, t1)) {
            accept('error', `if/else branches must agree in type — got ${describeType(t1)} and ${describeType(t2)}`, { node });
        }
    };

    checkTupleAccess = (node: TupleAccess, accept: ValidationAcceptor): void => {
        const t = this.checker.typeOf(node.receiver);
        if (t.kind === 'unknown') return;
        if (t.kind === 'tuple') {
            if (node.index < 0 || node.index >= t.elements.length) {
                accept('error', `tuple index ${node.index} is out of bounds for a ${t.elements.length}-element tuple`, { node });
            }
            return;
        }
        if (t.kind === 'array' || (t.kind === 'scalar' && t.base === 'JSON')) {
            return; // a literal positional index into an array/JSON value (spec §3.5) — no static bounds check possible
        }
        if (t.kind === 'collection') {
            accept('error', 'a positional index is not valid on a relational collection — its row order is not guaranteed without an explicit ORDERBY', { node });
            return;
        }
        accept('error', `'[${node.index}]' positional access requires a tuple, array, or JSON value, got ${describeType(t)}`, { node });
    };

    checkFilterAccess = (node: FilterAccess, accept: ValidationAcceptor): void => {
        const receiverType = this.checker.typeOf(node.receiver);
        const filterType = this.checker.typeOf(node.filter);
        if (receiverType.kind === 'unknown') return;
        if (filterType.kind === 'scalar' && filterType.base === 'INTEGER') {
            if (receiverType.kind === 'collection') {
                accept('error', 'a positional index is not valid on a relational collection — its row order is not guaranteed without an explicit ORDERBY', {
                    node: node.filter
                });
            }
            return;
        }
        if (filterType.kind !== 'unknown' && !isBoolean(filterType)) {
            accept('error', `filter expression must be BOOLEAN, got ${describeType(filterType)}`, { node: node.filter });
        }
    };

    checkListLiteral = (node: ListLiteral, accept: ValidationAcceptor): void => {
        const types = node.items.map(i => this.checker.typeOf(i));
        const firstScalar = types.find((t): t is ScalarType => t.kind === 'scalar');
        if (!firstScalar) return;
        types.forEach((t, i) => {
            if (t.kind === 'unknown' || t.kind === 'null') return;
            if (t.kind !== 'scalar' || !basesCompatible(t.base, firstScalar.base, t.literal, firstScalar.literal)) {
                accept('error', `list literal elements must share a compatible type — got ${describeType(t)} alongside ${describeType(firstScalar)}`, {
                    node: node.items[i]
                });
            }
        });
    };
}

export function registerTypeCheckingChecks(services: {
    validation: { ValidationRegistry: { register: (checks: ValidationChecks<import('./generated/ast.js').MinabAstType>, thisObj: unknown) => void } };
    schema: SchemaProvider;
    scopeResolver: MinabScopeResolver;
    typeChecker: MinabTypeChecker;
}): void {
    const validator = new MinabTypeValidator(services.typeChecker, services.schema, services.scopeResolver);
    const checks: ValidationChecks<import('./generated/ast.js').MinabAstType> = {
        VariableDecl: validator.checkVariableDecl,
        AssignmentStatement: validator.checkAssignmentStatement,
        Query: validator.checkQuery,
        LoopStatement: validator.checkLoopStatement,
        BinaryExpression: validator.checkBinaryExpression,
        UnaryExpression: validator.checkUnaryExpression,
        MemberAccess: validator.checkMemberAccess,
        CurrentRecord: validator.checkCurrentRecord,
        NameRef: validator.checkNameRef,
        TableRef: validator.checkTableRef,
        CallExpression: validator.checkCallExpression,
        FunctionCall: validator.checkFunctionCall,
        FunctionDecl: validator.checkFunctionDecl,
        IfExpr: validator.checkIfExpr,
        TupleAccess: validator.checkTupleAccess,
        FilterAccess: validator.checkFilterAccess,
        ListLiteral: validator.checkListLiteral
    };
    services.validation.ValidationRegistry.register(checks, validator);
}
