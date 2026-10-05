/**
 * The Minab language server. Each document gets the schema of the nearest
 * `minab.config.json` above it (see `config-registry.ts`). When a config file
 * changes, the server builds its services again and checks the open documents
 * again. The features come from `src/editor/`; `adapters.ts` converts them.
 */

import { URI, type LangiumDocument } from 'langium';
import {
    CodeActionKind,
    createConnection,
    DidChangeWatchedFilesNotification,
    FileChangeType,
    LSPErrorCodes,
    ProposedFeatures,
    ResponseError,
    TextDocuments,
    TextDocumentSyncKind,
    type Connection,
    type Diagnostic,
    type InitializeResult
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    complete,
    definition,
    documentSymbols,
    findReferences,
    hover,
    parseDocument,
    prepareRename,
    quickFixes,
    rename,
    semanticTokens,
    signatureHelp,
    type EditorDocument,
    type FixableDiagnostic
} from '../editor/index.js';
import type { Model } from '../language/generated/ast.js';
import { ConfigRegistry } from './config-registry.js';
import {
    SEMANTIC_TOKENS_LEGEND,
    toCodeActions,
    toCompletionItems,
    toDocumentSymbols,
    toHover,
    toLocation,
    toLocations,
    toSemanticTokens,
    toSignatureHelp,
    toWorkspaceEdit
} from './adapters.js';

export interface MinabLanguageServerOptions {
    /** The connection to use. By default: a new one on stdio (or the channel the client asks for). */
    connection?: Connection;
}

export interface MinabLanguageServer {
    connection: Connection;
}

function sameRange(a: Diagnostic, b: Diagnostic): boolean {
    const [x, y] = [a.range, b.range];
    return x.start.line === y.start.line && x.start.character === y.start.character && x.end.line === y.end.line && x.end.character === y.end.character;
}

export const CONFIG_GLOB = '**/minab.config.json';

/**
 * The server sends this notification after it checks a document. It tells the
 * client which config file the document uses (`configPath` is `null` when there is none).
 */
export const CONFIG_USED_NOTIFICATION = 'minab/configUsed';

export interface ConfigUsedParams {
    uri: string;
    configPath: string | null;
}

