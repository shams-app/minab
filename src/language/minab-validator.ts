/**
 * Semantic validation (roadmap Phases 3–4). Catches programs that parse
 * cleanly but violate a rule the grammar can't express:
 *
 *  - `$` (`FieldValue`) used when the host hasn't marked this program as
 *    a field-level rule (`schema.ts`'s `MinabRuleContext`).
 *  - `KEY` (`GroupKeyRef`) used outside a `GROUPBY`-scoped clause.
 *  - `#alias` (`NamedScope`) referencing an undeclared table/scope.
 *  - Phase 4: no-implicit-coercion (spec §5.5), the §3.4 collection-vs-
 *    scalar boundary, the §7.7 null-operand rules, unknown-function calls
 *    (§5.3), the function-name rules of D10 and D11 (a `fn` name needs a
 *    lowercase letter; a `fn` may not share a name with a table, `let` or
 *    parameter), and the `FunctionDecl` rule from §8.6 (a `Query`-tailed
 *    function's return type must be `JSON`).
 *
 * The first three are thin wrappers around `MinabScopeResolver` (Phase 2),
 * which already does the scope-stack walking and produces a human-readable
 * `reason` string on failure — this file's job is only to turn
 * `{found: false}` into a diagnostic. The Phase 4 checks follow the same
 * shape against `MinabTypeChecker.inferType` (Phase 4, `minab-type-
 * checker.ts`): `{ok: false, reason}` becomes a diagnostic at the node
 * that produced it. `checkExpressionTypeChecks` is registered on several
 * container expression types whose own inference recurses into their
 * children's — so the same failing child would once get re-inferred and
 * re-reported by every registered ancestor above it. `inferType`'s `origin`
 * (roadmap Phase 7) fixes that: a failure only gets accepted at the node
 * where it actually originates, so an ancestor re-inferring the same
 * subexpression sees `origin` pointing elsewhere and stays quiet — one
 * mistake, one diagnostic.
 */

import { AstUtils, type AstNode, type DiagnosticInfo, type ValidationAcceptor, type ValidationChecks } from 'langium';
import {
    isBlock,
    isFilterAccess,
    isFunctionDecl,
    isJsonObjectLiteral,
    isListLiteral,
    isLoopStatement,
    isCallExpression,
    isMemberAccess,
    isModel,
    isNameRef,
    isOrderByClause,
    isQuery,
    isTupleAccess,
    isTypeRef,
    isVariableDecl,
    type AssignmentStatement,
    type BinaryExpression,
    type CallExpression,
    type CallStatement,
    type CurrentRecord,
    type DeleteStatement,
    type Expression,
    type FieldValue,
    type FilterAccess,
    type FunctionDecl,
    type GroupByClause,
    type GroupKeyRef,
    type HavingClause,
    type IfExpr,
    type InsertStatement,
    type ListLiteral,
    type MemberAccess,
    type MinabAstType,
    type NamedScope,
    type NameRef,
    type Param,
    type ParentRecord,
    type SwitchExpr,
    type Subquery,
    type TupleAccess,
    type UnaryExpression,
    type UpdateStatement,
    type VariableDecl,
    type WhereClause
} from './generated/ast.js';
import { coded, DIAGNOSTICS, type CodedMessage } from './diagnostics/codes.js';
import { findUserFunction, groupKeyName, inlineBlocker } from './minab-query-inlining.js';
import { astTypeToMinabType } from './minab-type-checker.js';
import { formatType, isAssignableTo, isNullable } from './minab-types.js';
import type { MinabServices } from './minab-module.js';

/**
 * Reports a coded diagnostic: the English message is the text, the code goes
 * to the LSP `code` field, and the parameters go to `data.params`, so a host
 * can translate the message by its code (decision D35).
 */
function report<N extends AstNode>(accept: ValidationAcceptor, diagnostic: CodedMessage, info: DiagnosticInfo<N>): void {
    accept(DIAGNOSTICS[diagnostic.code].severity, diagnostic.reason, { ...info, code: diagnostic.code, data: { params: diagnostic.params } });
}

