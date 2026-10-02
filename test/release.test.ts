/**
 * Roadmap Phase 9 — guards on what actually gets published. Nothing here
 * tests language behavior; it keeps the two version numbers, the
 * changelog, and the npm tarball's contents from drifting apart, which is
 * how a release goes out with tests inside it or without its own binary.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Record<string, any>;

describe('release metadata', () => {
    const rootPackage = readJson('package.json');
    const extensionPackage = readJson('vscode-extension/package.json');

    test('the npm package is publishable', () => {
        expect(rootPackage.private).not.toBe(true);
        expect(rootPackage.license).toBe('MIT');
        expect(existsSync(resolve(root, 'LICENSE'))).toBe(true);
        expect(rootPackage.publishConfig?.access).toBe('public');
    });

    test('the npm package and the VS Code extension share a version', () => {
        expect(extensionPackage.version).toBe(rootPackage.version);
    });

    test('the newest CHANGELOG entry is the current version', () => {
        for (const path of ['CHANGELOG.md', 'vscode-extension/CHANGELOG.md']) {
            const headings = [...readFileSync(resolve(root, path), 'utf8').matchAll(/^## \[?(\d+\.\d+\.\d+)\]?/gm)];
            expect(headings[0]?.[1], path).toBe(rootPackage.version);
        }
    });
});

// `--ignore-scripts` keeps `prepack` from rebuilding (and wiping) `out/`
// while the rest of the suite runs; the tarball is checked as built.
describe.skipIf(!existsSync(resolve(root, 'out/src/cli/bin.js')))('npm tarball contents', () => {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })) as Array<{
        files: Array<{ path: string }>;
    }>;
    const files = packed[0].files.map(f => f.path);

    test('includes the CLI, the language server, and the docs users read', () => {
        for (const expected of [
            'out/src/cli/bin.js',
            'out/src/language/main.js',
            'out/src/language/generated/grammar.js',
            'LICENSE',
            'README.md',
            'CHANGELOG.md',
            'docs/query-language-spec.md'
        ]) {
            expect(files, expected).toContain(expected);
        }
    });

    test('the bin target is in the tarball', () => {
        const bin = readJson('package.json').bin.minab.replace(/^\.\//, '');
        expect(files).toContain(bin);
    });

    test('leaves out tests, source maps, and the extension', () => {
        const stray = files.filter(f => f.startsWith('out/test/') || f.endsWith('.map') || f.startsWith('vscode-extension/'));
        expect(stray).toEqual([]);
    });

    test('leaves out the production plan', () => {
        const plan = files.filter(f => f.startsWith('docs/production/') || f.startsWith('docs/release-future/'));
        expect(plan).toEqual([]);
    });
});
