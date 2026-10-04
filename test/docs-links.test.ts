import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * G1: every relative link in `docs/**` and in the root README must point to a
 * file or folder that exists. Anchors (`#name`) are not checked, only the path.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function markdownFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return markdownFiles(path);
        return name.endsWith('.md') ? [path] : [];
    });
}

/** The text of a Markdown file without fenced code blocks and inline code: links in code are examples, not links. */
export function stripCode(text: string): string {
    return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** The relative targets of the Markdown links `[text](target)` and the reference definitions `[id]: target`. */
export function relativeTargets(text: string): string[] {
    const body = stripCode(text);
    const targets = [...body.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(m => m[1]);
    targets.push(...[...body.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/gm)].map(m => m[1]));
    return targets
        .filter(target => !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target))
        .map(target => decodeURIComponent(target.split('#')[0].split('?')[0]))
        .filter(target => target !== '');
}

/** The links of `file` that point to nothing, as `path -> target`. */
export function brokenLinks(file: string, text = readFileSync(file, 'utf8')): string[] {
    return relativeTargets(text)
        .filter(target => !existsSync(resolve(dirname(file), target)))
        .map(target => `${relative(ROOT, file)} -> ${target}`);
}

describe('documentation links', () => {
    const files = [join(ROOT, 'README.md'), ...markdownFiles(join(ROOT, 'docs'))];

    test('the check covers the root README and the docs folder', () => {
        expect(files.length).toBeGreaterThan(20);
        expect(files.map(file => relative(ROOT, file))).toContain('docs/README.md');
    });

    test('every relative link points to a file that exists', () => {
        expect(files.flatMap(file => brokenLinks(file))).toEqual([]);
    });

    test('a broken link is found', () => {
        const file = join(ROOT, 'docs', 'example.md');
        expect(brokenLinks(file, 'See [the guide](guides/missing.md) and [the spec](query-language-spec.md#top).')).toEqual([
            'docs/example.md -> guides/missing.md'
        ]);
    });

    test('links in code, web links and anchors are not checked', () => {
        const file = join(ROOT, 'docs', 'example.md');
        const text = ['`[x](nowhere.md)`', '```md', '[y](nowhere.md)', '```', '[web](https://example.com/a.md)', '[mail](mailto:a@b.c)', '[top](#top)'].join(
            '\n'
        );
        expect(brokenLinks(file, text)).toEqual([]);
    });
});