export function registerValidationChecks(services: MinabServices): void {
    const registry = services.validation.ValidationRegistry;
    const validator = new MinabValidator(services);
    const checks: ValidationChecks<MinabAstType> = {
        FieldValue: validator.checkFieldValueInFieldRule,
        GroupKeyRef: validator.checkGroupKeyRefScope,
        NamedScope: validator.checkNamedScopeResolves,
        BinaryExpression: validator.checkExpressionTypeChecks,
        UnaryExpression: validator.checkExpressionTypeChecks,
        MemberAccess: [validator.checkExpressionTypeChecks, validator.checkVivifyNotOnCollection],
        TupleAccess: validator.checkExpressionTypeChecks,
        FilterAccess: validator.checkExpressionTypeChecks,
        CallExpression: [validator.checkExpressionTypeChecks, validator.checkFunctionInlinable, validator.checkLogNotInSql],
        CallStatement: validator.checkCallStatementIsCall,
        ListLiteral: validator.checkExpressionTypeChecks,
        IfExpr: validator.checkExpressionTypeChecks,
        SwitchExpr: validator.checkExpressionTypeChecks,
        CurrentRecord: [validator.checkExpressionTypeChecks, validator.checkVivifyNotOnCollection],
        ParentRecord: validator.checkExpressionTypeChecks,
        NameRef: validator.checkNameRefTypeChecks,
        Subquery: validator.checkExpressionTypeChecks,
        WhereClause: validator.checkConditionIsBoolean,
        HavingClause: validator.checkConditionIsBoolean,
        GroupByClause: [validator.checkGroupKeysNotCollection, validator.checkGroupKeyNamesUnique, validator.checkGroupKeysNamed],
        AssignmentStatement: [validator.checkAssignmentTypeCompatible, validator.checkAssignmentNotInRule],
        InsertStatement: [validator.checkWriteNotInRule, validator.checkInsertColumns],
        UpdateStatement: [validator.checkWriteNotInRule, validator.checkUpdateColumns],
        DeleteStatement: [validator.checkWriteNotInRule, validator.checkWriteTarget],
        VariableDecl: [validator.checkVariableDeclTypeCompatible, validator.checkVariableNotFunctionName, validator.checkLetNotRepeated],
        Param: validator.checkParamNotFunctionName,
        FunctionDecl: [validator.checkFunctionDeclName, validator.checkFunctionDeclReturnType]
    };
    registry.register(checks, validator);
}

export class MinabValidator {
    constructor(private readonly services: MinabServices) {}

    checkFieldValueInFieldRule(node: FieldValue, accept: ValidationAcceptor): void {
        if (!this.services.ruleContext.isFieldRule) {
            report(accept, coded('rule.fieldValueOutsideFieldRule'), { node });
        }
    }

    checkGroupKeyRefScope(node: GroupKeyRef, accept: ValidationAcceptor): void {
        const result = this.services.scopeResolver.resolveGroupKeyRef(node);
        if (!result.found) {
            report(accept, result, { node });
            return;
        }
        // With several keys, a bare `KEY` has no value: only `KEY.<name>` does (D22).
        if (isMemberAccess(node.$container) && node.$container.receiver === node) return;
        const typed = this.services.typeChecker.inferType(node);
        if (!typed.ok) report(accept, typed, { node });
    }

    checkNamedScopeResolves(node: NamedScope, accept: ValidationAcceptor): void {
        const result = this.services.scopeResolver.resolveNamedScope(node);
        if (!result.found) {
            report(accept, result, { node });
        }
    }

    // ---- Phase 4: type checking ----------------------------------------

    /**
     * `inferType`'s `origin` (see `minab-type-checker.ts`) is the node
     * whose own inference first produced a failure — accepting only when
     * `origin === node` is what keeps this from reporting once per
     * enclosing node in the list above: an ancestor re-inferring the same
     * failing subexpression sees `origin` pointing at its descendant and
     * stays quiet, so one mistake produces exactly one diagnostic.
     */
    checkExpressionTypeChecks(
        node:
            | BinaryExpression
            | UnaryExpression
            | MemberAccess
            | TupleAccess
            | FilterAccess
            | CallExpression
            | ListLiteral
            | IfExpr
            | SwitchExpr
            | CurrentRecord
            | ParentRecord
            | NameRef
            | Subquery,
        accept: ValidationAcceptor
    ): void {
        const result = this.services.typeChecker.inferType(node);
        if (!result.ok && result.origin === node) {
            report(accept, result, { node });
        }
    }

