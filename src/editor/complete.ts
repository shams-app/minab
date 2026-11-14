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
    isCallExpression,
    isNameRef,
    isFunctionDecl,
    isCurrentRecord,
    isLoopStatement,
    isMemberAccess,
    isModel,
    isQuery,
    isVariableDecl,
    type VariableDecl
} from '../language/generated/ast.js';
import { builtinNames, getBuiltin } from '../language/minab-builtins.js';
import { formatType } from '../language/minab-types.js';
import { rootTableOf, type MinabTableSchema } from '../language/schema.js';
import { BUILTIN_DOCS } from './builtin-docs.js';
import { code, describeColumn, hostFunctionDoc, hostFunctionSignature, nameText, tableSummary } from './describe.js';
import { parseDocument, positionAt, sourceOf, type EditorDocument } from './document.js';
import { functionSignature, tableOfType, typeOf } from './hover.js';
import type { CompletionItem, CompletionResult, DirectoryName } from './types.js';

const PLACEHOLDER = '__minab_completion__';

/** `@name` or `@@name` being typed: the sigil, and the part of the name so far (a backtick name may hold spaces). */
const DIRECTORY_NAME = /(@@?)(`[^`\n]*|[^\s`@.,;()[\]{}'"+\-*/&|!=<>^#$:]*)$/u;

export async function complete(doc: EditorDocument, offset: number): Promise<CompletionResult> {
    const source = sourceOf(doc);
    const before = source.slice(0, offset);
    const directory = DIRECTORY_NAME.exec(before);
    if (directory) {
        const start = offset - directory[2].length;
        const replace = { start: positionAt(source, start), end: positionAt(source, offset) };
        return { replace, items: directoryCompletions(doc, directory[1]) };
    }
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

/**
 * After `@`: the special users of this place. After `@@`: the group names of the host (`directoryNames()`, with their titles
 * and kinds), else the plain list of `ruleContext.groupNames`. A name that is not a plain word is inserted in backticks (MN.4).
 */
function directoryCompletions(doc: EditorDocument, sigil: string): CompletionItem[] {
    const { ruleContext } = doc.services;
    if (sigil === '@') {
        return (ruleContext.specialUsers ?? []).map((user, index) => ({
            label: user.name,
            kind: 'input',
            detail: user.type,
            documentation: user.type === 'USER?' ? 'A special user of this place. It may be missing here.' : 'A special user of this place.',
            ...insert(user.name),
            rank: index
        }));
    }
    const groups: readonly DirectoryName[] = doc.hints?.groups ?? (ruleContext.groupNames ?? []).map(name => ({ name }));
    return groups.map((group, index) => {
        const title = group.title && group.title !== group.name ? group.title : undefined;
        const facts = [title, group.kind ? `kind: ${group.kind}` : undefined].filter(Boolean);
        return {
            label: group.name,
            kind: 'input',
            detail: 'USERGROUP',
            documentation: facts.length > 0 ? facts.join(' · ') : 'A group of the workspace.',
            ...insert(group.name),
            rank: index
        };
    });
}

/** `insertText` only when the name needs backticks. */
function insert(name: string): { insertText?: string } {
    const text = nameText(name);
    return text === name ? {} : { insertText: text };
}

function memberCompletions(doc: EditorDocument, text: string): CompletionItem[] {
    const probe = parseDocument(doc.services, text);
    let table: MinabTableSchema | undefined;
    let numbersFirst = false;
    for (const node of AstUtils.streamAst(probe.document.parseResult.value)) {
        if (isCurrentRecord(node) && node.field === PLACEHOLDER) {
            // In a group expression, inside an aggregate: `SUM(.` and `AVG(.` read numbers, so those columns come first.
            numbersFirst = !!doc.services.ruleContext.groupTable && insideAggregate(node);
            const base = doc.services.scopeResolver.resolveCurrentRecordBase(node);
            if (base.found) {
                const name = base.scope.tableName ?? (isModel(base.scope.owner) ? rootTableOf(doc.services.ruleContext) : undefined);
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
    const isNumber = (column: MinabTableSchema['columns'][number]) =>
        column.type.kind === 'scalar' && !column.type.type.array && ['INTEGER', 'DECIMAL'].includes(column.type.type.base);
    const ordered = numbersFirst ? [...owner.columns.filter(isNumber), ...owner.columns.filter(c => !isNumber(c))] : owner.columns;
    const group = !!doc.services.ruleContext.groupTable;
    return ordered.map((column, index) => ({
        label: column.name,
        kind: 'column',
        detail: describeColumn(column),
        documentation: group ? `column of the group (${code(owner.name)})` : `column of ${code(owner.name)}`,
        ...insert(column.name),
        rank: index
    }));
}

/** Is the node an argument of an aggregate (`SUM`, `AVG`, `MIN`, `MAX`, `COUNT`)? */
function insideAggregate(node: AstNode): boolean {
    for (let current: AstNode | undefined = node.$container; current; current = current.$container) {
        if (isCallExpression(current) && isNameRef(current.callee) && getBuiltin(current.callee.name)?.kind === 'aggregate') return true;
    }
    return false;
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
