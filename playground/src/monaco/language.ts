/**
 * Minab in Monaco: tokens, brackets and comments, and the providers that
 * ask the engine worker for hovers, completions and definitions.
 *
 * Highlighting runs the same tokenizer as the static snippets
 * (`syntax/tokens.ts`); bracket and comment behavior is the VS Code
 * extension's own `language-configuration.json`, imported as-is.
 */

import languageConfiguration from '../../../vscode-extension/language-configuration.json';
import { engineClient } from '../client/engine-client.js';
import { keywordDocs, SPEC_URL } from '../content/reference/cheatsheet.js';
import type { CompletionKind, Range } from '../engine/protocol.js';
import { getState } from '../state/store.js';
import { INITIAL_STATE, tokenizeLine, type LineState } from '../syntax/tokens.js';
import { monaco } from './monaco.js';

export const LANGUAGE_ID = 'minab';

class TokenState implements monaco.languages.IState {
    constructor(readonly line: LineState) {}
    clone(): TokenState {
        return new TokenState({ ...this.line });
    }
    equals(other: monaco.languages.IState): boolean {
        return other instanceof TokenState && other.line.inBlockComment === this.line.inBlockComment;
    }
}

export function toMonacoRange(range: Range): monaco.IRange {
    return {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1
    };
}

function toRange(range: monaco.IRange): Range {
    return {
        start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
        end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
    };
}

const COMPLETION_KINDS: Record<CompletionKind, monaco.languages.CompletionItemKind> = {
    keyword: monaco.languages.CompletionItemKind.Keyword,
    table: monaco.languages.CompletionItemKind.Class,
    column: monaco.languages.CompletionItemKind.Field,
    function: monaco.languages.CompletionItemKind.Function,
    builtin: monaco.languages.CompletionItemKind.Method,
    variable: monaco.languages.CompletionItemKind.Variable,
    type: monaco.languages.CompletionItemKind.TypeParameter
};

const SNIPPETS: Array<{ label: string; detail: string; body: string }> = [
    { label: 'FROM … SELECT', detail: 'pipeline query', body: 'FROM ${1:Order}\nWHERE ${2:.status == "shipped"}\nSELECT ${3:.id}' },
    {
        label: 'GROUPBY … SELECT KEY',
        detail: 'grouped query',
        body: 'FROM ${1:Order}\nGROUPBY ${2:.customer}\nSELECT KEY.${3:name} AS ${4:group}, COUNT(.) AS ${5:count}'
    },
    { label: 'fn', detail: 'function declaration', body: 'fn ${1:name}(${2:value}: ${3:DECIMAL}): ${4:DECIMAL} {\n    ${5:value}\n}' },
    { label: 'let', detail: 'variable', body: 'let ${1:name}: ${2:DECIMAL} = ${3:0};' },
    { label: 'if … else', detail: 'if expression', body: 'if ${1:condition} {\n    ${2}\n} else {\n    ${3}\n}' },
    { label: 'switch', detail: 'switch expression', body: 'switch ${1:.status} {\n    "${2:value}" => ${3:true},\n    _ => ${4:false}\n}' },
    { label: 'EXISTS(#Table[…])', detail: 'correlated check', body: 'EXISTS(#${1:Booking}[${2:.room_id == ^.room_id}])' }
];

function keywordHover(keyword: string): string | undefined {
    const entry = keywordDocs.get(keyword);
    if (!entry) return undefined;
    const status = entry.status === 'check-only' ? ' · *checks today, runs later*' : '';
    return `**${entry.title}** — [spec ${entry.specRef}](${SPEC_URL})${status}\n\n\`\`\`minab\n${entry.syntax}\n\`\`\`\n\n${entry.description}`;
}

let registered = false;

/** Registers the language once per page; safe to call from every editor mount. */
export function registerMinab(): void {
    if (registered) return;
    registered = true;
    const engine = engineClient();

    monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.minab'], aliases: ['Minab', 'minab'] });
    monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
        ...(languageConfiguration as unknown as monaco.languages.LanguageConfiguration),
        wordPattern: /(-?\d+(\.\d+)?)|([\p{L}_][\p{L}\p{N}_\u200C\u200D]*!?)|(`(?:[^`\\]|\\[\s\S])*`)/gu
    });

    monaco.languages.setTokensProvider(LANGUAGE_ID, {
        getInitialState: () => new TokenState(INITIAL_STATE),
        tokenize(line, state) {
            const result = tokenizeLine(line, (state as TokenState).line);
            return {
                tokens: result.tokens.map(t => ({ startIndex: t.start, scopes: t.type })),
                endState: new TokenState(result.state)
            };
        }
    });

    monaco.languages.registerHoverProvider(LANGUAGE_ID, {
        async provideHover(model, position) {
            const info = await engine.call('hover', model.getValue(), model.getOffsetAt(position)).catch(() => undefined);
            if (!info) return undefined;
            const contents = info.keyword ? keywordHover(info.keyword) : info.contents;
            if (!contents) return undefined;
            return {
                contents: [{ value: contents, isTrusted: false }],
                range: info.range ? toMonacoRange(info.range) : undefined
            };
        }
    });

    monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
        triggerCharacters: ['.', '#'],
        async provideCompletionItems(model, position, context) {
            const offset = model.getOffsetAt(position);
            const report = await engine.call('complete', model.getValue(), offset).catch(() => undefined);
            const word = model.getWordUntilPosition(position);
            const fallback: monaco.IRange = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };
            const range = report?.replace ? toMonacoRange(report.replace) : fallback;
            const suggestions: monaco.languages.CompletionItem[] = (report?.entries ?? []).map(entry => ({
                label: entry.label,
                kind: COMPLETION_KINDS[entry.kind],
                detail: entry.detail,
                documentation: entry.documentation ? { value: entry.documentation } : undefined,
                insertText: entry.insertText ?? entry.label,
                insertTextRules: entry.insertText?.includes('$') ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                sortText: `${entry.rank}`.padStart(3, '0') + entry.label,
                range
            }));
            const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
            const triggered = context.triggerCharacter !== undefined || /[.#&]\w*$/.test(lineBefore);
            if (!triggered) {
                for (const snippet of SNIPPETS) {
                    suggestions.push({
                        label: snippet.label,
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        detail: snippet.detail,
                        insertText: snippet.body,
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        sortText: '900' + snippet.label,
                        range
                    });
                }
            }
            return { suggestions };
        }
    });

    monaco.languages.registerDefinitionProvider(LANGUAGE_ID, {
        async provideDefinition(model, position) {
            const target = await engine.call('definition', model.getValue(), model.getOffsetAt(position)).catch(() => undefined);
            return target ? { uri: model.uri, range: toMonacoRange(target) } : undefined;
        }
    });

    monaco.languages.registerDocumentSymbolProvider(LANGUAGE_ID, {
        provideDocumentSymbols() {
            const symbols = getState().analysis?.program.symbols ?? [];
            return symbols.map(symbol => ({
                name: symbol.name,
                detail: symbol.detail ?? '',
                kind: symbol.kind === 'function' ? monaco.languages.SymbolKind.Function : monaco.languages.SymbolKind.Variable,
                range: toMonacoRange(symbol.range),
                selectionRange: toMonacoRange(symbol.range),
                tags: []
            }));
        }
    });
}

export { toRange };