    /**
     * Two kinds of `NameRef` are not values, so they are skipped here:
     *  - the callee of a call is a function name. The call itself reports
     *    an unknown function;
     *  - in `ORDERBY`, a name that is a `SELECT` alias (spec §4.1).
     */
    checkNameRefTypeChecks(node: NameRef, accept: ValidationAcceptor): void {
        if (isCallExpression(node.$container) && node.$containerProperty === 'callee') return;
        if (this.isSelectAliasInOrderBy(node)) return;
        this.checkExpressionTypeChecks(node, accept);
    }

    private isSelectAliasInOrderBy(node: NameRef): boolean {
        const orderBy = AstUtils.getContainerOfType(node, isOrderByClause);
        const query = orderBy?.$container;
        if (!orderBy || !isQuery(query)) return false;
        return query.selectClause?.items.some(item => item.alias === node.name) ?? false;
    }

    checkConditionIsBoolean(node: WhereClause | HavingClause, accept: ValidationAcceptor): void {
        const result = this.services.typeChecker.inferType(node.condition);
        if (!result.ok) {
            // Already reported at the specific failing sub-expression by
            // `checkExpressionTypeChecks` — don't double up here.
            return;
        }
        if (result.type.kind !== 'scalar' || result.type.base !== 'BOOLEAN' || result.type.array) {
            report(accept, coded('type.conditionNotBoolean', { actual: formatType(result.type) }), { node, property: 'condition' });
        }
    }

    checkGroupKeysNotCollection(node: GroupByClause, accept: ValidationAcceptor): void {
        node.keys.forEach(key => {
            const result = this.services.typeChecker.inferType(key.expression);
            if (result.ok && result.type.kind === 'collection') {
                report(accept, coded('type.collectionAsGroupKey'), { node: key, property: 'expression' });
            }
        });
    }

    /** Two `GROUPBY` keys may not have the same name (`AS name`, or the last field of a plain path when there are several keys). */
    checkGroupKeyNamesUnique(node: GroupByClause, accept: ValidationAcceptor): void {
        const seen = new Set<string>();
        for (const key of node.keys) {
            const name = node.keys.length > 1 ? groupKeyName(key) : key.alias;
            if (name === undefined) continue;
            if (seen.has(name))
                report(accept, coded('query.duplicateGroupKeyName', { name }), { node: key, property: key.alias === undefined ? 'expression' : 'alias' });
            seen.add(name);
        }
    }

    /** With several keys, `KEY.<name>` reads one, so a computed key needs `AS name` (D22). */
    checkGroupKeysNamed(node: GroupByClause, accept: ValidationAcceptor): void {
        if (node.keys.length < 2) return;
        for (const key of node.keys) {
            if (groupKeyName(key) === undefined) report(accept, coded('query.unnamedGroupKey'), { node: key, property: 'expression' });
        }
    }

    /**
     * A user function called inside a query is copied into the SQL (D23). That works only for a
     * simple function, so `check` says so here and does not leave it to `compile`.
     */
    checkFunctionInlinable(node: CallExpression, accept: ValidationAcceptor): void {
        if (!isNameRef(node.callee) || !AstUtils.getContainerOfType(node, isQuery)) return;
        const name = node.callee.name;
        if (this.services.schema.getHostFunction(name)) return;
        const decl = findUserFunction(node, name);
        if (!decl) return;
        const reason = inlineBlocker(decl, host => !!this.services.schema.getHostFunction(host));
        if (reason) report(accept, coded('query.functionNotInlinable', { name, reason }), { node });
    }

    /**
     * `LOG` in a part that runs as SQL (D19): inside a query, or inside a filter on a collection
     * (the filter is sent to the database). There `LOG(x)` is plain `x`, so nothing prints.
     */
    checkLogNotInSql(node: CallExpression, accept: ValidationAcceptor): void {
        if (!isNameRef(node.callee) || node.callee.name !== 'LOG') return;
        if (AstUtils.getContainerOfType(node, isQuery) || this.isInCollectionFilter(node)) {
            report(accept, coded('call.logInSql'), { node });
        }
    }

