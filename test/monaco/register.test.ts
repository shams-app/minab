/**
 * Production plan phase E5 — `registerMinab` with a fake `monaco` and a fake client (no browser, no worker).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerMinab, type MinabEditorClient, type MinabRegistration } from '../../src/monaco/index.js';
import { fakeModel, fakeMonaco } from './fake-monaco.js';

const range = (line: number, from: number, to: number) => ({ start: { line, character: from }, end: { line, character: to } });

function fakeClient(overrides: Partial<MinabEditorClient> = {}) {
    const released = vi.fn();
    const prepare = vi.fn(async (source: string) => ({
        diagnostics: source.includes('bad')
            ? [
                  { severity: 'error' as const, code: 'type.unknownName', message: 'Unknown name "bad".', range: range(0, 4, 7), params: {} },
                  { severity: 'warning' as const, code: 'style.example', message: 'A warning.', range: range(1, 0, 2), params: {} }
              ]
            : [],
        release: released
    }));
    const client: MinabEditorClient = {
        prepare,
        complete: vi.fn(async () => ({
            replace: range(0, 5, 7),
            items: [
                { label: 'total', kind: 'column' as const, detail: 'DECIMAL', documentation: 'The total.', rank: 1 },
                { label: 'ROUND', kind: 'builtin' as const, insertText: 'ROUND(${1:n})', rank: 12 },
                { label: 'limit', kind: 'input' as const, rank: 2 }
            ]
        })),
        hover: vi.fn(async () => ({ contents: '**total**: DECIMAL', range: range(0, 1, 6) })),
        signatureHelp: vi.fn(async () => ({
            label: 'ROUND(n: N, digits?: INTEGER) → N',
            documentation: 'Rounds.',
            parameters: ['n: N', 'digits?: INTEGER'],
            activeParameter: 1
        })),
        ...overrides
    };
    return { client, prepare, released };
}

let registration: MinabRegistration | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    registration?.dispose();
    registration = undefined;
    vi.useRealTimers();
});

describe('registerMinab: the language', () => {
    test('registers the language id once, with its tokens and configuration', () => {
        const fake = fakeMonaco();
        const { client } = fakeClient();
        registration = registerMinab(fake.monaco, { client });
        expect(fake.registered.map(l => l.id)).toEqual(['minab']);
        expect(fake.config.minab).toMatchObject({ comments: { lineComment: '//' } });
        expect(fake.tokens.tokenize('FROM Order', fake.tokens.getInitialState()).tokens[0]).toEqual({ startIndex: 0, scopes: 'keyword.pipeline' });
        // A second host call with the same id does not register it twice.
        registerMinab(fake.monaco, { client }).dispose();
        expect(fake.registered).toHaveLength(1);
    });

    test('a custom language id is used', () => {
        const fake = fakeMonaco();
        registration = registerMinab(fake.monaco, { client: fakeClient().client, languageId: 'minab-rule' });
        expect(fake.registered.map(l => l.id)).toEqual(['minab-rule']);
        expect(fake.config['minab-rule']).toBeDefined();
    });
});

describe('registerMinab: markers', () => {
    test('a model gets markers with the code, the message, the severity and a 1-based range', async () => {
        const fake = fakeMonaco();
        const { client, released } = fakeClient();
        registration = registerMinab(fake.monaco, { client });
        const model = fakeModel('FROM bad\nxx');
        fake.addModel(model);
        await vi.advanceTimersByTimeAsync(0);
        expect(fake.markers.get('minab:inmemory://a')).toEqual([
            {
                startLineNumber: 1,
                startColumn: 5,
                endLineNumber: 1,
                endColumn: 8,
                severity: 8,
                code: 'type.unknownName',
                message: 'Unknown name "bad".',
                source: 'minab'
            },
            { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 3, severity: 4, code: 'style.example', message: 'A warning.', source: 'minab' }
        ]);
        expect(released).toHaveBeenCalledTimes(1);
    });

    test('an edit waits 150 ms, and a burst of edits makes one check', async () => {
        const fake = fakeMonaco();
        const { client, prepare } = fakeClient();
        registration = registerMinab(fake.monaco, { client });
        const model = fakeModel('1');
        fake.addModel(model);
        await vi.advanceTimersByTimeAsync(0);
        prepare.mockClear();

        model.edit('1 +');
        await vi.advanceTimersByTimeAsync(100);
        model.edit('1 + bad');
        await vi.advanceTimersByTimeAsync(149);
        expect(prepare).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(prepare).toHaveBeenCalledWith('1 + bad', undefined);
        expect(fake.markers.get('minab:inmemory://a')).toHaveLength(2);
    });

    test('fixing the text clears the markers', async () => {
        const fake = fakeMonaco();
        registration = registerMinab(fake.monaco, { client: fakeClient().client });
        const model = fakeModel('bad');
        fake.addModel(model);
        await vi.advanceTimersByTimeAsync(0);
        expect(fake.markers.get('minab:inmemory://a')).toHaveLength(2);
        model.edit('good');
        await vi.advanceTimersByTimeAsync(150);
        expect(fake.markers.get('minab:inmemory://a')).toEqual([]);
    });

    test('an old answer does not overwrite the markers of newer text', async () => {
        const fake = fakeMonaco();
        let finishFirst!: () => void;
        let calls = 0;
        const { client } = fakeClient({
            prepare: async source => {
                if (calls++ === 0) await new Promise<void>(resolve => (finishFirst = resolve));
                return { diagnostics: source === 'old' ? [{ severity: 'error', code: 'x', message: 'old', range: range(0, 0, 1), params: {} }] : [] };
            }
        });
        registration = registerMinab(fake.monaco, { client });
        const model = fakeModel('old');
        fake.addModel(model); // the first check waits
        model.edit('new');
        await vi.advanceTimersByTimeAsync(150); // the second check answers at once
        finishFirst();
        await vi.advanceTimersByTimeAsync(0);
        expect(fake.markers.get('minab:inmemory://a')).toEqual([]);
    });

    test('a model of another language is left alone, and a removed model stops its checks', async () => {
        const fake = fakeMonaco();
        const { client, prepare } = fakeClient();
        registration = registerMinab(fake.monaco, { client });
        fake.addModel(fakeModel('bad', 'other', 'typescript'));
        const model = fakeModel('1', 'mine');
        fake.addModel(model);
        await vi.advanceTimersByTimeAsync(0);
        expect(prepare).toHaveBeenCalledTimes(1);
        model.edit('2'); // a check is scheduled ...
        fake.removeModel(model); // ... and the model goes away first
        await vi.advanceTimersByTimeAsync(500);
        expect(prepare).toHaveBeenCalledTimes(1);
    });

    test('a worker failure goes to onError and leaves the markers as they were', async () => {
        const fake = fakeMonaco();
        const onError = vi.fn();
        const { client } = fakeClient({ prepare: async () => Promise.reject(new Error('the worker stopped')) });
        registration = registerMinab(fake.monaco, { client, onError });
        fake.addModel(fakeModel('x'));
        await vi.advanceTimersByTimeAsync(0);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'the worker stopped' }));
        expect(fake.markerCalls).toEqual([]);
    });

    test('dispose clears markers, stops timers and removes the providers', async () => {
        const fake = fakeMonaco();
        const { client, prepare } = fakeClient();
        registration = registerMinab(fake.monaco, { client });
        const model = fakeModel('bad');
        fake.addModel(model);
        await vi.advanceTimersByTimeAsync(0);
        model.edit('bad 2');
        registration.dispose();
        expect(fake.markers.get('minab:inmemory://a')).toEqual([]);
        expect([...fake.live]).toEqual([]);
        prepare.mockClear();
        await vi.advanceTimersByTimeAsync(500);
        expect(prepare).not.toHaveBeenCalled();
        registration.dispose(); // twice is fine
    });
});

describe('registerMinab: providers', () => {
    test('completion maps kinds, ranges, sort order and snippets', async () => {
        const fake = fakeMonaco();
        const { client } = fakeClient();
        registration = registerMinab(fake.monaco, { client, ruleContext: { recordTable: 'Order', isFieldRule: false } });
        const model = fakeModel('.to\nx');
        const result = (await fake.providers.completion.provideCompletionItems(model as never, { lineNumber: 1, column: 4 } as never)) as {
            suggestions: Record<string, unknown>[];
        };
        expect(client.complete).toHaveBeenCalledWith('.to\nx', 3, { ruleContext: { recordTable: 'Order', isFieldRule: false } });
        const [total, round, limit] = result.suggestions;
        expect(total).toMatchObject({
            label: 'total',
            kind: 3,
            detail: 'DECIMAL',
            documentation: { value: 'The total.' },
            insertText: 'total',
            sortText: '001total',
            range: { startLineNumber: 1, startColumn: 6, endLineNumber: 1, endColumn: 8 }
        });
        expect(total.insertTextRules).toBeUndefined();
        expect(round).toMatchObject({ kind: 0, insertText: 'ROUND(${1:n})', insertTextRules: 4, sortText: '012ROUND' });
        expect(limit).toMatchObject({ kind: 4 });
    });

    test('hover gives Markdown and a range, and a keyword-only hover needs keywordDocs', async () => {
        const fake = fakeMonaco();
        const { client } = fakeClient();
        registration = registerMinab(fake.monaco, { client });
        const model = fakeModel('.total');
        const hover = (await fake.providers.hover.provideHover(model as never, { lineNumber: 1, column: 3 } as never)) as {
            contents: { value: string }[];
            range: unknown;
        };
        expect(hover.contents).toEqual([{ value: '**total**: DECIMAL' }]);
        expect(hover.range).toEqual({ startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 7 });

        registration.dispose();
        const keyword = fakeClient({ hover: async () => ({ contents: '', keyword: 'FROM' }) });
        const plain = fakeMonaco();
        registration = registerMinab(plain.monaco, { client: keyword.client });
        expect(await plain.providers.hover.provideHover(model as never, { lineNumber: 1, column: 1 } as never)).toBeUndefined();
        registration.dispose();
        const documented = fakeMonaco();
        registration = registerMinab(documented.monaco, { client: keyword.client, keywordDocs: word => `docs of ${word}` });
        expect(await documented.providers.hover.provideHover(model as never, { lineNumber: 1, column: 1 } as never)).toMatchObject({
            contents: [{ value: 'docs of FROM' }]
        });
    });

    test('signature help gives the label, the parameters and the active one', async () => {
        const fake = fakeMonaco();
        registration = registerMinab(fake.monaco, { client: fakeClient().client });
        const help = (await fake.providers.signature.provideSignatureHelp(fakeModel('ROUND(1, ') as never, { lineNumber: 1, column: 10 } as never)) as {
            value: { signatures: unknown[]; activeSignature: number; activeParameter: number };
        };
        expect(help.value).toEqual({
            signatures: [
                {
                    label: 'ROUND(n: N, digits?: INTEGER) → N',
                    documentation: { value: 'Rounds.' },
                    parameters: [{ label: 'n: N' }, { label: 'digits?: INTEGER' }]
                }
            ],
            activeSignature: 0,
            activeParameter: 1
        });
    });

    test('providers answer nothing when there is nothing, or when the worker fails', async () => {
        const fake = fakeMonaco();
        const onError = vi.fn();
        const { client } = fakeClient({
            hover: async () => undefined,
            signatureHelp: async () => undefined,
            complete: async () => Promise.reject(new Error('boom'))
        });
        registration = registerMinab(fake.monaco, { client, onError });
        const model = fakeModel('x');
        const at = { lineNumber: 1, column: 1 } as never;
        expect(await fake.providers.hover.provideHover(model as never, at)).toBeUndefined();
        expect(await fake.providers.signature.provideSignatureHelp(model as never, at)).toBeUndefined();
        expect(await fake.providers.completion.provideCompletionItems(model as never, at)).toEqual({ suggestions: [] });
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
