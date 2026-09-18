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

import type { ValidationAcceptor, ValidationChecks } from 'langium';
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
import { isBuiltinName } from './minab-builtins.js';
import { astTypeToMinabType } from './minab-type-checker.js';
import { formatType, isAssignableTo, isNullable } from './minab-types.js';
import type { MinabServices } from './minab-module.js';

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
            accept('error', "'$' is only valid in a field-level rule; this program isn't being validated as one", { node });
        }
    }

    checkGroupKeyRefScope(node: GroupKeyRef, accept: ValidationAcceptor): void {
        const result = this.services.scopeResolver.resolveGroupKeyRef(node);
        if (!result.found) {
            accept('error', result.reason, { node });
        }
    }

    checkNamedScopeResolves(node: NamedScope, accept: ValidationAcceptor): void {
        const result = this.services.scopeResolver.resolveNamedScope(node);
        if (!result.found) {
            accept('error', result.reason, { node });
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
        node: BinaryExpression | UnaryExpression | MemberAccess | TupleAccess | FilterAccess
            | CallExpression | FunctionCall | ListLiteral | IfExpr | SwitchExpr | CurrentRecord,
        accept: ValidationAcceptor
    ): void {
        const result = this.services.typeChecker.inferType(node);
        if (!result.ok && result.origin === node) {
            accept('error', result.reason, { node });
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
            accept('error', `expected a BOOLEAN condition, got ${formatType(result.type)}`, { node, property: 'condition' });
        }
    }

    checkGroupKeysNotCollection(node: GroupByClause, accept: ValidationAcceptor): void {
        node.keys.forEach((key, index) => {
            const result = this.services.typeChecker.inferType(key);
            if (result.ok && result.type.kind === 'collection') {
                accept('error', `a to-many collection can't be used as a GROUPBY key (spec §3.4)`, { node, property: 'keys', index });
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
                    accept('error', '"?=" requires a nullable target', { node, property: 'operator' });
                }
                return;
            case '-=':
            case '*=':
            case '/=':
                if (!isNumericTarget) {
                    accept('error', `"${node.operator}" requires a numeric target, got ${formatType(target)}`, { node, property: 'operator' });
                    return;
                }
                break;
            case '+=':
                if (!isNumericTarget && !isTextTarget) {
                    accept('error', `"+=" requires a numeric or text target, got ${formatType(target)}`, { node, property: 'operator' });
                    return;
                }
                break;
            case '|=':
                if (!(target.kind === 'record' || (target.kind === 'scalar' && !target.array && target.base === 'JSON'))) {
                    accept('error', `"|=" requires a ref- or JSON-typed target, got ${formatType(target)}`, { node, property: 'operator' });
                }
                return;
            default:
                break; // '='
        }
        if (!isAssignableTo(value, target)) {
            accept('error', `can't assign ${formatType(value)} to a target of type ${formatType(target)} (no implicit coercion)`, { node, property: 'value' });
        }
    }

    checkVariableDeclTypeCompatible(node: VariableDecl, accept: ValidationAcceptor): void {
        if (!node.value) return;
        const valueResult = this.services.typeChecker.inferType(node.value);
        if (!valueResult.ok) return;
        const target = astTypeToMinabType(node.type);
        if (!isAssignableTo(valueResult.type, target)) {
            accept('error', `can't initialize "${node.name}" (${formatType(target)}) with ${formatType(valueResult.type)} (no implicit coercion)`, { node, property: 'value' });
        }
    }

    checkFunctionDeclNotReservedName(node: FunctionDecl, accept: ValidationAcceptor): void {
        if (isBuiltinName(node.name)) {
            accept('error', `"${node.name}" is a reserved built-in function name and can't be used for a user-defined function`, { node, property: 'name' });
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
                accept('error', 'a function whose body ends in a query must declare its return type as JSON (spec §8.6)', { node, property: 'returnType' });
            }
            return;
        }
        const tailResult = this.services.typeChecker.inferType(node.tail);
        if (!tailResult.ok) return;
        const declared = astTypeToMinabType(node.returnType);
        if (!isAssignableTo(tailResult.type, declared)) {
            accept(
                'error',
                `function body's result (${formatType(tailResult.type)}) doesn't match its declared return type ${formatType(declared)} (no implicit coercion)`,
                { node, property: 'returnType' }
            );
        }
    }
}
