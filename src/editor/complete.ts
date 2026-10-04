/**
 * Completion. The grammar has no cross-references (a `.field` or `#Table` is
 * resolved against the host schema, not linked to a declaration), so this
 * cannot lean on Langium's scoping. It asks the type checker instead: put a
 * placeholder where the user is typing, parse, and infer the type of whatever
 * sits left of the dot. `record<Customer>` means "offer Customer's columns" —
 * which is how the checker would judge the finished expression.
 */

import { AstUtils, CstUtils, type AstNode } from 'langium';
import {
    isBlock,
    isFunctionDecl,
    isCurrentRecord,
    isLoopStatement,
    isMemberAccess,
    isModel,
    isQuery,
    isVariableDecl,
    type VariableDecl
} from '../language/generated/ast.js';
import { builtinNames } from '../language/minab-builtins.js';
import { formatType } from '../language/minab-types.js';
import type { MinabTableSchema } from '../language/schema.js';
import { BUILTIN_DOCS } from './builtin-docs.js';
import { code, describeColumn, hostFunctionDoc, hostFunctionSignature, nameText, tableSummary } from './describe.js';
import { parseDocument, positionAt, sourceOf, type EditorDocument } from './document.js';
import { functionSignature, tableOfType, typeOf } from './hover.js';
import type { CompletionItem, CompletionResult } from './types.js';

const PLACEHOLDER = '__minab_completion__';

export async function complete(doc: EditorDocument, offset: number): Promise<CompletionResult> {
    const source = sourceOf(doc);
    const before = source.slice(0, offset);
    const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)?.[0] ?? '';
    const wordStart = offset - word.length;
    const replace = {
        start: positionAt(source, wordStart),
        end: positionAt(source, offset)
    };
    const prefix = before.slice(0, wordStart);
    const withPlaceholder = prefix + PLACEHOLDER + source.slice(offset);
    const { schema } = doc.services;

    const tables = (rank: number): CompletionItem[] =>
        schema.tables().map(t => ({
            label: t.name,
            kind: 'table',
            detail: `table · ${t.columns.length} columns`,
            documentation: tableSummary(t),
            ...insert(t.name),
            rank
        }));

    // `#Tab…` — a named scope, or a whole table (spec §3.3).
    if (prefix.endsWith('#')) {
        const aliases = [...before.matchAll(/\b(?:AS)\s+([A-Za-z_]\w*)/g)].map(m => m[1]);
        return {
            replace,
            items: [
                ...tables(0),
                ...[...new Set(aliases)].map(a => ({
                    label: a,
                    kind: 'variable' as const,
                    detail: 'alias',
                    rank: 1
                }))
            ]
        };
    }
    // `FROM Tab…`, `JOIN Tab…` — table names.
    if (/\b(FROM|JOIN|LEFTJOIN|CROSSJOIN)\s+$/.test(prefix)) {
        return { replace, items: tables(0) };
    }
    // `.col…`, `^.col…`, `.customer.col…`, `KEY.col…`, `alias.col…` — columns of whatever is left of the dot.
    if (prefix.endsWith('.')) {
        return { replace, items: memberCompletions(doc, withPlaceholder) };
    }
    return {
        replace,
        items: await generalCompletions(doc, offset, withPlaceholder)
    };
}

/** `insertText` only when the name needs backticks. */
function insert(name: string): { insertText?: string } {
    const text = nameText(name);
    return text === name ? {} : { insertText: text };
}

function memberCompletions(doc: EditorDocument, text: string): CompletionItem[] {
    const probe = parseDocument(doc.services, text);
    let table: MinabTableSchema | undefined;
    for (const node of AstUtils.streamAst(probe.document.parseResult.value)) {
        if (isCurrentRecord(node) && node.field === PLACEHOLDER) {
            const base = doc.services.scopeResolver.resolveCurrentRecordBase(node);
            if (base.found) {
                const name = base.scope.tableName ?? (isModel(base.scope.owner) ? doc.services.ruleContext.recordTable : undefined);
                table = name ? doc.services.schema.getTable(name) : undefined;
            }
            break;
        }
        if (isMemberAccess(node) && node.member === PLACEHOLDER) {
            table = tableOfType(probe, typeOf(probe, node.receiver));
            break;
        }
    }
    if (!table) return [];
    const owner = table;
    return owner.columns.map((column, index) => ({
        label: column.name,
        kind: 'column',
        detail: describeColumn(column),
        documentation: `column of ${code(owner.name)}`,
        ...insert(column.name),
        rank: index
    }));
}

