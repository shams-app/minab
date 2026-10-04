/**
 * `registerMinab(monaco, { client })`: one call that gives a Monaco editor the Minab language.
 *
 * Monaco is a parameter, never an import: a host passes the `monaco` it already loaded. Everything that
 * needs the parser (checks, completion, hover, signature help) goes to the worker through `client`,
 * so the main thread stays free.
 */

import type * as Monaco from 'monaco-editor';
import type { CompletionKind, EditorRange } from '../editor/types.js';
import type { MinabSeverity, SourceRange } from '../runtime/types.js';
import { languageConfiguration, tokensProvider } from './language.js';
import type { MinabRegistration, RegisterMinabOptions } from './types.js';

export const DEFAULT_LANGUAGE_ID = 'minab';
export const DEFAULT_DEBOUNCE_MS = 150;

type MonacoApi = typeof Monaco;

/** An editor range (0-based) as a Monaco range (1-based). */
export function toMonacoRange(range: EditorRange | SourceRange): Monaco.IRange {
    return {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1
    };
}

function severityOf(monaco: MonacoApi, severity: MinabSeverity): Monaco.MarkerSeverity {
    switch (severity) {
        case 'error':
            return monaco.MarkerSeverity.Error;
        case 'warning':
            return monaco.MarkerSeverity.Warning;
        case 'info':
            return monaco.MarkerSeverity.Info;
        default:
            return monaco.MarkerSeverity.Hint;
    }
}

function completionKinds(monaco: MonacoApi): Record<CompletionKind, Monaco.languages.CompletionItemKind> {
    const kinds = monaco.languages.CompletionItemKind;
    return {
        keyword: kinds.Keyword,
        table: kinds.Class,
        column: kinds.Field,
        function: kinds.Function,
        builtin: kinds.Method,
        variable: kinds.Variable,
        input: kinds.Variable,
        hostFunction: kinds.Function,
        type: kinds.TypeParameter
    };
}

