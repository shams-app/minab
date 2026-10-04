/**
 * Turns the results of `src/editor/` into LSP types. This is all the language
 * server adds to them.
 */

import { CompletionItemKind, InsertTextFormat, MarkupKind, type CompletionItem, type Hover, type Location, type SignatureHelp } from 'vscode-languageserver';
import type { CompletionKind, CompletionResult, DefinitionResult, HoverResult, SignatureHelpResult } from '../editor/index.js';

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
