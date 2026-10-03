/**
 * Editor intelligence: hover, completion, go-to-definition and the AST
 * view — computed from the same Langium services that check and run the
 * program, so what the editor says a type is and what the checker enforces
 * can't disagree.
 *
 * The grammar has no cross-references (a `.field` or `#Table` is resolved
 * against the host schema, not linked to a declaration), so completion
 * can't lean on Langium's scoping. It asks the type checker instead: put a
 * placeholder where the user is typing, parse, and infer the type of
 * whatever sits left of the dot. `record<Customer>` means "offer
 * Customer's columns" — which is exactly how the checker would judge the
 * finished expression.
 */

import { AstUtils, CstUtils, GrammarAST, isAstNode, type AstNode, type LangiumDocument } from 'langium';
import {
    isCallExpression,
    isCurrentRecord,
    isFieldValue,
    isFunctionDecl,
    isMemberAccess,
    isNamedScope,
    isNameRef,
    isParentRecord,
    isTableRef,
    isVariableDecl,
    type Model
} from '../../../src/language/generated/ast.js';
import { builtinNames } from '../../../src/language/minab-builtins.js';
import { formatType, type MinabType } from '../../../src/language/minab-types.js';
import type { MinabColumnSchema, MinabTableSchema } from '../../../src/language/schema.js';
import type { LanguageHost } from './language.js';
import { rangeOf } from './program.js';
import type { AstNodeView, CompletionEntry, CompletionReport, HoverInfo, Position, Range } from './protocol.js';