/** Snippet syntax in an insert text: `$1`, `${1:name}` or `$0`. */
const SNIPPET_STOP = /\$(\d|\{\d)/;

export function registerMinab(monaco: MonacoApi, options: RegisterMinabOptions): MinabRegistration {
    const { client, ruleContext, keywordDocs, onError } = options;
    const languageId = options.languageId ?? DEFAULT_LANGUAGE_ID;
    const markerOwner = options.markerOwner ?? 'minab';
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const questionOptions = ruleContext ? { ruleContext } : undefined;
    const kinds = completionKinds(monaco);
    const disposables: Monaco.IDisposable[] = [];
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const watched = new Map<string, Monaco.IDisposable>();
    let disposed = false;

    /** A failed request leaves the editor as it is. The host can see it through `onError`. */
    const soft = <T>(work: Promise<T>): Promise<T | undefined> =>
        work.catch(error => {
            if (!disposed) onError?.(error);
            return undefined;
        });

    if (!monaco.languages.getLanguages().some(language => language.id === languageId)) {
        monaco.languages.register({ id: languageId, extensions: ['.minab'], aliases: ['Minab', 'minab'] });
    }
    disposables.push(
        monaco.languages.setLanguageConfiguration(languageId, languageConfiguration as Monaco.languages.LanguageConfiguration),
        monaco.languages.setTokensProvider(languageId, tokensProvider as unknown as Monaco.languages.TokensProvider)
    );

    // ---- markers -----------------------------------------------------------

    async function check(model: Monaco.editor.ITextModel): Promise<void> {
        if (disposed || model.isDisposed()) return;
        const version = model.getVersionId();
        const source = model.getValue();
        const program = await soft(client.prepare(source, ruleContext ? { ruleContext } : undefined));
        if (!program) return;
        try {
            // The text moved on while the worker was busy: the next check gives the markers.
            if (disposed || model.isDisposed() || model.getVersionId() !== version) return;
            monaco.editor.setModelMarkers(
                model,
                markerOwner,
                program.diagnostics.map(diagnostic => ({
                    ...toMonacoRange(diagnostic.range),
                    severity: severityOf(monaco, diagnostic.severity),
                    code: diagnostic.code,
                    message: diagnostic.message,
                    source: 'minab'
                }))
            );
        } finally {
            program.release?.();
        }
    }

    function schedule(model: Monaco.editor.ITextModel): void {
        const key = model.uri.toString();
        clearTimeout(timers.get(key));
        timers.set(
            key,
            setTimeout(() => {
                timers.delete(key);
                void check(model);
            }, debounceMs)
        );
    }

    function watch(model: Monaco.editor.ITextModel): void {
        if (model.getLanguageId() !== languageId) return;
        const key = model.uri.toString();
        if (watched.has(key)) return;
        watched.set(
            key,
            model.onDidChangeContent(() => schedule(model))
        );
        void check(model);
    }

    function unwatch(model: Monaco.editor.ITextModel): void {
        const key = model.uri.toString();
        watched.get(key)?.dispose();
        watched.delete(key);
        clearTimeout(timers.get(key));
        timers.delete(key);
    }

    for (const model of monaco.editor.getModels()) watch(model);
    disposables.push(
        monaco.editor.onDidCreateModel(watch),
        monaco.editor.onWillDisposeModel(unwatch),
        // A model whose language changes to or from Minab.
        monaco.editor.onDidChangeModelLanguage(({ model }) => {
            if (model.getLanguageId() === languageId) watch(model);
            else {
                unwatch(model);
                monaco.editor.setModelMarkers(model, markerOwner, []);
            }
        })
    );

    // ---- providers ---------------------------------------------------------

    disposables.push(
        monaco.languages.registerCompletionItemProvider(languageId, {
            triggerCharacters: ['.', '#', '$', '^'],
            async provideCompletionItems(model, position) {
                const result = await soft(client.complete(model.getValue(), model.getOffsetAt(position), questionOptions));
                if (!result) return { suggestions: [] };
                const range = toMonacoRange(result.replace);
                return {
                    suggestions: result.items.map(item => ({
                        label: item.label,
                        kind: kinds[item.kind],
                        detail: item.detail,
                        documentation: item.documentation === undefined ? undefined : { value: item.documentation },
                        insertText: item.insertText ?? item.label,
                        insertTextRules: SNIPPET_STOP.test(item.insertText ?? '') ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                        sortText: String(item.rank).padStart(3, '0') + item.label,
                        range
                    }))
                };
            }
        }),
        monaco.languages.registerHoverProvider(languageId, {
            async provideHover(model, position) {
                const result = await soft(client.hover(model.getValue(), model.getOffsetAt(position), questionOptions));
                if (!result) return undefined;
                const contents = result.keyword !== undefined && result.contents === '' ? keywordDocs?.(result.keyword) : result.contents;
                if (!contents) return undefined;
                return { contents: [{ value: contents }], range: result.range ? toMonacoRange(result.range) : undefined };
            }
        }),
        monaco.languages.registerSignatureHelpProvider(languageId, {
            signatureHelpTriggerCharacters: ['(', ','],
            signatureHelpRetriggerCharacters: [')'],
            async provideSignatureHelp(model, position) {
                const result = await soft(client.signatureHelp(model.getValue(), model.getOffsetAt(position), questionOptions));
                if (!result) return undefined;
                return {
                    value: {
                        signatures: [
                            {
                                label: result.label,
                                documentation: result.documentation === undefined ? undefined : { value: result.documentation },
                                parameters: result.parameters.map(label => ({ label }))
                            }
                        ],
                        activeSignature: 0,
                        activeParameter: result.activeParameter
                    },
                    dispose() {}
                };
            }
        })
    );

    return {
        check,
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
            for (const watcher of watched.values()) watcher.dispose();
            watched.clear();
            for (const model of monaco.editor.getModels()) {
                if (model.getLanguageId() === languageId) monaco.editor.setModelMarkers(model, markerOwner, []);
            }
            for (const disposable of disposables.splice(0)) disposable.dispose();
        }
    };
}
