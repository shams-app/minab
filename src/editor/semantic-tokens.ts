/**
 * Semantic tokens: what a name is, which the TextMate grammar cannot know.
 * Sigils (`.`, `^`, `#`, `$`, `KEY`), keywords, built-ins, user functions,
 * host functions, host inputs, fields, aliases and tables each get a token.
 * Strings, numbers and comments are left to the TextMate grammar.
 *
 * The legend is `SEMANTIC_TOKEN_TYPES` and `SEMANTIC_TOKEN_MODIFIERS`. A
 * built-in is a `function` with `defaultLibrary`. A function or input of the
 * host has `host`. A name at its declaration has `declaration`.
 */

import { CstUtils, GrammarAST, GrammarUtils, isLeafCstNode, type AstNode, type LeafCstNode } from 'langium';
import {
    isCallExpression,
    isCurrentRecord,
    isFieldValue,
    isFunctionDecl,
    isGroupKey,
    isGroupKeyRef,
    isIndexRef,
    isJoinClause,
    isJsonProperty,
    isLoopStatement,
    isMemberAccess,
    isNamedScope,
    isNameRef,
    isParam,
    isParentRecord,
    isQuery,
    isSelectItem,
    isSetAssignment,
    isTableRef,
    isTypeRef,
    isVariableDecl,
    type NameRef
} from '../language/generated/ast.js';
import { BUILTIN_DOCS } from './builtin-docs.js';
import type { EditorDocument } from './document.js';
import { userFunction } from './hover.js';
import type { SemanticToken, SemanticTokenModifier, SemanticTokenType } from './types.js';

type Kind = [SemanticTokenType, ...SemanticTokenModifier[]];

function isCallee(node: NameRef): boolean {
    return !!node.$container && isCallExpression(node.$container) && node.$container.callee === node;
}

/** What a name used in an expression is. */
function nameRefKind(doc: EditorDocument, node: NameRef): Kind | undefined {
    const { schema, scopeResolver } = doc.services;
    if (isCallee(node)) {
        if (BUILTIN_DOCS[node.name]) return ['function', 'defaultLibrary'];
        if (userFunction(doc, node.name)) return ['function'];
        if (schema.getHostFunction(node.name)) return ['function', 'host'];
        return undefined;
    }
    const result = scopeResolver.resolveNameRef(node);
    if (!result.found) return undefined;
    const owner = result.scope.owner;
    if (result.scope.hostInput) return ['variable', 'host'];
    if (isParam(owner)) return ['parameter'];
    if (isQuery(owner) || isJoinClause(owner)) return ['namespace'];
    return ['variable'];
}

/** The kind of a name token, from the node it belongs to and the property that holds it. */
function nameKind(doc: EditorDocument, node: AstNode, property: string | undefined): Kind | undefined {
    if (isNameRef(node)) return nameRefKind(doc, node);
    if (isNamedScope(node)) {
        const result = doc.services.scopeResolver.resolveNamedScope(node);
        if (!result.found) return undefined;
        // A `#Table` has itself as owner: it is a table of the schema, not an alias.
        return result.scope.owner === node ? ['class'] : ['namespace'];
    }
    if (isCurrentRecord(node) || isMemberAccess(node)) return ['property'];
    if (isTableRef(node) || (isJoinClause(node) && property === 'source')) return ['class'];
    if (isQuery(node) || isJoinClause(node)) return property === 'alias' ? ['namespace', 'declaration'] : undefined;
    if (isFunctionDecl(node)) return property === 'name' ? ['function', 'declaration'] : undefined;
    if (isParam(node)) return property === 'name' ? ['parameter', 'declaration'] : undefined;
    if (isVariableDecl(node)) return property === 'name' ? ['variable', 'declaration'] : undefined;
    if (isLoopStatement(node)) return property === 'variable' ? ['variable', 'declaration'] : undefined;
    // The name of an output column or a key of an object: a property.
    if (isSelectItem(node) || isGroupKey(node) || isSetAssignment(node) || isJsonProperty(node))
        return property === 'alias' || property === 'key' ? ['property'] : undefined;
    return undefined;
}

const SIGILS = new Set(['.', '^', '#', '$', 'KEY', '.$index']);

/** The kind of a keyword token. Punctuation and operators have none. */
function keywordKind(leaf: LeafCstNode): Kind | undefined {
    const node = leaf.astNode;
    const sigil = isCurrentRecord(node) || isParentRecord(node) || isFieldValue(node) || isNamedScope(node) || isGroupKeyRef(node) || isIndexRef(node);
    // The `.` of member access belongs to `MemberAccess`, so it is not a sigil. A `!` after a field is not one either.
    if (sigil && SIGILS.has(leaf.text)) return ['operator'];
    if (!/^[A-Za-z]/.test(leaf.text)) return undefined;
    return isTypeRef(node) ? ['type'] : ['keyword'];
}

export function semanticTokens(doc: EditorDocument): SemanticToken[] {
    const root = doc.document.parseResult.value.$cstNode;
    if (!root) return [];
    const tokens: SemanticToken[] = [];
    for (const cst of CstUtils.streamCst(root)) {
        if (!isLeafCstNode(cst) || cst.hidden) continue;
        const { start, end } = cst.range;
        // A token cannot span lines. A quoted name may, so it is left to the TextMate grammar.
        if (start.line !== end.line) continue;
        const kind = GrammarAST.isKeyword(cst.grammarSource) ? keywordKind(cst) : nameKind(doc, cst.astNode, GrammarUtils.findAssignment(cst)?.feature);
        if (!kind || !isNameLike(cst)) continue;
        const [type, ...modifiers] = kind;
        tokens.push({ line: start.line, character: start.character, length: end.character - start.character, type, modifiers });
    }
    return tokens;
}

/** A name or a keyword, not a string or a number. */
function isNameLike(leaf: LeafCstNode): boolean {
    return GrammarAST.isKeyword(leaf.grammarSource) || /^[\p{L}_`]/u.test(leaf.text);
}
