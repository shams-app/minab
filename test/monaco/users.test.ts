/**
 * MN.4 (security plan) — the callbacks of the host: `directoryNames()` for `@@` completion and hover, and `userLabels(ids)`
 * for a pinned `findUser('usr_…')` (inlay hint and hover). A fake `monaco` and a fake client, no browser and no worker.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PinnedUser } from '../../src/editor/index.js';
import { registerMinab, type MinabEditorClient, type MinabRegistration } from '../../src/monaco/index.js';
import { fakeModel, fakeMonaco } from './fake-monaco.js';

const SOURCE = ".owner == findUser('usr_5h2m')";
const PIN: PinnedUser = { id: 'usr_5h2m', range: { start: { line: 0, character: 10 }, end: { line: 0, character: SOURCE.length } } };

function fakeClient(overrides: Partial<MinabEditorClient> = {}) {
    const client: MinabEditorClient = {
        prepare: async () => ({ diagnostics: [] }),
        complete: vi.fn(async () => ({ replace: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } }, items: [] })),
        hover: vi.fn(async () => ({ contents: 'a hover' })),
        signatureHelp: vi.fn(async () => undefined),
        pinnedUsers: vi.fn(async () => [PIN]),
        ...overrides
    };
    return client;
}

let registration: MinabRegistration | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    registration?.dispose();
    registration = undefined;
    vi.useRealTimers();
});

describe('directoryNames()', () => {
    test('the names go to completion and hover as hints, and a failing callback leaves the editor working', async () => {
        const fake = fakeMonaco();
        const client = fakeClient();
        const groups = [{ name: 'Sales', title: 'Sales people', kind: 'static' }];
        const directoryNames = vi.fn(async () => groups);
        registration = registerMinab(fake.monaco, { client, directoryNames });
        const model = fakeModel('@@Sa');
        await fake.providers.completion.provideCompletionItems(model as never, { lineNumber: 1, column: 5 } as never);
        expect(client.complete).toHaveBeenCalledWith('@@Sa', 4, { hints: { groups } });
        await fake.providers.hover.provideHover(model as never, { lineNumber: 1, column: 3 } as never);
        expect(client.hover).toHaveBeenCalledWith('@@Sa', 2, { hints: { groups } });

        directoryNames.mockRejectedValueOnce(new Error('the host is down'));
        const onError = vi.fn();
        registration.dispose();
        registration = registerMinab(fake.monaco, { client, directoryNames, onError });
        await fake.providers.completion.provideCompletionItems(model as never, { lineNumber: 1, column: 5 } as never);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(client.complete).toHaveBeenLastCalledWith('@@Sa', 4, undefined);
    });

    test('@ also starts a completion', async () => {
        const fake = fakeMonaco();
        registration = registerMinab(fake.monaco, { client: fakeClient() });
        expect((fake.providers.completion as unknown as { triggerCharacters: string[] }).triggerCharacters).toContain('@');
    });
});

describe('userLabels(ids)', () => {
    test('one call for the ids of the program; the inlay hint is the name and the e-mail after the call', async () => {
        const fake = fakeMonaco();
        const client = fakeClient();
        const userLabels = vi.fn(async () => ({ usr_5h2m: { name: 'Sara Ahmadi', email: 'sara@example.com' } }));
        registration = registerMinab(fake.monaco, { client, userLabels });
        const model = fakeModel(SOURCE);
        const result = (await fake.providers.inlay.provideInlayHints(model as never, {} as never, {} as never)) as { hints: Record<string, unknown>[] };
        expect(userLabels).toHaveBeenCalledWith(['usr_5h2m']);
        expect(result.hints).toEqual([{ label: 'Sara Ahmadi · sara@example.com', position: { lineNumber: 1, column: SOURCE.length + 1 }, paddingLeft: true }]);

        // The hover of the same version uses the labels it already has.
        await fake.providers.hover.provideHover(model as never, { lineNumber: 1, column: 15 } as never);
        expect(client.hover).toHaveBeenCalledWith(SOURCE, 14, { hints: { userLabels: { usr_5h2m: { name: 'Sara Ahmadi', email: 'sara@example.com' } } } });
        expect(userLabels).toHaveBeenCalledTimes(1);
        expect(client.pinnedUsers).toHaveBeenCalledTimes(1);

        // A new version of the text asks again.
        model.edit(`${SOURCE} `);
        await fake.providers.inlay.provideInlayHints(model as never, {} as never, {} as never);
        expect(userLabels).toHaveBeenCalledTimes(2);
    });

    test('a person the host does not know has no hint; a program with no pinned person asks nobody', async () => {
        const fake = fakeMonaco();
        const userLabels = vi.fn(async () => ({}));
        registration = registerMinab(fake.monaco, { client: fakeClient(), userLabels });
        const result = (await fake.providers.inlay.provideInlayHints(fakeModel(SOURCE) as never, {} as never, {} as never)) as { hints: unknown[] };
        expect(result.hints).toEqual([]);

        const none = fakeClient({ pinnedUsers: vi.fn(async () => []) });
        registration.dispose();
        registration = registerMinab(fake.monaco, { client: none, userLabels });
        await fake.providers.inlay.provideInlayHints(fakeModel('1 + 1', 'b') as never, {} as never, {} as never);
        expect(userLabels).toHaveBeenCalledTimes(1);
    });

    test('no inlay provider without the callback, or without a client that can list the pinned people', () => {
        const without = fakeMonaco();
        registration = registerMinab(without.monaco, { client: fakeClient() });
        expect(without.live.has('inlay')).toBe(false);
        registration.dispose();
        const noClient = fakeMonaco();
        const client = fakeClient();
        delete client.pinnedUsers;
        registration = registerMinab(noClient.monaco, { client, userLabels: async () => ({}) });
        expect(noClient.live.has('inlay')).toBe(false);
    });
});
