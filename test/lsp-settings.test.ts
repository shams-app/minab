/**
 * The `minab.configPath` setting and the config-used notification (production
 * plan E4), over stdio with the built server (`npm run build` first).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    DidChangeConfigurationNotification,
    DidOpenTextDocumentNotification,
    ExitNotification,
    InitializeRequest,
    InitializedNotification,
    PublishDiagnosticsNotification,
    ShutdownRequest,
    StreamMessageReader,
    StreamMessageWriter,
    createMessageConnection,
    type Diagnostic,
    type MessageConnection
} from 'vscode-languageserver-protocol/node';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { CONFIG_USED_NOTIFICATION, type ConfigUsedParams } from '../src/lsp/index.js';

const SERVER = join(process.cwd(), 'out', 'src', 'language', 'main.js');
const customerConfig = { schema: { tables: [{ name: 'Customer', primaryKey: 'id', columns: { id: 'INTEGER', name: 'TEXT' } }] } };
const orderConfig = { schema: { tables: [{ name: 'Order', primaryKey: 'id', columns: { id: 'INTEGER', total: 'DECIMAL' } }] } };

let root: string;
let server: ChildProcess;
let connection: MessageConnection;
const diagnostics = new Map<string, Diagnostic[]>();
const used = new Map<string, string | null>();
let tick = 0;

function write(path: string, config: unknown): string {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(config));
    return path;
}

async function until<T>(what: string, probe: () => T | undefined): Promise<T> {
    for (let i = 0; i < 300; i++) {
        const value = probe();
        if (value !== undefined) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`timed out: ${what}`);
}

async function start(initializationOptions: unknown): Promise<void> {
    server = spawn(process.execPath, [SERVER, '--stdio'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
    connection = createMessageConnection(new StreamMessageReader(server.stdout!), new StreamMessageWriter(server.stdin!));
    connection.onNotification(PublishDiagnosticsNotification.type, params => {
        diagnostics.set(params.uri, params.diagnostics);
    });
    connection.onNotification(CONFIG_USED_NOTIFICATION, (params: ConfigUsedParams) => {
        used.set(params.uri, params.configPath);
    });
    connection.listen();
    await connection.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri: pathToFileURL(root).toString(),
        capabilities: {},
        workspaceFolders: [{ uri: pathToFileURL(root).toString(), name: 'root' }],
        initializationOptions
    });
    await connection.sendNotification(InitializedNotification.type, {});
}

async function openFresh(folder: string, text: string): Promise<string> {
    const uri = pathToFileURL(join(root, folder, `file-${tick++}.minab`)).toString();
    await connection.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'minab', version: 1, text } });
    await until(`config used by ${uri}`, () => (used.has(uri) ? true : undefined));
    return uri;
}

beforeAll(() => {
    expect(existsSync(SERVER), 'run `npm run build` first').toBe(true);
    root = mkdtempSync(join(tmpdir(), 'minab-settings-'));
    write(join(root, 'a', 'minab.config.json'), customerConfig);
    write(join(root, 'configs', 'orders.json'), orderConfig);
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('without a configPath setting', () => {
    beforeAll(() => start({}), 30_000);
    afterAll(stop);

    test('the notification names the config found from the document', async () => {
        const uri = await openFresh('a', 'FROM Customer\nSELECT .name');
        expect(used.get(uri)).toBe(join(root, 'a', 'minab.config.json'));
    });

    test('a document with no config gets null', async () => {
        mkdirSync(join(root, 'none'), { recursive: true });
        const uri = await openFresh('none', '1 + 1');
        expect(used.get(uri)).toBeNull();
    });

    test('a changed setting is used at once, and an empty setting goes back to discovery', async () => {
        const uri = await openFresh('a', 'FROM Order\nSELECT .total');
        // The nearest config has no `Order` table, so there is an error.
        await until('an error for Order', () => (diagnostics.get(uri)?.length ? true : undefined));
        await connection.sendNotification(DidChangeConfigurationNotification.type, { settings: { minab: { configPath: 'configs/orders.json' } } });
        await until('no error with the override', () =>
            used.get(uri) === join(root, 'configs', 'orders.json') && diagnostics.get(uri)?.length === 0 ? true : undefined
        );
        await connection.sendNotification(DidChangeConfigurationNotification.type, { settings: { minab: { configPath: '' } } });
        await until('discovery again', () => (used.get(uri) === join(root, 'a', 'minab.config.json') && diagnostics.get(uri)?.length ? true : undefined));
    });
});

describe('with a configPath in the initialization options', () => {
    beforeAll(() => start({ configPath: join(root, 'configs', 'orders.json') }), 30_000);
    afterAll(stop);

    test('an absolute path is used for every document', async () => {
        const uri = await openFresh('a', 'FROM Order\nSELECT .total');
        expect(used.get(uri)).toBe(join(root, 'configs', 'orders.json'));
        expect(diagnostics.get(uri)).toEqual([]);
    });
});

async function stop(): Promise<void> {
    await connection.sendRequest(ShutdownRequest.type);
    await connection.sendNotification(ExitNotification.type);
    await new Promise<void>(resolve => (server.exitCode !== null ? resolve() : server.once('exit', () => resolve())));
    connection.dispose();
    server.kill();
    used.clear();
    diagnostics.clear();
}
