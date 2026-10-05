/**
 * The smoke test. It runs inside VS Code (started by `../runTest.ts`).
 * It uses no test framework: `run()` throws on the first failure.
 */

import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { commands, extensions, languages, Range, Uri, window, workspace, WorkspaceEdit, DiagnosticSeverity } from 'vscode';

/** The API the extension returns from `activate()` (see `src/extension.ts`). */
interface MinabExtensionApi {
    statusBarText(): string | undefined;
    configUsedBy(uri: string): string | null | undefined;
}

const TIMEOUT_MS = 60_000;

async function waitFor<T>(what: string, probe: () => T | undefined | false): Promise<T> {
    const start = Date.now();
    for (;;) {
        const value = probe();
        if (value !== undefined && value !== false) return value;
        if (Date.now() - start > TIMEOUT_MS) throw new Error(`Timed out waiting for: ${what}`);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function open(file: string): Promise<Uri> {
    const folder = workspace.workspaceFolders?.[0];
    assert.ok(folder, 'the fixture folder is open');
    const uri = Uri.file(path.join(folder.uri.fsPath, file));
    await window.showTextDocument(await workspace.openTextDocument(uri));
    return uri;
}

export async function run(): Promise<void> {
    const extension = extensions.getExtension<MinabExtensionApi>('shamsine.minab-vscode');
    assert.ok(extension, 'the extension is installed');
    const api = await extension.activate();
    assert.ok(extension.isActive, 'the extension is active');

    // A file with a type error gets one error from the server, with a stable code.
    const bad = await open('type-error.minab');
    assert.equal((await workspace.openTextDocument(bad)).languageId, 'minab');
    const diagnostics = await waitFor('a diagnostic on type-error.minab', () => {
        const found = languages.getDiagnostics(bad);
        return found.length > 0 ? found : undefined;
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].severity, DiagnosticSeverity.Error);
    assert.match(diagnostics[0].message, /CAST/);

    // The status bar names the config file that this document uses.
    await waitFor('the config used by type-error.minab', () => api.configUsedBy(bad.toString()));
    assert.match(String(api.configUsedBy(bad.toString())), /type-error[\\/]minab\.config\.json$/);
    await waitFor('the status bar text', () => api.statusBarText() === 'Minab: minab.config.json' || undefined);

    // A valid file gets no diagnostic.
    const good = await open('valid.minab');
    await waitFor('the config used by valid.minab', () => api.configUsedBy(good.toString()));
    assert.deepEqual(languages.getDiagnostics(good), []);

    // The restart command works, and the server checks documents again after it.
    await commands.executeCommand('minab.restartServer');
    await window.showTextDocument(await workspace.openTextDocument(bad));
    const edit = new WorkspaceEdit();
    edit.insert(bad, new Range(0, 0, 0, 0).start, '// restarted\n');
    assert.ok(await workspace.applyEdit(edit), 'the edit is applied');
    await waitFor('a diagnostic after the restart', () => {
        const found = languages.getDiagnostics(bad);
        return found.length === 1 && found[0].range.start.line === 2 ? found : undefined;
    });
}
