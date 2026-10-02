import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Drift guard (phase L1): a user function is called `name(...)`. The old
 * `&name(...)` form must not come back in a program, a code block in the
 * spec or showcase, or the playground content.
 *
 * History is allowed to mention it: `docs/roadmap.md`, `docs/status.md`,
 * `docs/release-future/`, `docs/production/` (none of them is scanned), and
 * spec §12 item 10, which tells the history in plain text. Only fenced code
 * blocks of the spec and the showcase are scanned, so that text is allowed
 * and the rest of the spec is not skipped.
 */

const ROOT = join(import.meta.dirname, '..');
const AMPERSAND_CALL = /&[A-Za-z_][A-Za-z_0-9]*\(/;

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'generated']);

function walk(dir: string, accept: (path: string) => boolean, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, accept, found);
        else if (accept(path)) found.push(path);
    }
    return found;
}

function offences(text: string): string[] {
    return text.split('\n').filter(line => AMPERSAND_CALL.test(line));
}

/** The lines inside ``` fences. */
function fencedLines(markdown: string): string[] {
    const lines: string[] = [];
    let inFence = false;
    for (const line of markdown.split('\n')) {
        if (line.trimStart().startsWith('```')) {
            inFence = !inFence;
            continue;
        }
        if (inFence) lines.push(line);
    }
    return lines;
}

describe('no `&name(...)` calls', () => {
    test('the detector sees an old call and ignores `&&`', () => {
        expect(offences('&x(1)')).toHaveLength(1);
        expect(offences('a && b(1)')).toHaveLength(0);
        expect(offences('x(1)')).toHaveLength(0);
    });

    test('no .minab file has one', () => {
        const files = walk(ROOT, p => p.endsWith('.minab') && !relative(ROOT, p).startsWith(join('docs', 'release-future')));
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            expect(offences(readFileSync(file, 'utf8')), relative(ROOT, file)).toEqual([]);
        }
    });

    test.each(['docs/query-language-spec.md', 'docs/showcase.md'])('no code block in %s has one', doc => {
        expect(offences(fencedLines(readFileSync(join(ROOT, doc), 'utf8')).join('\n')), doc).toEqual([]);
    });

    test('nothing under playground/src/content has one', () => {
        const files = walk(join(ROOT, 'playground/src/content'), () => true);
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            expect(offences(readFileSync(file, 'utf8')), relative(ROOT, file)).toEqual([]);
        }
    });
});