    private isInCollectionFilter(node: AstNode): boolean {
        for (let current = node; current.$container; current = current.$container) {
            const parent = current.$container;
            if (!isFilterAccess(parent) || current.$containerProperty !== 'filter') continue;
            const receiver = this.services.typeChecker.inferType(parent.receiver);
            if (receiver.ok && receiver.type.kind === 'collection') return true;
        }
        return false;
    }

    /** A statement that stands alone must be a call (`LOG(x);`). The grammar takes any expression, so this check narrows it. */
    checkCallStatementIsCall(node: CallStatement, accept: ValidationAcceptor): void {
        if (!isCallExpression(node.call)) report(accept, coded('call.statementNotACall'), { node, property: 'call' });
    }

    /**
     * Spec §12 item 17. `!` creates a missing `ref` in an assignment path. A `collection` is never
     * null (§7.7), so `!` on a collection step has nothing to do: it is an error.
     */
    checkVivifyNotOnCollection(node: MemberAccess | CurrentRecord, accept: ValidationAcceptor): void {
        if (!node.vivify) return;
        const result = this.services.typeChecker.inferType(node);
        if (!result.ok || result.type.kind !== 'collection') return;
        const member = isMemberAccess(node) ? node.member : (node.field ?? '');
        report(accept, coded('type.vivifyOnCollection', { member }), { node, property: 'vivify' });
    }

    /**
     * Spec §12 item 8. A second `let` with the same name in the same block (or function body, loop
     * body, or top level) is an error. An inner block may declare the name again: it shadows.
     */
    checkLetNotRepeated(node: VariableDecl, accept: ValidationAcceptor): void {
        const container = node.$container;
        const siblings: AstNode[] | undefined =
            isBlock(container) || isLoopStatement(container)
                ? container.statements
                : isFunctionDecl(container)
                  ? container.body
                  : isModel(container)
                    ? container.declarations
                    : undefined;
        if (!siblings) return;
        const earlier = siblings.slice(0, siblings.indexOf(node)).some(s => isVariableDecl(s) && s.name === node.name);
        if (earlier) report(accept, coded('scope.duplicateLet', { name: node.name }), { node, property: 'name' });
    }

    // ---- writes (X5, D26) ---------------------------------------------------

    /** Is the program checked as a record rule or a field rule? Those only read. */
    private get inRule(): boolean {
        const context = this.services.ruleContext;
        return context.isFieldRule || context.recordTable !== undefined;
    }

    /** A rule cannot write (D26): the write is for a program that a host runs on purpose. */
    checkWriteNotInRule(node: InsertStatement | UpdateStatement | DeleteStatement, accept: ValidationAcceptor): void {
        if (this.inRule) report(accept, coded('rule.writeInRule'), { node });
    }

    /** `.field = x` writes to the record under validation. A local variable is not a write. */
    checkAssignmentNotInRule(node: AssignmentStatement, accept: ValidationAcceptor): void {
        if (this.inRule && !this.assignmentRoot(node.target)) report(accept, coded('rule.writeInRule'), { node, property: 'target' });
    }

    /** The table an INSERT, UPDATE or DELETE writes to, or a diagnostic when the target is no table. */
    checkWriteTarget(node: InsertStatement | UpdateStatement | DeleteStatement, accept: ValidationAcceptor): string | undefined {
        const target = this.services.typeChecker.inferType(node.target);
        // A failed inference has its own diagnostic at the node that failed.
        if (!target.ok) return undefined;
        if (target.type.kind !== 'collection') {
            report(accept, coded('compile.writeTarget'), { node, property: 'target' });
            return undefined;
        }
        return target.type.table;
    }

    checkInsertColumns(node: InsertStatement, accept: ValidationAcceptor): void {
        const table = this.checkWriteTarget(node, accept);
        if (!table) return;
        const payload = node.payload;
        const objects = isJsonObjectLiteral(payload) ? [payload] : isListLiteral(payload) ? payload.items.filter(isJsonObjectLiteral) : [];
        for (const object of objects) {
            for (const property of object.properties) {
                const value = property.value ?? ({ $type: 'NameRef', name: property.key } as NameRef);
                this.checkColumnValue(table, property.key, ':', value, property, accept);
            }
        }
    }

