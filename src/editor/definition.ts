/**
 * Go to definition. `#alias`, a name, a parameter, a `let`, a loop variable
 * and a called `fn` all lead to the place that declares them. Minab has no
 * Langium cross-references, so the scope resolver does the lookup (the same
 * way the validator does).
 */

import { CstUtils, GrammarUtils, type AstNode, type CstNode } from 'langium';
import { isCallExpression, isNamedScope, isNameRef } from '../language/generated/ast.js';
import type { EditorDocument } from './document.js';
import { userFunction } from './hover.js';
import type { DefinitionResult } from './types.js';

/** The part of a declaration that holds its name: `name`, `alias` or `variable`. */
function nameNode(declaration: AstNode): CstNode | undefined {
    const cst = declaration.$cstNode;
    if (!cst) return undefined;
    // A `#Table` has a `name` too, so it points at the whole node: the table has no declaration in the program.
    if (isNamedScope(declaration)) return cst;
    for (const property of ['name', 'alias', 'variable']) {
        const found = GrammarUtils.findNodeForProperty(cst, property);
        // A `Query` has `source` and `alias`; `name` is only on declarations.
        if (found) return found;
    }
    return cst;
}

export function definition(doc: EditorDocument, offset: number): DefinitionResult | undefined {
    const root = doc.document.parseResult.value.$cstNode;
    if (!root) return undefined;
    const leaf = CstUtils.findLeafNodeAtOffset(root, offset);
    const node = leaf?.astNode;
    if (!leaf || !node) return undefined;
    const { scopeResolver } = doc.services;

    let owner: AstNode | undefined;
    if (isNamedScope(node)) {
        const result = scopeResolver.resolveNamedScope(node);
        // A bare `#Table` is its own owner: it points at itself, as it always did.
        if (result.found) owner = result.scope.owner;
    } else if (isNameRef(node)) {
        const isCallee = !!node.$container && isCallExpression(node.$container) && node.$container.callee === node;
        if (isCallee) owner = userFunction(doc, node.name);
        if (!owner) {
            const result = scopeResolver.resolveNameRef(node);
            // A host input has the reference itself as owner: it is declared outside the program.
            if (result.found && result.scope.owner !== node) owner = result.scope.owner;
        }
    }
    const target = owner ? nameNode(owner) : undefined;
    return target ? { origin: leaf.range, target: target.range } : undefined;
}
