import { describe, expect, test } from 'vitest';
import { cheatsheet } from '../src/content/reference/cheatsheet.js';
import { examples, exampleById, featuredExampleIds } from '../src/content/examples/index.js';
import { landing } from '../src/content/landing.js';
import { decodeShare, encodeShare, shareFromHash, shareUrl } from '../src/state/share.js';
import { cliConfig, hostSettings, workspaceFromExample } from '../src/state/workspace.js';

describe('share links', () => {
    const workspace = workspaceFromExample(exampleById('booking-overlap')!);

    test('round-trip a workspace', () => {
        const decoded = decodeShare(encodeShare(workspace));
        expect(decoded).toEqual({ ok: true, workspace });
    });

    test('stay short: the dataset travels by name, not by rows', () => {
        expect(encodeShare(workspace).length).toBeLessThan(1200);
    });

    test('a damaged link explains itself', () => {
        expect(decodeShare('not-a-link')).toMatchObject({ ok: false });
        expect(decodeShare(encodeShare(workspace).slice(0, 40))).toMatchObject({ ok: false });
    });

    test('are read from the fragment and built against the base path', () => {
        const url = shareUrl(workspace, '/play', 'https://example.dev', '/minab/');
        expect(url.startsWith('https://example.dev/minab/play#s=')).toBe(true);
        expect(shareFromHash(new URL(url).hash)).toBe(encodeShare(workspace));
    });
});

describe('workspaces', () => {
    test('the engine config includes the dataset’s schema and rows', () => {
        const { config } = hostSettings(workspaceFromExample(exampleById('first-query')!).host);
        expect((config.schema as { tables: unknown[] }).tables.length).toBeGreaterThan(5);
        expect(Object.keys(config.seed as object)).toContain('Order');
    });

    test('the CLI export drops playground-only keys', () => {
        const config = cliConfig(workspaceFromExample(exampleById('customer-exists')!).host);
        expect(config).not.toHaveProperty('seed');
        expect(config).toMatchObject({ rule: { recordTable: 'Order', fieldType: 'UUID' }, fieldValue: 'cus-ada' });
    });
});

describe('content references', () => {
    test('every example a page points at exists', () => {
        const referenced = [
            ...featuredExampleIds,
            ...landing.demo.map(d => d.exampleId),
            landing.layers.query.exampleId,
            landing.layers.rule.exampleId,
            landing.comparison.exampleId,
            ...cheatsheet.flatMap(s => s.entries.map(e => e.exampleId).filter((id): id is string => !!id))
        ];
        expect(referenced.filter(id => !examples.some(e => e.id === id))).toEqual([]);
    });

    test('cheat-sheet keywords are unique', () => {
        const keywords = cheatsheet.flatMap(s => s.entries.flatMap(e => e.keywords ?? []));
        expect(keywords.filter((k, i) => keywords.indexOf(k) !== i)).toEqual([]);
    });
});
