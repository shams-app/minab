/**
 * Turns the results of `src/editor/` into LSP types. This is all the language
 * server adds to them.
 */

import {
    CodeActionKind,
    CompletionItemKind,
    InsertTextFormat,
    MarkupKind,
    SemanticTokensBuilder,
    SymbolKind,
    type CodeAction,
    type CompletionItem,
    type Diagnostic,
    type DocumentSymbol,
    type Hover,
    type Location,
    type SemanticTokens,
    type SemanticTokensLegend,
    type SignatureHelp,
    type WorkspaceEdit
} from 'vscode-languageserver';
import {
    SEMANTIC_TOKEN_MODIFIERS,
    SEMANTIC_TOKEN_TYPES,
    type CompletionKind,
    type CompletionResult,
    type DefinitionResult,
    type DocumentSymbolResult,
    type HoverResult,
    type QuickFix,
    type ReferenceResult,
    type SemanticToken,
    type SignatureHelpResult,
    type SymbolKind as EditorSymbolKind,
    type TextEdit
} from '../editor/index.js';

const KINDS: Record<CompletionKind, CompletionItemKind> = {
    keyword: CompletionItemKind.Keyword,
    table: CompletionItemKind.Class,
    column: CompletionItemKind.Field,
    function: CompletionItemKind.Function,
    builtin: CompletionItemKind.Function,
    variable: CompletionItemKind.Variable,
    input: CompletionItemKind.Variable,
    hostFunction: CompletionItemKind.Function,
    type: CompletionItemKind.TypeParameter
};

export function toHover(result: HoverResult | undefined): Hover | undefined {
    // A keyword has no text here. The client may document it itself.
    if (!result || !result.contents) return undefined;
    return { contents: { kind: MarkupKind.Markdown, value: result.contents }, range: result.range };
}

export function toCompletionItems(result: CompletionResult): CompletionItem[] {
    return result.items.map(item => {
        const text = item.insertText ?? item.label;
        const isSnippet = /\$\d|\$\{/.test(text);
        return {
            label: item.label,
            kind: KINDS[item.kind],
            detail: item.detail,
            documentation: item.documentation ? { kind: MarkupKind.Markdown, value: item.documentation } : undefined,
            // Lower rank sorts first. The padding keeps the text order right.
            sortText: `${String(item.rank).padStart(3, '0')}${item.label}`,
            textEdit: { range: result.replace, newText: text },
            insertTextFormat: isSnippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText
        };
    });
}

export function toLocation(uri: string, result: DefinitionResult | undefined): Location | undefined {
    return result ? { uri, range: result.target } : undefined;
}

export function toSignatureHelp(result: SignatureHelpResult | undefined): SignatureHelp | undefined {
    if (!result) return undefined;
    return {
        signatures: [
            {
                label: result.label,
                documentation: result.documentation ? { kind: MarkupKind.Markdown, value: result.documentation } : undefined,
                parameters: result.parameters.map(label => ({ label })),
                activeParameter: result.activeParameter
            }
        ],
        activeSignature: 0,
        activeParameter: result.activeParameter
    };
}

const SYMBOL_KINDS: Record<EditorSymbolKind, SymbolKind> = {
    function: SymbolKind.Function,
    parameter: SymbolKind.Variable,
    variable: SymbolKind.Variable,
    alias: SymbolKind.Namespace
};

export function toDocumentSymbols(results: DocumentSymbolResult[]): DocumentSymbol[] {
    return results.map(r => ({
        name: r.name,
        kind: SYMBOL_KINDS[r.kind],
        detail: r.detail,
        range: r.range,
        selectionRange: r.selectionRange,
        children: toDocumentSymbols(r.children)
    }));
}

export function toLocations(uri: string, results: ReferenceResult[]): Location[] {
    return results.map(r => ({ uri, range: r.range }));
}

export function toWorkspaceEdit(uri: string, edits: TextEdit[]): WorkspaceEdit {
    return { changes: { [uri]: edits.map(e => ({ range: e.range, newText: e.newText })) } };
}

export const SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
    tokenTypes: [...SEMANTIC_TOKEN_TYPES],
    tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS]
};

export function toSemanticTokens(tokens: SemanticToken[]): SemanticTokens {
    const builder = new SemanticTokensBuilder();
    for (const t of tokens) {
        const modifiers = t.modifiers.reduce((bits, m) => bits | (1 << SEMANTIC_TOKEN_MODIFIERS.indexOf(m)), 0);
        builder.push(t.line, t.character, t.length, SEMANTIC_TOKEN_TYPES.indexOf(t.type), modifiers);
    }
    return builder.build();
}

export function toCodeActions(uri: string, diagnostic: Diagnostic, fixes: QuickFix[]): CodeAction[] {
    return fixes.map(fix => ({
        title: fix.title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: toWorkspaceEdit(uri, fix.edits)
    }));
}