/** Signatures and one-line docs for the built-ins (the checker's `minab-builtins.ts` has the rules, not the prose). */
export const BUILTIN_DOCS: Record<string, { signature: string; doc: string }> = {
    COUNT: { signature: 'COUNT(collection<T>) → INTEGER', doc: 'How many rows (or array elements) the collection holds.' },
    SUM: { signature: 'SUM(collection<N>) → N', doc: 'Adds up a numeric column spread across a collection — `SUM(.orders.total)`.' },
    AVG: { signature: 'AVG(collection<N>) → DECIMAL', doc: 'The mean of a numeric column across a collection.' },
    MIN: { signature: 'MIN(collection<T>) → T', doc: 'The smallest value of an orderable column across a collection.' },
    MAX: { signature: 'MAX(collection<T>) → T', doc: 'The largest value of an orderable column across a collection.' },
    EXISTS: { signature: 'EXISTS(collection<T>) → BOOLEAN', doc: 'Whether the collection has at least one row — pushed down as one `SELECT EXISTS`.' },
    ALL: { signature: 'ALL(collection<BOOLEAN>) → BOOLEAN', doc: 'True when every value is true.' },
    ANY: { signature: 'ANY(collection<BOOLEAN>) → BOOLEAN', doc: 'True when at least one value is true.' },
    LOWER: { signature: 'LOWER(s: TEXT) → TEXT', doc: 'The text in lower case. `null` gives `null`.' },
    UPPER: { signature: 'UPPER(s: TEXT) → TEXT', doc: 'The text in upper case. `null` gives `null`.' },
    TRIM: { signature: 'TRIM(s: TEXT) → TEXT', doc: 'Removes spaces, tabs and line breaks at both ends.' },
    LENGTH: { signature: 'LENGTH(s: TEXT) → INTEGER', doc: 'The number of characters (Unicode code points): `LENGTH("😀")` is `1`.' },
    SUBSTRING: {
        signature: 'SUBSTRING(s: TEXT, start: INTEGER, length?: INTEGER) → TEXT',
        doc: 'Part of the text. `start` counts from 1. Without `length`, it reads to the end.'
    },
    REPLACE: { signature: 'REPLACE(s: TEXT, from: TEXT, to: TEXT) → TEXT', doc: 'Replaces every match of `from` with `to`.' },
    STARTS_WITH: {
        signature: 'STARTS_WITH(s: TEXT, part: TEXT) → BOOLEAN',
        doc: 'Whether the text starts with `part`. Ignores case for `CITEXT`. `%` and `_` are plain characters.'
    },
    ENDS_WITH: { signature: 'ENDS_WITH(s: TEXT, part: TEXT) → BOOLEAN', doc: 'Whether the text ends with `part`. Ignores case for `CITEXT`.' },
    CONTAINS: { signature: 'CONTAINS(s: TEXT, part: TEXT) → BOOLEAN', doc: 'Whether the text has `part` inside. Ignores case for `CITEXT`.' },
    COALESCE: { signature: 'COALESCE(a: T, b: T, …) → T', doc: 'The first value that is not `null`. Not nullable when any argument is not nullable.' },
    ROUND: {
        signature: 'ROUND(n: N, digits?: INTEGER) → N',
        doc: 'Rounds half away from zero: `ROUND(2.5)` is `3`, `ROUND(-2.5)` is `-3`. `digits` defaults to 0.'
    },
    ABS: { signature: 'ABS(n: N) → N', doc: 'The value without its sign.' },
    FLOOR: { signature: 'FLOOR(n: N) → INTEGER', doc: 'Rounds down to a whole number.' },
    CEIL: { signature: 'CEIL(n: N) → INTEGER', doc: 'Rounds up to a whole number.' },
    GREATEST: { signature: 'GREATEST(a: T, b: T, …) → T', doc: 'The largest value. `null` arguments are ignored; the answer is `null` only when all are.' },
    LEAST: { signature: 'LEAST(a: T, b: T, …) → T', doc: 'The smallest value. `null` arguments are ignored; the answer is `null` only when all are.' },
    NOW: { signature: 'NOW() → DATETIME', doc: 'The instant the run started. Every `NOW()` in one run is the same. In SQL it is a parameter, not the database clock.' },
    TODAY: { signature: 'TODAY() → DATE', doc: 'The date of `NOW()` in the time zone of the run.' },
    YEAR: { signature: 'YEAR(d: DATE | DATETIME) → INTEGER', doc: 'The year. A `DATETIME` is read in the time zone of the run.' },
    MONTH: { signature: 'MONTH(d: DATE | DATETIME) → INTEGER', doc: 'The month, 1 to 12. A `DATETIME` is read in the time zone of the run.' },
    DAY: { signature: 'DAY(d: DATE | DATETIME) → INTEGER', doc: 'The day of the month. A `DATETIME` is read in the time zone of the run.' },
    HOUR: { signature: 'HOUR(t: TIME | DATETIME) → INTEGER', doc: 'The hour, 0 to 23. A `DATETIME` is read in the time zone of the run.' },
    MINUTE: { signature: 'MINUTE(t: TIME | DATETIME) → INTEGER', doc: 'The minute, 0 to 59. A `DATETIME` is read in the time zone of the run.' },
    DATE_ADD: {
        signature: 'DATE_ADD(d: DATE | DATETIME, n: INTEGER, unit: "year" | "month" | "week" | "day" | "hour" | "minute" | "second") → same type as d',
        doc: 'Adds `n` units (may be negative). Month ends clamp: Jan 31 + 1 month is Feb 28. Hours, minutes and seconds are for a `DATETIME` only. The unit is a text literal.'
    },
    DATE_DIFF: {
        signature: 'DATE_DIFF(a: DATE | DATETIME, b: DATE | DATETIME, unit: "year" | "month" | "week" | "day" | "hour" | "minute" | "second") → INTEGER',
        doc: 'Whole units from `b` to `a`, truncated toward zero. Both are `DATE` or both are `DATETIME`. The unit is a text literal.'
    }
};

const PLACEHOLDER = '__minab_completion__';

