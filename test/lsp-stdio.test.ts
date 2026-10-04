/**
 * The real language server, over stdio (production plan E2). It spawns the built
 * server (`out/src/language/main.js`), so `npm run build` must run before this test.
 * Two folders hold two different configs. Each document must be checked
 * against its own schema.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    CompletionRequest,
    DidChangeWatchedFilesNotification,
    DidCloseTextDocumentNotification,
    DidOpenTextDocumentNotification,
    ExitNotification,
    HoverRequest,
    InitializeRequest,
    InitializedNotification,
    PublishDiagnosticsNotification,
    RegistrationRequest,
    ShutdownRequest,
    SignatureHelpRequest,
    StreamMessageReader,
    StreamMessageWriter,
    createMessageConnection,
    type CompletionItem,
    type Diagnostic,
    type MessageConnection
} from 'vscode-languageserver-protocol/node';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const SERVER = join(process.cwd(), 'out', 'src', 'language', 'main.js');

const customerConfig = { schema: { tables: [{ name: 'Customer', primaryKey: 'id', columns: { id: 'INTEGER', name: 'TEXT' } }] } };
const orderConfig = { schema: { tables: [{ name: 'Order', primaryKey: 'id', columns: { id: 'INTEGER', total: 'DECIMAL' } }] } };

let root: string;
let server: ChildProcess;
let connection: MessageConnection;
const diagnostics = new Map<string, Diagnostic[]>();
const waiting: Array<{ uri: string; predicate: (d: Diagnostic[]) => boolean; resolve: (d: Diagnostic[]) => void }> = [];
const registrations: unknown[] = [];
let registered: () => void;
const registeredWatch = new Promise<void>(resolve => (registered = resolve));

function writeConfig(folder: string, config: unknown): string {
    const path = join(root, folder, 'minab.config.json');
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(path, JSON.stringify(config));
    return path;
}

const uriOf = (folder: string, file: string) => pathToFileURL(join(root, folder, file)).toString();

/** Resolves with the next diagnostics of `uri` that satisfy `predicate` (also ones that already arrived after this call). */
function nextDiagnostics(uri: string, predicate: (d: Diagnostic[]) => boolean = () => true): Promise<Diagnostic[]> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no diagnostics for ${uri}`)), 15_000);
        waiting.push({
            uri,
            predicate,
            resolve: d => {
                clearTimeout(timer);
                resolve(d);
            }
        });
    });
}

async function open(uri: string, text: string): Promise<void> {
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: 'minab', version: 1, text }
    });
}

const codes = (d: Diagnostic[]) => d.map(x => x.code);

async function completionLabels(uri: string, line: number, character: number): Promise<string[]> {
    const result = await connection.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line, character } });
    const items: CompletionItem[] = Array.isArray(result) ? result : (result?.items ?? []);
    return items.map(i => i.label);
}

beforeAll(async () => {
    expect(existsSync(SERVER), 'run `npm run build` first').toBe(true);
    root = mkdtempSync(join(tmpdir(), 'minab-lsp-'));
    writeConfig('a', customerConfig);
    writeConfig('b', orderConfig);
    mkdirSync(join(root, 'none'), { recursive: true });

    // The working directory is a third folder: the old server read only the config found from there.
    server = spawn(process.execPath, [SERVER, '--stdio'], { cwd: join(root, 'none'), stdio: ['pipe', 'pipe', 'inherit'] });
    connection = createMessageConnection(new StreamMessageReader(server.stdout!), new StreamMessageWriter(server.stdin!));
    connection.onNotification(PublishDiagnosticsNotification.type, params => {
        diagnostics.set(params.uri, params.diagnostics);
        for (const w of [...waiting]) {
            if (w.uri === params.uri && w.predicate(params.diagnostics)) {
                waiting.splice(waiting.indexOf(w), 1);
                w.resolve(params.diagnostics);
            }
        }
    });
    connection.onRequest(RegistrationRequest.type, params => {
        registrations.push(...params.registrations);
        registered();
    });
    connection.listen();
    await connection.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri: pathToFileURL(root).toString(),
        capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
        workspaceFolders: null
    });
    await connection.sendNotification(InitializedNotification.type, {});
}, 30_000);

afterAll(async () => {
    try {
        await connection.sendRequest(ShutdownRequest.type);
        await connection.sendNotification(ExitNotification.type);
        await new Promise<void>(resolve => (server.exitCode !== null ? resolve() : server.once('exit', () => resolve())));
    } finally {
        connection.dispose();
        server.kill();
        rmSync(root, { recursive: true, force: true });
    }
}, 30_000);

describe('the language server over stdio (E2)', () => {
    const PROGRAM = 'EXISTS(#Customer[.id == 1])';

    test('asks the client to watch minab.config.json', async () => {
        await registeredWatch;
        const watching = registrations.find(r => (r as { method: string }).method === DidChangeWatchedFilesNotification.method) as {
            registerOptions: { watchers: Array<{ globPattern: string }> };
        };
        expect(watching.registerOptions.watchers.map(w => w.globPattern)).toEqual(['**/minab.config.json']);
    });

    test('checks two documents against two different schemas', async () => {
        const a = uriOf('a', 'one.minab');
        const b = uriOf('b', 'two.minab');
        const forA = nextDiagnostics(a);
        const forB = nextDiagnostics(b);
        await open(a, PROGRAM);
        await open(b, PROGRAM);
        // Folder `a` has Customer. Folder `b` has only Order.
        expect(codes(await forA)).toEqual([]);
        const unknown = await forB;
        expect(codes(unknown)).toContain('scope.unknownAlias');
        expect(unknown[0].range.start.line).toBe(0);
    });

    test('a document with no config uses an empty schema', async () => {
        const c = uriOf('none', 'three.minab');
        const result = nextDiagnostics(c);
        await open(c, PROGRAM);
        expect(codes(await result)).toContain('scope.unknownAlias');
    });

    test('completion after a dot offers the columns of the right schema', async () => {
        // The user has just typed the dot (column 17).
        const a = uriOf('a', 'dot.minab');
        const b = uriOf('b', 'dot.minab');
        await open(a, 'EXISTS(#Customer[.');
        await open(b, 'EXISTS(#Customer[.');
        const inA = await completionLabels(a, 0, 18);
        expect(inA).toContain('id');
        expect(inA).toContain('name');
        expect(inA).not.toContain('total');
        // Folder `b` has no Customer table, so no columns of it are offered.
        expect(await completionLabels(b, 0, 18)).not.toContain('name');
        // And in `b` a `#Order` offers the columns of Order, not those of Customer.
        const c = uriOf('b', 'order.minab');
        await open(c, 'EXISTS(#Order[.');
        const inB = await completionLabels(c, 0, 15);
        expect(inB).toContain('total');
        expect(inB).not.toContain('name');
    });

    test('completion items replace the partial word', async () => {
        const uri = uriOf('a', 'typing.minab');
        await open(uri, 'EXISTS(#Customer[.na');
        const result = await connection.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line: 0, character: 20 } });
        const items = Array.isArray(result) ? result : (result?.items ?? []);
        const name = items.find(i => i.label === 'name');
        expect(name).toBeDefined();
        expect(name!.textEdit).toMatchObject({ range: { start: { line: 0, character: 18 }, end: { line: 0, character: 20 } }, newText: 'name' });
    });

    test('hover shows the column type', async () => {
        const uri = uriOf('a', 'one.minab');
        // The cursor is on `id` in `.id`.
        const hover = await connection.sendRequest(HoverRequest.type, { textDocument: { uri }, position: { line: 0, character: 18 } });
        const value = (hover?.contents as { value: string }).value;
        expect(value).toContain('INTEGER');
    });

    test('signature help names the active parameter', async () => {
        const uri = uriOf('a', 'call.minab');
        await open(uri, 'ROUND(1.5, ');
        const help = await connection.sendRequest(SignatureHelpRequest.type, { textDocument: { uri }, position: { line: 0, character: 11 } });
        expect(help?.signatures[0].label).toContain('ROUND');
        expect(help?.activeParameter).toBe(1);
    });

    test('a changed config updates the diagnostics of its documents', async () => {
        const b = uriOf('b', 'two.minab');
        expect(codes(diagnostics.get(b) ?? [])).toContain('scope.unknownAlias');
        const updated = nextDiagnostics(b, d => d.length === 0);
        const path = writeConfig('b', { schema: { tables: [...orderConfig.schema.tables, ...customerConfig.schema.tables] } });
        await connection.sendNotification(DidChangeWatchedFilesNotification.type, { changes: [{ uri: pathToFileURL(path).toString(), type: 2 }] });
        expect(codes(await updated)).toEqual([]);
        // The other folder is not changed.
        expect(codes(diagnostics.get(uriOf('a', 'one.minab')) ?? [])).toEqual([]);
    });

    test('a document moved to another folder uses the new config when it is opened again', async () => {
        // `none/three.minab` had no config. The same program under `a` has one.
        const from = uriOf('none', 'three.minab');
        const cleared = nextDiagnostics(from, d => d.length === 0);
        await connection.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri: from } });
        await cleared;
        const moved = uriOf('a', 'three.minab');
        const result = nextDiagnostics(moved);
        await open(moved, PROGRAM);
        expect(codes(await result)).toEqual([]);
    });
});