/** The `minab.configPath` setting. Empty or missing means: find the config like the CLI. */
function configPathSetting(settings: unknown): string | undefined {
    const value = (settings as { configPath?: unknown } | null | undefined)?.configPath;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Starts the language server and listens on its connection. */
export function startMinabLanguageServer(options: MinabLanguageServerOptions = {}): MinabLanguageServer {
    const connection = options.connection ?? createConnection(ProposedFeatures.all);
    const documents = new TextDocuments(TextDocument);
    const registry = new ConfigRegistry();
    const reportedErrors = new Set<string>();
    // The diagnostics last sent for each document. A quick fix reads the parameters from here, so it does not depend on the client sending `data` back.
    const sent = new Map<string, Diagnostic[]>();

    // One check at a time for each document: a check adds the document to its workspace and removes it again.
    const queue = new Map<string, Promise<void>>();

    function editorDocument(textDocument: TextDocument): EditorDocument {
        const { services } = registry.resolve(textDocument.uri).services;
        return parseDocument(services, textDocument.getText());
    }

    async function check(textDocument: TextDocument): Promise<void> {
        const { uri, version } = textDocument;
        const resolved = registry.resolve(uri);
        if (resolved.configError !== undefined && !reportedErrors.has(resolved.configError)) {
            reportedErrors.add(resolved.configError);
            connection.window.showWarningMessage(`Minab: ${resolved.configError}`);
        }
        const { shared } = resolved.services;
        const workspace = shared.workspace;
        const parsedUri = URI.parse(uri);
        let document: LangiumDocument<Model>;
        try {
            document = workspace.LangiumDocumentFactory.fromString<Model>(textDocument.getText(), parsedUri);
            workspace.LangiumDocuments.addDocument(document);
            // Like the CLI: a program with syntax errors gets those errors only.
            await workspace.DocumentBuilder.build([document], {
                validation: { stopAfterLexingErrors: true, stopAfterParsingErrors: true }
            });
        } catch (e) {
            connection.console.error(`Minab: cannot check ${uri}: ${e instanceof Error ? e.message : String(e)}`);
            return;
        } finally {
            if (workspace.LangiumDocuments.hasDocument(parsedUri)) workspace.LangiumDocuments.deleteDocument(parsedUri);
        }
        // A newer version came while this one was checked: its own check will send the diagnostics.
        if (documents.get(uri)?.version !== version) return;
        sent.set(uri, document.diagnostics ?? []);
        void connection.sendNotification(CONFIG_USED_NOTIFICATION, { uri, configPath: resolved.configPath ?? null } satisfies ConfigUsedParams);
        await connection.sendDiagnostics({ uri, version, diagnostics: document.diagnostics ?? [] });
    }

    function schedule(textDocument: TextDocument): Promise<void> {
        const previous = queue.get(textDocument.uri) ?? Promise.resolve();
        const next = previous.then(() => check(textDocument));
        queue.set(textDocument.uri, next);
        void next.finally(() => {
            if (queue.get(textDocument.uri) === next) queue.delete(textDocument.uri);
        });
        return next;
    }

    documents.onDidChangeContent(event => void schedule(event.document));
    documents.onDidClose(event => {
        sent.delete(event.document.uri);
        void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
    });

    // A relative `minab.configPath` is relative to the first workspace folder.
    let workspaceRoot: string | undefined;
    function applyConfigPath(setting: string | undefined): void {
        registry.setOverride(setting === undefined || isAbsolute(setting) || workspaceRoot === undefined ? setting : resolvePath(workspaceRoot, setting));
    }

    let canWatch = false;
    connection.onInitialize((params): InitializeResult => {
        canWatch = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
        const rootUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
        try {
            workspaceRoot = rootUri?.startsWith('file:') ? fileURLToPath(rootUri) : undefined;
        } catch {
            workspaceRoot = undefined;
        }
        applyConfigPath(configPathSetting(params.initializationOptions));
        return {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                completionProvider: { triggerCharacters: ['.', '#', '('] },
                hoverProvider: true,
                definitionProvider: true,
                signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [','] },
                documentSymbolProvider: true,
                referencesProvider: true,
                renameProvider: { prepareProvider: true },
                semanticTokensProvider: { legend: SEMANTIC_TOKENS_LEGEND, full: true },
                codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] }
            }
        };
    });
    connection.onInitialized(() => {
        if (!canWatch) return;
        void connection.client.register(DidChangeWatchedFilesNotification.type, { watchers: [{ globPattern: CONFIG_GLOB }] });
    });

    // The client sends the `minab` settings when the user changes them.
    connection.onDidChangeConfiguration(({ settings }) => {
        applyConfigPath(configPathSetting((settings as { minab?: unknown } | null | undefined)?.minab));
        registry.invalidateAll();
        for (const textDocument of documents.all()) void schedule(textDocument);
    });

    connection.onDidChangeWatchedFiles(({ changes }) => {
        for (const change of changes) {
            if (change.type === FileChangeType.Changed || change.type === FileChangeType.Deleted) {
                try {
                    registry.invalidate(fileURLToPath(change.uri));
                } catch {
                    // Not a file: path. It cannot be a config we read.
                }
            }
        }
        // A config may also appear or go away, which changes which one a document uses. So check them all.
        for (const textDocument of documents.all()) void schedule(textDocument);
    });

    connection.onCompletion(async ({ textDocument, position }) => {
        const doc = documents.get(textDocument.uri);
        if (!doc) return [];
        const editor = editorDocument(doc);
        return toCompletionItems(await complete(editor, doc.offsetAt(position)));
    });
    connection.onHover(({ textDocument, position }) => {
        const doc = documents.get(textDocument.uri);
        return doc ? toHover(hover(editorDocument(doc), doc.offsetAt(position))) : undefined;
    });
    connection.onDefinition(({ textDocument, position }) => {
        const doc = documents.get(textDocument.uri);
        return doc ? toLocation(doc.uri, definition(editorDocument(doc), doc.offsetAt(position))) : undefined;
    });
    connection.onSignatureHelp(({ textDocument, position }) => {
        const doc = documents.get(textDocument.uri);
        return doc ? toSignatureHelp(signatureHelp(editorDocument(doc), doc.offsetAt(position))) : undefined;
    });

    connection.onDocumentSymbol(({ textDocument }) => {
        const doc = documents.get(textDocument.uri);
        return doc ? toDocumentSymbols(documentSymbols(editorDocument(doc))) : [];
    });
    connection.onReferences(({ textDocument, position, context }) => {
        const doc = documents.get(textDocument.uri);
        return doc ? toLocations(doc.uri, findReferences(editorDocument(doc), doc.offsetAt(position), context.includeDeclaration)) : [];
    });
    connection.onPrepareRename(({ textDocument, position }) => {
        const doc = documents.get(textDocument.uri);
        return doc ? (prepareRename(editorDocument(doc), doc.offsetAt(position)) ?? null) : null;
    });
    connection.onRenameRequest(({ textDocument, position, newName }) => {
        const doc = documents.get(textDocument.uri);
        if (!doc) return null;
        const result = rename(editorDocument(doc), doc.offsetAt(position), newName);
        // The client shows the message of this error to the user.
        if (!result.ok) throw new ResponseError(LSPErrorCodes.RequestFailed, result.message);
        return toWorkspaceEdit(doc.uri, result.edits);
    });
    connection.languages.semanticTokens.on(({ textDocument }) => {
        const doc = documents.get(textDocument.uri);
        return toSemanticTokens(doc ? semanticTokens(editorDocument(doc)) : []);
    });
    connection.onCodeAction(({ textDocument, context }) => {
        const doc = documents.get(textDocument.uri);
        if (!doc) return [];
        const editor = editorDocument(doc);
        return context.diagnostics.flatMap(diagnostic => {
            const own = sent.get(doc.uri)?.find(d => d.code === diagnostic.code && sameRange(d, diagnostic)) ?? diagnostic;
            const params = (own.data as { params?: FixableDiagnostic['params'] } | undefined)?.params;
            if (typeof diagnostic.code !== 'string' || !params) return [];
            return toCodeActions(doc.uri, diagnostic, quickFixes(editor, { code: diagnostic.code, range: diagnostic.range, params }));
        });
    });

    documents.listen(connection);
    connection.listen();
    return { connection };
}
