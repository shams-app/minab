/**
 * Semantic validation (roadmap Phase 3). Catches programs that parse
 * cleanly but violate a rule the grammar can't express:
 *
 *  - `$` (`FieldValue`) used when the host hasn't marked this program as
 *    a field-level rule (`schema.ts`'s `MinabRuleContext`).
 *  - `KEY` (`GroupKeyRef`) used outside a `GROUPBY`-scoped clause.
 *  - `#alias` (`NamedScope`) referencing an undeclared table/scope.
 *
 * The latter two are thin wrappers around `MinabScopeResolver`, which
 * already does the scope-stack walking and produces a human-readable
 * `reason` string on failure (Phase 2) — this file's job is only to turn
 * `{found: false}` into a diagnostic. A fourth check from the roadmap
 * (a to-many/`collection` field used where a scalar is required) is
 * deferred to Phase 4: `schema.ts`'s column type is still a free-form
 * display string with no structured collection flag, so there's nothing
 * to check against yet.
 */

import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { FieldValue, GroupKeyRef, MinabAstType, NamedScope } from './generated/ast.js';
import type { MinabServices } from './minab-module.js';

export function registerValidationChecks(services: MinabServices): void {
    const registry = services.validation.ValidationRegistry;
    const validator = new MinabValidator(services);
    const checks: ValidationChecks<MinabAstType> = {
        FieldValue: validator.checkFieldValueInFieldRule,
        GroupKeyRef: validator.checkGroupKeyRefScope,
        NamedScope: validator.checkNamedScopeResolves
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
}