async function generalCompletions(doc: EditorDocument, offset: number, withPlaceholder: string): Promise<CompletionItem[]> {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    const push = (item: CompletionItem) => {
        if (seen.has(item.label)) return;
        seen.add(item.label);
        items.push(item);
    };

    // Keywords the grammar allows here, from Langium's follow-set completion.
    const list = await doc.services.lsp.CompletionProvider?.getCompletion(doc.document, {
        textDocument: { uri: doc.document.uri.toString() },
        position: doc.document.textDocument.positionAt(offset)
    });
    const keywords = new Set<string>();
    for (const item of list?.items ?? []) {
        if (!/^[A-Za-z_!]+$/.test(item.label) && item.label !== '.$index') continue;
        keywords.add(item.label);
        push({ label: item.label, kind: 'keyword', rank: 2 });
    }
    // Names and built-ins only where an expression may start — which is
    // wherever the grammar would also accept a literal like `true`.
    if (!keywords.has('true') && !keywords.has('CAST')) return items;

    const { schema } = doc.services;
    const probe = parseDocument(doc.services, withPlaceholder);
    const model = probe.document.parseResult.value;
    const at = model.$cstNode ? CstUtils.findLeafNodeAtOffset(model.$cstNode, offset) : undefined;

    // Names in scope: aliases, loop variables, parameters and `let`s.
    for (let node: AstNode | undefined = at?.astNode; node; node = node.$container) {
        if (isQuery(node)) {
            if (node.alias) push({ label: node.alias, kind: 'variable', detail: 'alias', rank: 0 });
            for (const join of node.joins) push({ label: join.alias, kind: 'variable', detail: 'alias', rank: 0 });
        }
        if (isLoopStatement(node) && node.variable)
            push({
                label: node.variable,
                kind: 'variable',
                detail: 'loop variable',
                rank: 0
            });
        if (isFunctionDecl(node)) {
            for (const param of node.params) {
                push({
                    label: param.name,
                    kind: 'variable',
                    detail: `parameter · ${param.type?.$cstNode?.text ?? ''}`,
                    rank: 0
                });
            }
        }
        const statements = isBlock(node)
            ? node.statements
            : isFunctionDecl(node)
              ? node.body
              : isLoopStatement(node)
                ? node.statements
                : isModel(node)
                  ? node.declarations
                  : [];
        for (const statement of statements) {
            if (isVariableDecl(statement)) pushVariable(push, statement);
        }
    }
    for (const decl of model.declarations) {
        if (isVariableDecl(decl)) pushVariable(push, decl);
    }
    for (const [name, type] of schema.hostInputs()) {
        push({
            label: name,
            kind: 'input',
            detail: formatType(type),
            documentation: 'An input of the host.',
            rank: 0
        });
    }
    for (const f of model.declarations.filter(isFunctionDecl)) {
        push({
            label: f.name,
            kind: 'function',
            detail: functionSignature(f),
            documentation: 'A function of this program (spec §8).',
            insertText: `${f.name}(${f.params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')})`,
            rank: 1
        });
    }
    for (const fn of schema.hostFunctions().values()) {
        push({
            label: fn.name,
            kind: 'hostFunction',
            detail: hostFunctionSignature(fn),
            documentation: hostFunctionDoc(fn),
            insertText: `${fn.name}(${fn.params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')})`,
            rank: 1
        });
    }
    for (const name of builtinNames()) {
        const info = BUILTIN_DOCS[name];
        push({
            label: name,
            kind: 'builtin',
            detail: info?.signature,
            documentation: info?.doc,
            insertText: `${name}($1)`,
            rank: 1
        });
    }
    return items;
}

function pushVariable(push: (item: CompletionItem) => void, decl: VariableDecl): void {
    push({
        label: decl.name,
        kind: 'variable',
        detail: decl.type?.$cstNode?.text,
        rank: 0
    });
}
