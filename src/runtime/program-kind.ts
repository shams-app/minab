/**
 * What a parsed program is: a query, a rule, a value or nothing, and the
 * type of its answer. The runtime and the playground share this code.
 */

import type { Model } from '../language/generated/ast.js';
import { isQuery } from '../language/generated/ast.js';
import type { MinabServices } from '../language/minab-module.js';
import { formatType, type MinabType } from '../language/minab-types.js';

/** What a program is: `query` (a pipeline), `record-rule` or `field-rule` (a validation rule), `value` (an expression), or `empty`. */
export type ProgramKind = 'query' | 'record-rule' | 'field-rule' | 'value' | 'empty';

export interface ProgramClass {
    kind: ProgramKind;
    /** The type of the last expression. Missing for a query, an empty program, or a tail the checker cannot type. */
    type?: MinabType;
    /** `type` as text, for example `BOOLEAN` or `INTEGER[]`. */
    resultType?: string;
}

export function classifyProgram(model: Model, services: Pick<MinabServices, 'ruleContext' | 'typeChecker'>): ProgramClass {
    const ruleContext = services.ruleContext;
    const tail = model.tail;

    let kind: ProgramKind;
    if (!tail) kind = model.declarations.length === 0 ? 'empty' : 'value';
    else if (isQuery(tail)) kind = 'query';
    else if (ruleContext.isFieldRule) kind = 'field-rule';
    else if (ruleContext.recordTable) kind = 'record-rule';
    else kind = 'value';

    if (tail && !isQuery(tail)) {
        try {
            const inferred = services.typeChecker.inferType(tail);
            if (inferred.ok) return { kind, type: inferred.type, resultType: formatType(inferred.type) };
        } catch {
            // A half-parsed tail can trip inference; the type is a nicety, not a requirement.
        }
    }
    return { kind };
}
