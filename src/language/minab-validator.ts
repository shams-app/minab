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
 *    and the built-in/`&`-prefixed split (§5.3), and the two `FunctionDecl`
 *    rules from §5.3/§8.6 (reserved built-in names; a `Query`-tailed
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

import type { AstNode, DiagnosticInfo, ValidationAcceptor, ValidationChecks } from 'langium';
import {
    isQuery,
    isTypeRef,
    type AssignmentStatement,
    type BinaryExpression,
    type CallExpression,
    type CurrentRecord,
    type FieldValue,
    type FilterAccess,
    type FunctionCall,
    type FunctionDecl,
    type GroupByClause,
    type GroupKeyRef,
    type HavingClause,
    type IfExpr,
    type ListLiteral,
    type MemberAccess,
    type MinabAstType,
    type NamedScope,
    type SwitchExpr,
    type TupleAccess,
    type UnaryExpression,
    type VariableDecl,
    type WhereClause
} from './generated/ast.js';
import { coded, DIAGNOSTICS, type CodedMessage } from './diagnostics/codes.js';
import { isBuiltinName } from './minab-builtins.js';
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
        MemberAccess: validator.checkExpressionTypeChecks,
        TupleAccess: validator.checkExpressionTypeChecks,
        FilterAccess: validator.checkExpressionTypeChecks,
        CallExpression: validator.checkExpressionTypeChecks,
        FunctionCall: validator.checkExpressionTypeChecks,
        ListLiteral: validator.checkExpressionTypeChecks,
        IfExpr: validator.checkExpressionTypeChecks,
        SwitchExpr: validator.checkExpressionTypeChecks,
        CurrentRecord: validator.checkExpressionTypeChecks,
        WhereClause: validator.checkConditionIsBoolean,
        HavingClause: validator.checkConditionIsBoolean,
        GroupByClause: validator.checkGroupKeysNotCollection,
        AssignmentStatement: validator.checkAssignmentTypeCompatible,
        VariableDecl: validator.checkVariableDeclTypeCompatible,
        FunctionDecl: [validator.checkFunctionDeclNotReservedName, validator.checkFunctionDeclReturnType]
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
        }
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
            | FunctionCall
            | ListLiteral
            | IfExpr
            | SwitchExpr
            | CurrentRecord,
        accept: ValidationAcceptor
    ): void {
        const result = this.services.typeChecker.inferType(node);
        if (!result.ok && result.origin === node) {
            report(accept, result, { node });
        }
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
        node.keys.forEach((key, index) => {
            const result = this.services.typeChecker.inferType(key);
            if (result.ok && result.type.kind === 'collection') {
                report(accept, coded('type.collectionAsGroupKey'), { node, property: 'keys', index });
            }
        });
    }

    checkAssignmentTypeCompatible(node: AssignmentStatement, accept: ValidationAcceptor): void {
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

    checkFunctionDeclNotReservedName(node: FunctionDecl, accept: ValidationAcceptor): void {
        if (isBuiltinName(node.name)) {
            report(accept, coded('call.reservedName', { name: node.name }), { node, property: 'name' });
        }
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
