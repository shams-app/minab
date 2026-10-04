import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * The design contract for `src/styles/tokens.css` (design/contract.md and
 * design/handoff.md): dark is the default on `:root`, light sits in two
 * blocks that must stay identical, and every syntax color passes AA
 * against the editor background in both themes.
 */

const css = readFileSync(resolve(import.meta.dirname, '../src/styles/tokens.css'), 'utf8');

/** The declarations of the first block that starts with `selector {`. */
function block(selector: string): Record<string, string> {
    const start = css.indexOf(`${selector} {`);
    expect(start, `block ${selector}`).toBeGreaterThanOrEqual(0);
    const end = css.indexOf('\n}', start);
    const body = css.slice(start + selector.length + 2, end);
    const out: Record<string, string> = {};
    for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[match[1]] = match[2].trim();
    return out;
}

const dark = block(':root');
const lightMedia = block(":root:not([data-theme='dark'])");
const lightManual = block(":root[data-theme='light']");

/** Tokens that do not change with the theme. */
const SHARED =
    /^--(font-|text-(xs|sm|md|lg|xl|2xl|3xl|4xl)$|leading-|weight-|tracking-|space-|radius-|duration-|ease-|topbar-|content-|gutter$|z-|editor-font-size$|editor-line-height$)/;

describe('themes', () => {
    test('the two light blocks are identical', () => {
        expect(lightMedia).toEqual(lightManual);
    });

    test('light and dark define the same themed tokens', () => {
        const themed = Object.keys(dark).filter(name => !SHARED.test(name));
        expect(Object.keys(lightManual).sort()).toEqual(themed.sort());
    });

    test('dark is the default and light is not', () => {
        expect(css).toMatch(/:root \{\s*color-scheme: dark;/);
        expect(css).toMatch(/color-scheme: light;/);
        expect(dark['--bg-canvas']).toBe('#0b0d10');
        expect(lightManual['--bg-canvas']).toBe('#f4f5f8');
    });

    test('the handoff’s new tokens exist', () => {
        for (const name of ['--glow-record', '--glow-pushdown', '--pushdown-ring', '--overlay-blur', '--scrim', '--grid-line', '--theme-color']) {
            expect(dark[name], name).toBeDefined();
        }
    });

    test('reduced motion sets every duration to 0', () => {
        const reduced = /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(css)![1];
        for (const name of ['--duration-fast', '--duration-normal', '--duration-slow']) expect(reduced).toContain(`${name}: 0ms`);
    });
});

function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe.each([
    ['dark', dark],
    ['light', lightManual]
])('%s syntax colors', (_name, tokens) => {
    const syntax = Object.keys(tokens).filter(n => n.startsWith('--syntax-'));

    test('there is one token per lexical category', () => {
        expect(syntax).toHaveLength(22);
    });

    test.each(syntax)('%s passes AA against the editor background', name => {
        expect(contrast(tokens[name], tokens['--editor-bg'])).toBeGreaterThanOrEqual(4.5);
    });

    // Inline code (`.mb-inline-code`) sits on the sunken surface, which is darker than the editor in the light theme.
    test.each(syntax)('%s passes AA against the sunken surface (inline code)', name => {
        expect(contrast(tokens[name], tokens['--surface-sunken'])).toBeGreaterThanOrEqual(4.5);
    });
});
