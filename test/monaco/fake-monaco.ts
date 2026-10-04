/**
 * A fake `monaco` and a fake model for the tests of `src/monaco`. It keeps what the
 * integration registers, so a test can call the providers and read the markers.
 */

export interface FakeModel {
    uri: { toString(): string };
    text: string;
    version: number;
    disposed: boolean;
    language: string;
    listeners: Array<() => void>;
    getValue(): string;
    getVersionId(): number;
    getLanguageId(): string;
    isDisposed(): boolean;
    getOffsetAt(position: { lineNumber: number; column: number }): number;
    onDidChangeContent(listener: () => void): { dispose(): void };
    edit(text: string): void;
}

export function fakeModel(text: string, name = 'a', language = 'minab'): FakeModel {
    const model: FakeModel = {
        uri: { toString: () => `inmemory://${name}` },
        text,
        version: 1,
        disposed: false,
        language,
        listeners: [],
        getValue: () => model.text,
        getVersionId: () => model.version,
        getLanguageId: () => model.language,
        isDisposed: () => model.disposed,
        getOffsetAt({ lineNumber, column }) {
            const lines = model.text.split('\n');
            let offset = 0;
            for (let i = 0; i < lineNumber - 1; i++) offset += lines[i].length + 1;
            return offset + column - 1;
        },
        onDidChangeContent(listener) {
            model.listeners.push(listener);
            return { dispose: () => void (model.listeners = model.listeners.filter(l => l !== listener)) };
        },
        edit(next) {
            model.text = next;
            model.version++;
            for (const listener of [...model.listeners]) listener();
        }
    };
    return model;
}

type Provider = Record<string, (...args: never[]) => unknown>;

export function fakeMonaco() {
    const models: FakeModel[] = [];
    const markers = new Map<string, unknown[]>();
    const markerCalls: Array<{ owner: string; uri: string; markers: unknown[] }> = [];
    const createListeners: Array<(model: FakeModel) => void> = [];
    const disposeListeners: Array<(model: FakeModel) => void> = [];
    const providers: Record<string, Provider> = {};
    const registered: Array<{ id: string }> = [];
    const live = new Set<string>();
    const config: Record<string, unknown> = {};
    let tokens: unknown;

    const track = (name: string, value: Provider) => {
        providers[name] = value;
        live.add(name);
        return { dispose: () => void live.delete(name) };
    };

    const monaco = {
        MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
        languages: {
            CompletionItemKind: { Method: 0, Function: 1, Field: 3, Variable: 4, Class: 5, Keyword: 17, TypeParameter: 24 },
            CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
            getLanguages: () => registered,
            register: (language: { id: string }) => void registered.push(language),
            setLanguageConfiguration(id: string, value: unknown) {
                config[id] = value;
                return { dispose() {} };
            },
            setTokensProvider(_id: string, value: unknown) {
                tokens = value;
                return { dispose() {} };
            },
            registerCompletionItemProvider: (_id: string, provider: Provider) => track('completion', provider),
            registerHoverProvider: (_id: string, provider: Provider) => track('hover', provider),
            registerSignatureHelpProvider: (_id: string, provider: Provider) => track('signature', provider)
        },
        editor: {
            getModels: () => models,
            onDidCreateModel(listener: (model: FakeModel) => void) {
                createListeners.push(listener);
                return { dispose: () => void createListeners.splice(createListeners.indexOf(listener), 1) };
            },
            onWillDisposeModel(listener: (model: FakeModel) => void) {
                disposeListeners.push(listener);
                return { dispose: () => void disposeListeners.splice(disposeListeners.indexOf(listener), 1) };
            },
            onDidChangeModelLanguage: () => ({ dispose() {} }),
            setModelMarkers(model: FakeModel, owner: string, list: unknown[]) {
                markers.set(`${owner}:${model.uri.toString()}`, list);
                markerCalls.push({ owner, uri: model.uri.toString(), markers: list });
            }
        }
    };

    return {
        monaco: monaco as never,
        models,
        markers,
        markerCalls,
        providers,
        live,
        config,
        get tokens(): {
            getInitialState(): unknown;
            tokenize(line: string, state: unknown): { tokens: { startIndex: number; scopes: string }[]; endState: unknown };
        } {
            return tokens as never;
        },
        registered,
        /** Adds a model the way Monaco does: it is listed, then listeners hear of it. */
        addModel(model: FakeModel) {
            models.push(model);
            for (const listener of [...createListeners]) listener(model);
        },
        removeModel(model: FakeModel) {
            for (const listener of [...disposeListeners]) listener(model);
            model.disposed = true;
            models.splice(models.indexOf(model), 1);
        }
    };
}
