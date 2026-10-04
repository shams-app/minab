/**
 * Hover. Says what is under the cursor: a column's type, a function's
 * signature, a `#alias`'s table, or the inferred type of any expression. It
 * asks the type checker, so the editor and the checker cannot disagree.
 */

import { CstUtils, GrammarAST, type AstNode } from 'langium';
import {
    isCallExpression,
    isCurrentRecord,
    isFieldValue,
    isFunctionDecl,
    isMemberAccess,
    isNamedScope,
    isNameRef,
    isParam,
    isParentRecord,
    isTableRef,
    isVariableDecl
} from '../language/generated/ast.js';
import { type MinabType } from '../language/minab-types.js';
import type { MinabTableSchema } from '../language/schema.js';
import { BUILTIN_DOCS } from './builtin-docs.js';
import { code, describeColumn, hostFunctionDoc, hostFunctionSignature, tableSummary, typeLine } from './describe.js';
import type { EditorDocument } from './document.js';
import type { HoverResult } from './types.js';

/** The inferred type of a node, or `undefined` when the checker has none. */
export function typeOf(doc: EditorDocument, node: AstNode): MinabType | undefined {
    try {
        const result = doc.services.typeChecker.inferType(node as never);
        return result.ok ? result.type : undefined;
    } catch {
        return undefined;
    }
}

/** The table a record or collection type reads from. */
export function tableOfType(doc: EditorDocument, type: MinabType | undefined): MinabTableSchema | undefined {
    if (!type || (type.kind !== 'record' && type.kind !== 'collection')) return undefined;
    return doc.services.schema.getTable(type.table);
}

/** `fn name(a: T): R` — the declaration up to the body. */
export function functionSignature(decl: AstNode): string {
    return decl.$cstNode?.text.split('{')[0].trim() ?? '';
}

export function hover(doc: EditorDocument, offset: number): HoverResult | undefined {
    const root = doc.document.parseResult.value.$cstNode;
    if (!root) return undefined;
    const leaf = CstUtils.findLeafNodeAtOffset(root, offset);
    if (!leaf) return undefined;
    if (GrammarAST.isKeyword(leaf.grammarSource)) {
        return { contents: '', range: leaf.range, keyword: leaf.text };
    }
    const node = leaf.astNode;
    const contents = describeNode(doc, node);
    return contents ? { contents, range: node.$cstNode?.range } : undefined;
}

function describeNode(doc: EditorDocument, node: AstNode): string | undefined {
    const { schema, scopeResolver } = doc.services;
    const typed = (label: string, what: string, type?: MinabType) => `${code(label)} — ${what}${typeLine(type)}`;

    if (isNamedScope(node)) {
        const type = typeOf(doc, node);
        const table = tableOfType(doc, type);
        const res = scopeResolver.resolveNamedScope(node);
        // An alias or table that does not resolve has nothing to show: the checker reports it.
        if (!res.found) return undefined;
        const fallback = res.scope.owner === node;
        const what = fallback ? `every row of table ${code(table?.name ?? node.name)} (spec §3.3)` : `the row bound to alias ${code(node.name)}`;
        return `${typed('#' + node.name, what, type)}${table ? `\n\n${tableSummary(table)}` : ''}`;
    }
    if (isTableRef(node)) {
        const table = schema.getTable(node.name);
        return table ? `${code(node.name)} — table\n\n${tableSummary(table)}` : `${code(node.name)} — not a table in this host's schema`;
    }
    if (isCurrentRecord(node)) {
        if (!node.field) return typed('.', 'the current record — one row of the scope you are in (spec §2.2)', typeOf(doc, node));
        return typed('.' + node.field, columnWhat(doc, node), typeOf(doc, node));
    }
    if (isMemberAccess(node)) {
        const owner = tableOfType(doc, typeOf(doc, node.receiver));
        const column = owner?.columns.find(c => c.name === node.member);
        const what =
            column && owner
                ? `column of ${code(owner.name)}${column.type.kind !== 'scalar' ? ` (${describeColumn(column)})` : ''}${sqlNameNote(column.sqlName, column.name)}`
                : 'member access';
        return typed(node.$cstNode?.text.trim() ?? node.member, what, typeOf(doc, node));
    }
    if (isParentRecord(node)) {
        return typed('^', 'the parent record — the row one scope level up (spec §2.2)', typeOf(doc, node));
    }
    if (isFieldValue(node)) {
        return typed('$', 'the value of the field under validation (a field-level rule, spec §6.2)', typeOf(doc, node));
    }
    if (isNameRef(node)) {
        const isCallee = !!node.$container && isCallExpression(node.$container) && node.$container.callee === node;
        if (isCallee) {
            const builtin = BUILTIN_DOCS[node.name];
            if (builtin) return `${code(builtin.signature)}\n\n${builtin.doc}`;
            const decl = userFunction(doc, node.name);
            if (decl) return `\`\`\`minab\n${functionSignature(decl)}\n\`\`\`\n\n${code(node.name)} — a user function (spec §8)`;
            const host = schema.getHostFunction(node.name);
            if (host) return `${code(hostFunctionSignature(host))}\n\n${hostFunctionDoc(host)}`;
        }
        const input = schema.getHostInput(node.name);
        const res = scopeResolver.resolveNameRef(node);
        if (input && res.found && res.scope.hostInput) return typed(node.name, 'an input of the host', input);
        return typed(node.name, 'a name — a variable, parameter or alias', typeOf(doc, node));
    }
    if (isCallExpression(node) && isNameRef(node.callee) && BUILTIN_DOCS[node.callee.name]) {
        const builtin = BUILTIN_DOCS[node.callee.name];
        return `${code(builtin.signature)}\n\n${builtin.doc}${typeLine(typeOf(doc, node))}`;
    }
    if (isVariableDecl(node)) {
        return `${code(node.name)} — variable${node.type?.$cstNode ? ` of type ${code(node.type.$cstNode.text)}` : ''}`;
    }
    if (isParam(node)) {
        return `${code(node.name)} — parameter${node.type?.$cstNode ? ` of type ${code(node.type.$cstNode.text)}` : ''}`;
    }
    if (isFunctionDecl(node)) {
        return '```minab\n' + (functionSignature(node) || node.name) + '\n```';
    }
    const type = typeOf(doc, node);
    return type ? `${code(node.$type)}${typeLine(type)}` : undefined;
}

/** What a `.field` is, with the database name when it differs. */
function columnWhat(doc: EditorDocument, node: AstNode & { field?: string }): string {
    const base = doc.services.scopeResolver.resolveCurrentRecordBase(node);
    const tableName = base.found ? (base.scope.tableName ?? doc.services.ruleContext.recordTable) : undefined;
    const column = tableName && node.field ? doc.services.schema.getColumn(tableName, node.field) : undefined;
    return `a column of the current record${sqlNameNote(column?.sqlName, node.field)}`;
}

function sqlNameNote(sqlName: string | undefined, name: string | undefined): string {
    return sqlName && sqlName !== name ? ` (SQL name ${code(sqlName)})` : '';
}

/** A top-level `fn` of the document. */
export function userFunction(doc: EditorDocument, name: string) {
    return doc.document.parseResult.value.declarations.filter(isFunctionDecl).find(d => d.name === name);
}