    checkUpdateColumns(node: UpdateStatement, accept: ValidationAcceptor): void {
        const table = this.checkWriteTarget(node, accept);
        if (!table) return;
        const assignments = node.setClause.assignments;
        if (assignments.length === 0) report(accept, coded('compile.writeEmptySet'), { node: node.setClause });
        for (const assignment of assignments) {
            this.checkColumnValue(table, assignment.key, assignment.operator, assignment.value, assignment, accept);
        }
    }

    /** A written column must be a plain column of the table, and the value must fit its type (no implicit coercion). */
    private checkColumnValue(table: string, name: string, operator: string, value: Expression, where: AstNode, accept: ValidationAcceptor): void {
        const column = this.services.schema.getColumn(table, name);
        if (!column || column.type.kind !== 'scalar') {
            report(accept, coded('compile.writeColumn', { table, column: name }), { node: where });
            return;
        }
        const result = this.services.typeChecker.inferType(value);
        if (!result.ok) return;
        const columnType = column.type.type;
        // `+:` `-:` `*:` `/:` and `:|` take a value of the kind they combine with; a plain `:` takes the column's own type.
        const expected = operator === ':|' ? undefined : columnType;
        if (operator !== ':' && operator !== ':|') {
            const numeric = columnType.kind === 'scalar' && !columnType.array && (columnType.base === 'INTEGER' || columnType.base === 'DECIMAL');
            const text = columnType.kind === 'scalar' && !columnType.array && (columnType.base === 'TEXT' || columnType.base === 'CITEXT');
            if (!(numeric || (operator === '+:' && text))) {
                report(accept, coded('type.assignNeedsNumericTarget', { operator, actual: formatType(columnType) }), { node: where });
                return;
            }
        }
        if (operator === ':|') {
            if (!(columnType.kind === 'scalar' && !columnType.array && columnType.base === 'JSON')) {
                report(accept, coded('type.mergeAssignTarget', { actual: formatType(columnType) }), { node: where });
            }
            return;
        }
        if (expected && !isAssignableTo(result.type, expected)) {
            report(accept, coded('type.assignMismatch', { actual: formatType(result.type), expected: formatType(expected) }), { node: where });
        }
    }

    checkAssignmentTypeCompatible(node: AssignmentStatement, accept: ValidationAcceptor): void {
        const root = this.assignmentRoot(node.target);
        if (root && this.isHostInputRef(root)) {
            report(accept, coded('scope.assignToInput', { name: root.name }), { node, property: 'target' });
            return;
        }
        const targetResult = this.services.typeChecker.inferType(node.target);
        const valueResult = this.services.typeChecker.inferType(node.value);
        if (!targetResult.ok || !valueResult.ok) return;
        const target = targetResult.type;
        const value = valueResult.type;
        const isNumericTarget = target.kind === 'scalar' && !target.array && (target.base === 'INTEGER' || target.base === 'DECIMAL');
        const isTextTarget = target.kind === 'scalar' && !target.array && (target.base === 'TEXT' || target.base === 'CITEXT');

        switch (node.operator) {
            case '?=':
                if (!isNullable(target)) {
                    report(accept, coded('null.optionalAssignNeedsNullable'), { node, property: 'operator' });
                }
                return;
            case '-=':
            case '*=':
            case '/=':
                if (!isNumericTarget) {
                    report(accept, coded('type.assignNeedsNumericTarget', { operator: node.operator, actual: formatType(target) }), {
                        node,
                        property: 'operator'
                    });
                    return;
                }
                break;
            case '+=':
                if (!isNumericTarget && !isTextTarget) {
                    report(accept, coded('type.plusAssignTarget', { actual: formatType(target) }), { node, property: 'operator' });
                    return;
                }
                break;
            case '|=':
                if (!(target.kind === 'record' || (target.kind === 'scalar' && !target.array && target.base === 'JSON'))) {
                    report(accept, coded('type.mergeAssignTarget', { actual: formatType(target) }), { node, property: 'operator' });
                }
                return;
            default:
                break; // '='
        }
        if (!isAssignableTo(value, target)) {
            report(accept, coded('type.assignMismatch', { actual: formatType(value), expected: formatType(target) }), { node, property: 'value' });
        }
    }

