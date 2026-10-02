/**
 * Q2 — the release scripts (`scripts/changelog.mjs`, `bump-version.mjs`,
 * `next-version.mjs`), run on temporary folders. They never touch the real
 * CHANGELOG or the real versions.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bumpVersion } from '../scripts/bump-version.mjs';
import { extractNotes, main as changelog, parseFragment } from '../scripts/changelog.mjs';
import { main as nextVersionMain, nextVersion } from '../scripts/next-version.mjs';

const ROOT_CHANGELOG = `# Changelog

Intro text.

## [0.1.0] - 2026-01-01

### Added

- Old thing.

[0.1.0]: https://github.com/shams-app/minab/releases/tag/v0.1.0
`;

const EXTENSION_CHANGELOG = `# Changelog

## 0.1.0

Old extension text.

[0.1.0]: https://github.com/shams-app/minab/releases/tag/v0.1.0
`;

const fragment = (type: string, scope: string, text: string, breaking = false) => `---\ntype: ${type}\nscope: ${scope}\nbreaking: ${breaking}\n---\n${text}\n`;

let dir: string;

const write = (path: string, content: string) => {
    mkdirSync(resolve(dir, path, '..'), { recursive: true });
    writeFileSync(resolve(dir, path), content);
};
const read = (path: string) => readFileSync(resolve(dir, path), 'utf8');

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'minab-release-'));
    write('CHANGELOG.md', ROOT_CHANGELOG);
    write('vscode-extension/CHANGELOG.md', EXTENSION_CHANGELOG);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
});

describe('changelog.mjs --version', () => {
    beforeEach(() => {
        write('changes/README.md', 'Not a fragment.\n');
        write('changes/A1.md', fragment('added', 'cli', 'A new `--flag` for `minab run`.'));
        write('changes/A2.md', fragment('fixed', 'language', 'Fixes a wrong answer.'));
        write('changes/A3.md', fragment('changed', 'runtime', 'The runtime takes a new option.', true));
        write('changes/A4.md', fragment('added', 'playground', 'A new example in the gallery.'));
    });

    test('writes the section in Keep a Changelog order, with the Playground heading and the Breaking prefix', () => {
        expect(changelog(['--root', dir, '--version', '0.2.1', '--date', '2026-10-05'])).toBe(0);
        const text = read('CHANGELOG.md');
        const section = text.slice(text.indexOf('## [0.2.1]'), text.indexOf('## [0.1.0]'));
        expect(section).toBe(
            [
                '## [0.2.1] - 2026-10-05',
                '',
                '### Added',
                '',
                '- A new `--flag` for `minab run`.',
                '',
                '### Changed',
                '',
                '- **Breaking:** The runtime takes a new option.',
                '',
                '### Fixed',
                '',
                '- Fixes a wrong answer.',
                '',
                '### Playground',
                '',
                '- A new example in the gallery.',
                '',
                ''
            ].join('\n')
        );
        // The old section stays, and the new link comes before the old one.
        expect(text).toContain('## [0.1.0] - 2026-01-01');
        expect(text.indexOf('[0.2.1]: https://github.com/shams-app/minab/releases/tag/v0.2.1')).toBeLessThan(text.indexOf('[0.1.0]: https://'));
    });

    test('deletes the fragments it used and keeps changes/README.md', () => {
        changelog(['--root', dir, '--version', '0.2.1', '--date', '2026-10-05']);
        expect(readdirSync(resolve(dir, 'changes'))).toEqual(['README.md']);
    });

    test('the extension changelog gets only language, editor and vscode', () => {
        write('changes/A5.md', fragment('added', 'editor', 'Hover shows the type.'));
        changelog(['--root', dir, '--version', '0.2.1', '--date', '2026-10-05']);
        const text = read('vscode-extension/CHANGELOG.md');
        const section = text.slice(text.indexOf('## 0.2.1'), text.indexOf('## 0.1.0'));
        expect(section).toBe('## 0.2.1\n\n- Hover shows the type.\n- Fixes a wrong answer.\n\n');
        expect(text).not.toContain('--flag');
        expect(text).not.toContain('Breaking');
    });

    test('the extension changelog still gets a section when no fragment is for it', () => {
        rmSync(resolve(dir, 'changes/A2.md'));
        changelog(['--root', dir, '--version', '0.2.1', '--date', '2026-10-05']);
        expect(read('vscode-extension/CHANGELOG.md')).toContain('## 0.2.1\n\nNo change for the extension in this release.');
    });

    test('a bad fragment or a repeated version writes nothing', () => {
        write('changes/A6.md', '---\nscope: cli\n---\nNo type.\n');
        expect(changelog(['--root', dir, '--version', '0.2.1'])).toBe(1);
        expect(read('CHANGELOG.md')).toBe(ROOT_CHANGELOG);
        rmSync(resolve(dir, 'changes/A6.md'));
        expect(changelog(['--root', dir, '--version', '0.1.0'])).toBe(1);
        expect(read('CHANGELOG.md')).toBe(ROOT_CHANGELOG);
        expect(readdirSync(resolve(dir, 'changes'))).toHaveLength(5);
    });
});

describe('changelog.mjs --check', () => {
    test('passes when every fragment is valid', () => {
        write('changes/A1.md', fragment('added', 'cli', 'Fine.'));
        expect(changelog(['--root', dir, '--check'])).toBe(0);
    });

    test('fails on a fragment with no type', () => {
        write('changes/A1.md', '---\nscope: cli\nbreaking: false\n---\nNo type.\n');
        expect(changelog(['--root', dir, '--check'])).toBe(1);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('changes/A1.md: "type" is missing'));
    });

    test('fails on an unknown scope, an unknown type and a missing front matter', () => {
        write('changes/A1.md', fragment('added', 'kitchen', 'Bad scope.'));
        write('changes/A2.md', fragment('improved', 'cli', 'Bad type.'));
        write('changes/A3.md', 'Just text.\n');
        expect(changelog(['--root', dir, '--check'])).toBe(1);
        const messages = vi.mocked(console.error).mock.calls.map(call => String(call[0]));
        expect(messages).toEqual([
            expect.stringContaining('unknown scope "kitchen"'),
            expect.stringContaining('unknown type "improved"'),
            expect.stringContaining('front matter is missing')
        ]);
    });

    test('accepts the real fragments of this repository', () => {
        expect(changelog(['--check'])).toBe(0);
    });
});

describe('changelog.mjs --notes', () => {
    test('prints one section, without the link line', () => {
        write('changes/A1.md', fragment('added', 'cli', 'A thing.'));
        changelog(['--root', dir, '--version', '0.2.1', '--date', '2026-10-05']);
        expect(changelog(['--root', dir, '--notes', '0.2.1'])).toBe(0);
        expect(console.log).toHaveBeenLastCalledWith('### Added\n\n- A thing.');
        expect(extractNotes(read('CHANGELOG.md'), '0.1.0')).toBe('### Added\n\n- Old thing.');
    });

    test('fails for a version that is not in the changelog', () => {
        expect(changelog(['--root', dir, '--notes', '9.9.9'])).toBe(1);
    });
});

test('parseFragment joins a text that has several lines', () => {
    expect(parseFragment('---\ntype: fixed\nscope: cli\n---\nLine one\nline two.\n', 'x.md').text).toBe('Line one line two.');
});

describe('next-version.mjs', () => {
    test('0.2.0 not published, run 7 gives 0.2.0-next.7', () => {
        expect(nextVersion('0.2.0', false, 7)).toBe('0.2.0-next.7');
    });

    test('0.2.0 published, run 7 gives 0.3.0-next.7', () => {
        expect(nextVersion('0.2.0', true, 7)).toBe('0.3.0-next.7');
    });

    test('reads package.json and asks npm (mocked) about that version', () => {
        write('package.json', JSON.stringify({ name: '@shamsine/minab', version: '1.4.2' }));
        const lookup = vi.fn(() => true);
        expect(nextVersionMain(['--root', dir, '--run', '42'], lookup)).toBe('1.5.0-next.42');
        expect(lookup).toHaveBeenCalledWith('@shamsine/minab', '1.4.2');
        expect(nextVersionMain(['--root', dir, '--run', '42'], () => false)).toBe('1.4.2-next.42');
    });

    test('needs a run number', () => {
        write('package.json', JSON.stringify({ name: 'x', version: '0.2.0' }));
        vi.stubEnv('GITHUB_RUN_NUMBER', '');
        expect(() => nextVersionMain(['--root', dir], () => false)).toThrow('run number');
    });
});

describe('bump-version.mjs', () => {
    test('changes both package files and their lockfiles, and the release metadata stays consistent', () => {
        for (const sub of ['', 'vscode-extension/']) {
            const name = sub ? 'minab-vscode' : '@shamsine/minab';
            write(`${sub}package.json`, JSON.stringify({ name, version: '0.1.0' }, null, 2));
            write(
                `${sub}package-lock.json`,
                JSON.stringify({ name, version: '0.1.0', lockfileVersion: 3, requires: true, packages: { '': { name, version: '0.1.0' } } }, null, 2)
            );
        }
        write('changes/A1.md', fragment('added', 'cli', 'A thing.'));
        changelog(['--root', dir, '--version', '0.2.1', '--date', '2026-10-05']);
        bumpVersion(dir, '0.2.1');

        const json = (path: string) => JSON.parse(read(path)) as { version: string; packages?: Record<string, { version: string }> };
        for (const sub of ['', 'vscode-extension/']) {
            expect(json(`${sub}package.json`).version).toBe('0.2.1');
            expect(json(`${sub}package-lock.json`).version).toBe('0.2.1');
            expect(json(`${sub}package-lock.json`).packages?.['']?.version).toBe('0.2.1');
        }
        // The same three rules as test/release.test.ts.
        expect(json('vscode-extension/package.json').version).toBe(json('package.json').version);
        for (const path of ['CHANGELOG.md', 'vscode-extension/CHANGELOG.md']) {
            const headings = [...read(path).matchAll(/^## \[?(\d+\.\d+\.\d+)\]?/gm)];
            expect(headings[0]?.[1], path).toBe('0.2.1');
        }
    });

    test('refuses a value that is not a version', () => {
        expect(() => bumpVersion(dir, 'latest', () => {})).toThrow('not a version');
        expect(() => bumpVersion(dir, '1.0.0; rm -rf /', () => {})).toThrow('not a version');
    });
});