function code(text: string): string {
    return '`' + text.replace(/`/g, '\\`') + '`';
}

function describeColumn(column: MinabColumnSchema): string {
    const type = column.type;
    switch (type.kind) {
        case 'scalar':
            return formatType(type.type);
        case 'ref':
            return `ref → ${type.table}${type.nullable ? ' (nullable)' : ''}${type.foreignKey ? ` via ${type.foreignKey}` : ''}`;
        case 'collection':
            return `collection of ${type.table}${type.foreignKey ? ` via ${type.foreignKey}` : ''}`;
    }
}

function tableSummary(table: MinabTableSchema): string {
    const lines = table.columns.map(c => `| ${code(c.name)}${table.primaryKey === c.name ? ' 🔑' : ''} | ${code(describeColumn(c))} |`);
    return `| column | type |\n|---|---|\n${lines.join('\n')}`;
}

function offsetToPosition(text: string, offset: number): Position {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, character: offset - lineStart };
}

export class EditorIntel {
    constructor(private readonly language: LanguageHost) {}

    private get services() {
        return this.language.services;
    }

    private table(name: string): MinabTableSchema | undefined {
        return this.language.schema.tables.find(t => t.name === name);
    }

    private typeOf(node: AstNode): MinabType | undefined {
        try {
            const result = this.services.typeChecker.inferType(node as never);
            return result.ok ? result.type : undefined;
        } catch {
            return undefined;
        }
    }

    private tableOfType(type: MinabType | undefined): MinabTableSchema | undefined {
        if (!type || (type.kind !== 'record' && type.kind !== 'collection')) return undefined;
        return this.table(type.table);
    }

    // ---- hover ----------------------------------------------------------

    async hover(source: string, offset: number): Promise<HoverInfo | undefined> {
        const document = await this.language.parse(source, 'intel');
        const root = document.parseResult.value.$cstNode;
        if (!root) return undefined;
        const leaf = CstUtils.findLeafNodeAtOffset(root, offset);
        if (!leaf) return undefined;
        if (GrammarAST.isKeyword(leaf.grammarSource)) {
            return { contents: '', range: leaf.range, keyword: leaf.text };
        }
        const node = leaf.astNode;
        const contents = await this.describeNode(node, document);
        return contents ? { contents, range: rangeOf(node) } : undefined;
    }

    private async describeNode(node: AstNode, document: LangiumDocument<Model>): Promise<string | undefined> {
        const typed = (label: string, what: string, type?: MinabType) => `${code(label)} — ${what}${type ? `\n\n**type** ${code(formatType(type))}` : ''}`;

        if (isNamedScope(node)) {
            const type = this.typeOf(node);
            const table = this.tableOfType(type);
            const res = this.services.scopeResolver.resolveNamedScope(node);
            const fallback = res.found && res.scope.owner === node;
            const what = fallback ? `every row of table ${code(table?.name ?? node.name)} (spec §3.3)` : `the row bound to alias ${code(node.name)}`;
            return `${typed('#' + node.name, what, type)}${table ? `\n\n${tableSummary(table)}` : ''}`;
        }
        if (isTableRef(node)) {
            const table = this.table(node.name);
            return table ? `${code(node.name)} — table\n\n${tableSummary(table)}` : `${code(node.name)} — not a table in this host's schema`;
        }
        if (isCurrentRecord(node)) {
            if (!node.field) return typed('.', 'the current record — one row of the scope you are in (spec §2.2)', this.typeOf(node));
            return typed('.' + node.field, 'a column of the current record', this.typeOf(node));
        }
        if (isMemberAccess(node)) {
            const receiver = this.typeOf(node.receiver);
            const owner = this.tableOfType(receiver);
            const column = owner?.columns.find(c => c.name === node.member);
            const what =
                column && owner ? `column of ${code(owner.name)}${column.type.kind !== 'scalar' ? ` (${describeColumn(column)})` : ''}` : 'member access';
            return typed(node.$cstNode?.text.trim() ?? node.member, what, this.typeOf(node));
        }
        if (isParentRecord(node)) {
            return typed('^', 'the parent record — the row one scope level up (spec §2.2)', this.typeOf(node));
        }
        if (isFieldValue(node)) {
            return typed('$', 'the value of the field under validation (a field-level rule, spec §6.2)', this.typeOf(node));
        }
        if (isNameRef(node)) {
            const builtin = BUILTIN_DOCS[node.name];
            const isCallee = node.$container && isCallExpression(node.$container) && node.$container.callee === node;
            if (builtin && isCallee) {
                return `${code(builtin.signature)}\n\n${builtin.doc}`;
            }
            const decl = isCallee ? document.parseResult.value.declarations.find(d => isFunctionDecl(d) && d.name === node.name) : undefined;
            if (decl) {
                const signature = decl.$cstNode?.text.split('{')[0].trim() ?? node.name;
                return `\`\`\`minab\n${signature}\n\`\`\`\n\n${code(node.name)} — a user function (spec §8)`;
            }
            return typed(node.name, 'a name — a variable, parameter or alias', this.typeOf(node));
        }
        if (isCallExpression(node) && isNameRef(node.callee) && BUILTIN_DOCS[node.callee.name]) {
            const builtin = BUILTIN_DOCS[node.callee.name];
            return `${code(builtin.signature)}\n\n${builtin.doc}${this.typeSuffix(node)}`;
        }
        if (isVariableDecl(node)) {
            return `${code(node.name)} — variable${node.type?.$cstNode ? ` of type ${code(node.type.$cstNode.text)}` : ''}`;
        }
        if (isFunctionDecl(node)) {
            return '```minab\n' + (node.$cstNode?.text.split('{')[0].trim() ?? node.name) + '\n```';
        }
        const type = this.typeOf(node);
        return type ? `${code(node.$type)}\n\n**type** ${code(formatType(type))}` : undefined;
    }

    private typeSuffix(node: AstNode): string {
        const type = this.typeOf(node);
        return type ? `\n\n**type** ${code(formatType(type))}` : '';
    }

    // ---- definition -----------------------------------------------------

    async definition(source: string, offset: number): Promise<Range | undefined> {
        const document = await this.language.parse(source, 'intel');
        const links = await this.services.lsp.DefinitionProvider?.getDefinition(document, {
            textDocument: { uri: document.uri.toString() },
            position: document.textDocument.positionAt(offset)
        });
        return links?.[0]?.targetSelectionRange;
    }

    // ---- completion -----------------------------------------------------

    async complete(source: string, offset: number): Promise<CompletionReport> {
        const before = source.slice(0, offset);
        const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)?.[0] ?? '';
        const wordStart = offset - word.length;
        const replace: Range = {
            start: offsetToPosition(source, wordStart),
            end: offsetToPosition(source, offset)
        };
        const prefix = before.slice(0, wordStart);
        const withPlaceholder = prefix + PLACEHOLDER + source.slice(offset);
        const schema = this.language.schema;

        const tables = (rank: number): CompletionEntry[] =>
            schema.tables.map(t => ({
                label: t.name,
                kind: 'table',
                detail: `table · ${t.columns.length} columns`,
                documentation: tableSummary(t),
                rank
            }));

        // `#Tab…` — a named scope, or a whole table (spec §3.3).
        if (prefix.endsWith('#')) {
            const aliases = [...before.matchAll(/\b(?:AS)\s+([A-Za-z_]\w*)/g)].map(m => m[1]);
            return {
                replace,
                entries: [...tables(0), ...[...new Set(aliases)].map(a => ({ label: a, kind: 'variable' as const, detail: 'alias', rank: 1 }))]
            };
        }
        // `FROM Tab…`, `JOIN Tab…` — table names.
        if (/\b(FROM|JOIN|LEFTJOIN|CROSSJOIN)\s+$/.test(prefix)) {
            return { replace, entries: tables(0) };
        }
        // `.col…`, `^.col…`, `.customer.col…`, `KEY.col…`, `alias.col…` — columns of whatever is left of the dot.
        if (prefix.endsWith('.')) {
            const columns = await this.memberCompletions(withPlaceholder);
            return { replace, entries: columns };
        }

        return { replace, entries: await this.generalCompletions(source, offset, withPlaceholder) };
    }

    private async memberCompletions(text: string): Promise<CompletionEntry[]> {
        const document = await this.language.parse(text, 'probe');
        let table: MinabTableSchema | undefined;
        for (const node of AstUtils.streamAst(document.parseResult.value)) {
            if (isCurrentRecord(node) && node.field === PLACEHOLDER) {
                const base = this.services.scopeResolver.resolveCurrentRecordBase(node);
                if (base.found) {
                    const name = base.scope.tableName ?? (base.scope.owner.$type === 'Model' ? this.language.ruleContext.recordTable : undefined);
                    table = name ? this.table(name) : undefined;
                }
                break;
            }
            if (isMemberAccess(node) && node.member === PLACEHOLDER) {
                table = this.tableOfType(this.typeOf(node.receiver));
                break;
            }
        }
        if (!table) return [];
        return table.columns.map((column, index) => ({
            label: column.name,
            kind: 'column',
            detail: describeColumn(column),
            documentation: `column of ${code(table!.name)}`,
            rank: index
        }));
    }

    private async generalCompletions(source: string, offset: number, withPlaceholder: string): Promise<CompletionEntry[]> {
        const entries: CompletionEntry[] = [];
        const seen = new Set<string>();
        const push = (entry: CompletionEntry) => {
            if (seen.has(entry.label)) return;
            seen.add(entry.label);
            entries.push(entry);
        };

        // Keywords the grammar allows here, from Langium's follow-set completion.
        const document = await this.language.parse(source, 'intel');
        const list = await this.services.lsp.CompletionProvider?.getCompletion(document, {
            textDocument: { uri: document.uri.toString() },
            position: document.textDocument.positionAt(offset)
        });
        const keywords = new Set<string>();
        for (const item of list?.items ?? []) {
            if (!/^[A-Za-z_!]+$/.test(item.label) && item.label !== '.$index') continue;
            keywords.add(item.label);
            push({ label: item.label, kind: 'keyword', rank: 2 });
        }
        // Names and built-ins only where an expression may start — which is
        // wherever the grammar would also accept a literal like `true`.
        if (!keywords.has('true') && !keywords.has('CAST')) return entries;

        // Names in scope: variables, parameters, `fn`s.
        const probe = await this.language.parse(withPlaceholder, 'probe');
        const model = probe.parseResult.value;
        for (const decl of model.declarations) {
            if (isVariableDecl(decl)) push({ label: decl.name, kind: 'variable', detail: decl.type?.$cstNode?.text, rank: 0 });
        }
        const at = CstUtils.findLeafNodeAtOffset(model.$cstNode!, offset);
        const fn = at ? AstUtils.getContainerOfType(at.astNode, isFunctionDecl) : undefined;
        for (const param of fn?.params ?? []) {
            push({ label: param.name, kind: 'variable', detail: `parameter · ${param.type?.$cstNode?.text ?? ''}`, rank: 0 });
        }
        for (const f of model.declarations.filter(isFunctionDecl)) {
            push({
                label: f.name,
                kind: 'function',
                detail: f.$cstNode?.text.split('{')[0].trim(),
                insertText: `${f.name}(${f.params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')})`,
                rank: 1
            });
        }
        for (const name of builtinNames()) {
            const doc = BUILTIN_DOCS[name];
            push({ label: name, kind: 'builtin', detail: doc?.signature, documentation: doc?.doc, insertText: `${name}($1)`, rank: 1 });
        }
        return entries;
    }

    // ---- AST view -------------------------------------------------------

    async ast(source: string): Promise<AstNodeView | undefined> {
        const document = await this.language.parse(source, 'intel');
        const model = document.parseResult.value;
        if (!model) return undefined;
        let budget = 1500;
        const visit = (node: AstNode, feature?: string): AstNodeView => {
            budget--;
            const attributes: AstNodeView['attributes'] = {};
            const children: AstNodeView[] = [];
            for (const [key, value] of Object.entries(node)) {
                if (key.startsWith('$')) continue;
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    if (value !== false && value !== '') attributes[key] = value;
                } else if (Array.isArray(value)) {
                    value.forEach((item, index) => {
                        if (isAstNode(item) && budget > 0) children.push(visit(item, `${key}[${index}]`));
                    });
                } else if (isAstNode(value) && budget > 0) {
                    children.push(visit(value, key));
                }
            }
            const type = node.$type === 'Model' ? undefined : this.typeOf(node);
            return {
                type: node.$type,
                feature,
                range: rangeOf(node),
                attributes,
                inferredType: type ? formatType(type) : undefined,
                children
            };
        };
        return visit(model);
    }
}
