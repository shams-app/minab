/**
 * The Minab VS Code extension: a thin client for the Minab language server.
 * Syntax highlighting, snippets and `language-configuration` are declared in
 * `package.json`'s `contributes` and need no code. This file starts and stops
 * the server, sends it the settings, and shows the config file in use in the
 * status bar.
 *
 * The server is `server/main.mjs`, a single-file bundle of the root
 * package's `src/language/main.ts` produced by `npm run bundle:server`, so
 * the packaged `.vsix` is self-contained and doesn't need a checkout (or
 * `npm install`) next to it.
 */

import * as path from 'node:path';
import { commands, StatusBarAlignment, window, workspace, type ExtensionContext, type StatusBarItem, type TextEditor, Uri } from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { statusText } from './status.js';

/** The server sends this after each check. It must match `CONFIG_USED_NOTIFICATION` in `src/lsp/server.ts`. */
const CONFIG_USED_NOTIFICATION = 'minab/configUsed';

interface ConfigUsedParams {
    uri: string;
    configPath: string | null;
}

/** What other code (the smoke test) can ask the extension. */
export interface MinabExtensionApi {
    /** The text of the status bar item (without its icon), or `undefined` while it is hidden. */
    statusBarText(): string | undefined;
    /** The config file the server used for the last check of this document. `null`: none. `undefined`: not checked yet. */
    configUsedBy(uri: string): string | null | undefined;
}

let client: LanguageClient | undefined;

function configPathSetting(): string | undefined {
    const value = workspace.getConfiguration('minab').get<string>('configPath', '').trim();
    return value === '' ? undefined : value;
}

export async function activate(context: ExtensionContext): Promise<MinabExtensionApi> {
    const serverModule = context.asAbsolutePath(path.join('server', 'main.mjs'));

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'minab' }],
        initializationOptions: { configPath: configPathSetting() },
        // Sends the `minab` settings to the server when the user changes them.
        synchronize: { configurationSection: 'minab' }
    };

    client = new LanguageClient('minab', 'Minab', serverOptions, clientOptions);

    const configByDocument = new Map<string, string | null>();
    const item: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 0);
    item.name = 'Minab config';
    item.command = 'minab.openConfig';
    let shownConfig: string | null | undefined;

    function refresh(editor: TextEditor | undefined = window.activeTextEditor): void {
        if (editor?.document.languageId !== 'minab') {
            item.hide();
            shownConfig = undefined;
            return;
        }
        const configPath = configByDocument.get(editor.document.uri.toString());
        if (configPath === undefined) {
            item.hide();
            shownConfig = undefined;
            return;
        }
        shownConfig = configPath;
        const folder = workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
        item.text = `$(symbol-misc) ${statusText(configPath, folder)}`;
        item.tooltip = configPath === null ? 'Minab: no minab.config.json found for this file' : `Minab config: ${configPath}\nClick to open it.`;
        item.show();
    }

    context.subscriptions.push(
        item,
        window.onDidChangeActiveTextEditor(refresh),
        workspace.onDidCloseTextDocument(document => {
            configByDocument.delete(document.uri.toString());
        }),
        commands.registerCommand('minab.restartServer', async () => {
            await client?.restart();
        }),
        commands.registerCommand('minab.openConfig', async () => {
            if (typeof shownConfig === 'string') await window.showTextDocument(Uri.file(shownConfig));
            else void window.showInformationMessage('Minab: no minab.config.json found for this file. Set "minab.configPath" or add one next to your files.');
        })
    );

    client.onNotification(CONFIG_USED_NOTIFICATION, ({ uri, configPath }: ConfigUsedParams) => {
        configByDocument.set(uri, configPath);
        if (window.activeTextEditor?.document.uri.toString() === uri) refresh();
    });

    await client.start();

    return {
        statusBarText: () => (shownConfig === undefined ? undefined : item.text.replace(/^\$\([^)]*\)\s*/, '')),
        configUsedBy: uri => configByDocument.get(uri)
    };
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
