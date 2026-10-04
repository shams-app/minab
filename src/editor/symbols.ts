/**
 * The outline of a program: each `fn` (its parameters are its children), each
 * top-level `let`, and the aliases of the queries outside the functions (`AS`,
 * joins too).
 */

import { AstUtils, type AstNode } from 'langium';
import { isFunctionDecl, isJoinClause, isQuery, isVariableDecl } from '../language/generated/ast.js';
import type { EditorDocument } from './document.js';
import { functionSignature } from './hover.js';
import { declarationName } from './references.js';
import type { DocumentSymbolResult, SymbolKind } from './types.js';

function symbol(owner: AstNode, kind: SymbolKind, name: string, detail?: string, children: DocumentSymbolResult[] = []): DocumentSymbolResult | undefined {
    const nameNode = declarationName(owner);
    if (!nameNode || !owner.$cstNode) return undefined;
    return { name, kind, detail, range: owner.$cstNode.range, selectionRange: nameNode.range, children };
}

function typeText(node: { type?: { $cstNode?: { text: string } } }): string | undefined {
    return node.type?.$cstNode?.text.trim();
}

function present(symbols: (DocumentSymbolResult | undefined)[]): DocumentSymbolResult[] {
    return symbols.filter((s): s is DocumentSymbolResult => s !== undefined);
}

export function documentSymbols(doc: EditorDocument): DocumentSymbolResult[] {
    const model = doc.document.parseResult.value;
    const result: (DocumentSymbolResult | undefined)[] = [];
    for (const declaration of model.declarations) {
        if (isFunctionDecl(declaration)) {
            const params = present(declaration.params.map(p => symbol(p, 'parameter', p.name, typeText(p))));
            result.push(symbol(declaration, 'function', declaration.name, functionSignature(declaration), params));
        } else if (isVariableDecl(declaration)) {
            result.push(symbol(declaration, 'variable', declaration.name, typeText(declaration)));
        }
    }
    const outside: AstNode[] = [...model.declarations.filter(d => !isFunctionDecl(d)), ...(model.tail ? [model.tail] : [])];
    for (const root of outside) {
        for (const node of [root, ...AstUtils.streamAllContents(root)]) {
            if (isQuery(node) && node.alias) result.push(symbol(node, 'alias', node.alias));
            else if (isJoinClause(node)) result.push(symbol(node, 'alias', node.alias));
        }
    }
    return present(result).sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
}