    /** The bare name an assignment target starts from: `currentUser` in `currentUser.id = 1;`. */
    private assignmentRoot(target: Expression): NameRef | undefined {
        let current = target;
        while (isMemberAccess(current) || isTupleAccess(current) || isFilterAccess(current)) current = current.receiver;
        return isNameRef(current) ? current : undefined;
    }

    private isHostInputRef(node: NameRef): boolean {
        const resolved = this.services.scopeResolver.resolveNameRef(node);
        return resolved.found && resolved.scope.hostInput !== undefined;
    }

    checkVariableDeclTypeCompatible(node: VariableDecl, accept: ValidationAcceptor): void {
        if (!node.value) return;
        const valueResult = this.services.typeChecker.inferType(node.value);
        if (!valueResult.ok) return;
        const target = astTypeToMinabType(node.type);
        if (!isAssignableTo(valueResult.type, target)) {
            report(accept, coded('type.initializerMismatch', { name: node.name, expected: formatType(target), actual: formatType(valueResult.type) }), {
                node,
                property: 'value'
            });
        }
    }

    /**
     * D10: a built-in name is ALL UPPERCASE, so a `fn` name must have a
     * lowercase letter. A new built-in can then never clash with a `fn`.
     * D11: a `fn` may not have the name of a schema table.
     */
    checkFunctionDeclName(node: FunctionDecl, accept: ValidationAcceptor): void {
        if (!/\p{Ll}/u.test(node.name)) {
            report(accept, coded('call.functionNameCase', { name: node.name }), { node, property: 'name' });
        }
        if (this.services.schema.getTable(node.name)) {
            report(accept, coded('scope.functionNameIsTable', { name: node.name }), { node, property: 'name' });
        }
        if (this.services.schema.isHostName(node.name)) {
            report(accept, coded('scope.nameIsHostName', { name: node.name }), { node, property: 'name' });
        }
    }

    /** D11: a `let` may not have the name of a declared `fn`, a host input or a host function. */
    checkVariableNotFunctionName(node: VariableDecl, accept: ValidationAcceptor): void {
        if (this.isFunctionName(node, node.name)) {
            report(accept, coded('scope.nameIsFunction', { name: node.name }), { node, property: 'name' });
        } else if (this.services.schema.isHostName(node.name)) {
            report(accept, coded('scope.nameIsHostName', { name: node.name }), { node, property: 'name' });
        }
    }

    /** D11: a parameter may not have the name of a declared `fn`, a host input or a host function. */
    checkParamNotFunctionName(node: Param, accept: ValidationAcceptor): void {
        if (this.isFunctionName(node, node.name)) {
            report(accept, coded('scope.nameIsFunction', { name: node.name }), { node, property: 'name' });
        } else if (this.services.schema.isHostName(node.name)) {
            report(accept, coded('scope.nameIsHostName', { name: node.name }), { node, property: 'name' });
        }
    }

    private isFunctionName(node: AstNode, name: string): boolean {
        const model = AstUtils.getContainerOfType(node, isModel);
        return model?.declarations.some(d => isFunctionDecl(d) && d.name === name) ?? false;
    }

    /**
     * A `Query`-tailed function must declare `JSON` (spec §8.6). A plain-
     * `Expression`-tailed function's actual result must match its declared
     * return type — an ordinary `no implicit coercion` check, same as
     * `VariableDecl`'s, just checked against `returnType` instead of a
     * `let`'s own declared type.
     */
    checkFunctionDeclReturnType(node: FunctionDecl, accept: ValidationAcceptor): void {
        if (!node.tail) return;
        if (isQuery(node.tail)) {
            const isJson = isTypeRef(node.returnType) && node.returnType.base === 'JSON';
            if (!isJson) {
                report(accept, coded('query.functionReturnNotJson'), { node, property: 'returnType' });
            }
            return;
        }
        const tailResult = this.services.typeChecker.inferType(node.tail);
        if (!tailResult.ok) return;
        const declared = astTypeToMinabType(node.returnType);
        if (!isAssignableTo(tailResult.type, declared)) {
            report(accept, coded('type.functionReturnMismatch', { actual: formatType(tailResult.type), expected: formatType(declared) }), {
                node,
                property: 'returnType'
            });
        }
    }
}
