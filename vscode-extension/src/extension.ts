/**
 * The Minab VS Code extension (roadmap Phases 7 and 9) — a thin client
 * wiring this window's `.minab` documents to the Minab language server.
 * Syntax highlighting and `language-configuration` are declared in
 * `package.json`'s `contributes` and need no code; this file's only job is
 * starting/stopping the server process.
 *
 * The server is `server/main.mjs`, a single-file bundle of the root
 * package's `src/language/main.ts` produced by `npm run bundle:server`, so
 * the packaged `.vsix` is self-contained and doesn't need a checkout (or
 * `npm install`) next to it.
 */

import * as path from 'node:path';
import type { ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
    const serverModule = context.asAbsolutePath(path.join('server', 'main.mjs'));

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'minab' }]
    };

    client = new LanguageClient('minab', 'Minab', serverOptions, clientOptions);
    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
