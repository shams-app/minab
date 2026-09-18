/**
 * The Minab VS Code extension (roadmap Phase 7) — a thin client wiring
 * this window's `.minab` documents to the Minab language server
 * (`../../out/src/language/main.js`, the root package's compiled
 * `src/language/main.ts`). Syntax highlighting and `language-configuration`
 * are declared in `package.json`'s `contributes` and need no code; this
 * file's only job is starting/stopping the server process.
 *
 * Referenced by relative path into the root package's own build output
 * rather than as an npm dependency — this repo has no workspaces, and the
 * server isn't published as its own package. `npm run build` at the repo
 * root must have produced `out/src/language/main.js` before this
 * extension is loaded.
 */

import * as path from 'node:path';
import type { ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
    const serverModule = context.asAbsolutePath(path.join('..', 'out', 'src', 'language', 'main.js'));

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
