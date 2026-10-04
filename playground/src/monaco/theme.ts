/**
 * The editor's colors come from the page's design tokens.
 *
 * Monaco can't read CSS variables — its themes take hex colors — so this
 * reads each `--syntax-*` and `--editor-*` token off the document, resolves
 * it to a hex value (whatever color syntax the design uses), and defines a
 * theme from them. It re-runs whenever the page theme changes, so a
 * redesign that only touches `tokens.css` recolors the editor too.
 */

import type { TokenType } from '../syntax/tokens.js';
import { monaco } from './monaco.js';

/** Which design token colors each token type. Shared with the static highlighter's CSS. */
export const TOKEN_COLOR_VARS: Record<Exclude<TokenType, 'whitespace'>, string> = {
    'keyword.pipeline': '--syntax-keyword-pipeline',
    'keyword.dml': '--syntax-keyword-dml',
    'keyword.operator': '--syntax-keyword-operator',
    'keyword.control': '--syntax-keyword-control',
    type: '--syntax-type',
    constant: '--syntax-constant',
    builtin: '--syntax-builtin',
    function: '--syntax-function',
    'sigil.record': '--syntax-sigil-record',
    'sigil.field': '--syntax-sigil-field',
    'sigil.parent': '--syntax-sigil-parent',
    'sigil.alias': '--syntax-sigil-alias',
    'sigil.key': '--syntax-sigil-key',
    'sigil.index': '--syntax-sigil-index',
    member: '--syntax-member',
    identifier: '--syntax-identifier',
    string: '--syntax-string',
    number: '--syntax-number',
    comment: '--syntax-comment',
    operator: '--syntax-operator',
    delimiter: '--syntax-delimiter',
    invalid: '--syntax-invalid'
};

const BOLD = new Set(['keyword.pipeline', 'keyword.dml']);
const ITALIC = new Set(['comment']);

let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS color → `#rrggbb` or `#rrggbbaa`, via a 1×1 canvas. */
function toHex(color: string): string | undefined {
    if (!color) return undefined;
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!probe) return undefined;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000000';
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ''}`;
}

function token(style: CSSStyleDeclaration, name: string): string | undefined {
    const value = style.getPropertyValue(name).trim();
    return value ? toHex(value) : undefined;
}

export function effectiveTheme(): 'light' | 'dark' {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'light' || explicit === 'dark') return explicit;
    // Dark is the default (tokens.css): light only when the OS asks for it.
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const THEME_NAME = 'minab';

export function applyEditorTheme(): void {
    const style = getComputedStyle(document.documentElement);
    const rules: monaco.editor.ITokenThemeRule[] = [];
    for (const [type, variable] of Object.entries(TOKEN_COLOR_VARS)) {
        const color = token(style, variable);
        if (!color) continue;
        rules.push({
            token: type,
            foreground: color.slice(1, 7),
            fontStyle: BOLD.has(type) ? 'bold' : ITALIC.has(type) ? 'italic' : undefined
        });
    }
    const colors: Record<string, string> = {};
    const set = (key: string, variable: string) => {
        const color = token(style, variable);
        if (color) colors[key] = color;
    };
    set('editor.background', '--editor-bg');
    set('editor.foreground', '--editor-fg');
    set('editorLineNumber.foreground', '--editor-gutter-fg');
    set('editorLineNumber.activeForeground', '--editor-gutter-fg-active');
    // Monaco dims the number of the empty last line; keep it as readable as the others.
    set('editorLineNumber.dimmedForeground', '--editor-gutter-fg');
    set('editor.lineHighlightBackground', '--editor-line-highlight');
    set('editor.lineHighlightBorder', '--editor-line-highlight');
    set('editor.selectionBackground', '--editor-selection');
    set('editor.inactiveSelectionBackground', '--editor-selection-inactive');
    set('editorCursor.foreground', '--editor-cursor');
    set('editorIndentGuide.background1', '--editor-indent-guide');
    set('editorWhitespace.foreground', '--editor-indent-guide');
    set('editorBracketMatch.background', '--editor-bracket-match');
    set('editorBracketMatch.border', '--editor-bracket-match-border');
    // Widgets use the opaque raised surface: Monaco cannot blur what is behind them, so the glass overlay token would show the code through.
    set('editorWidget.background', '--surface-raised');
    set('editorWidget.border', '--border-strong');
    set('editorHoverWidget.background', '--surface-raised');
    set('editorHoverWidget.border', '--border-strong');
    set('editorSuggestWidget.background', '--surface-raised');
    set('editorSuggestWidget.border', '--border-strong');
    set('editorSuggestWidget.selectedBackground', '--surface-selected');
    set('editorSuggestWidget.highlightForeground', '--accent');
    set('editorError.foreground', '--danger');
    set('editorWarning.foreground', '--warning');
    set('editorInfo.foreground', '--info');
    set('focusBorder', '--focus-ring');
    set('scrollbarSlider.background', '--editor-scrollbar');
    set('scrollbarSlider.hoverBackground', '--editor-scrollbar-hover');

    monaco.editor.defineTheme(THEME_NAME, {
        base: effectiveTheme() === 'dark' ? 'vs-dark' : 'vs',
        inherit: true,
        rules,
        colors
    });
    monaco.editor.setTheme(THEME_NAME);
}

let watching = false;

/** Re-applies the editor theme when the page theme or the OS preference changes. */
export function watchTheme(): void {
    if (watching) return;
    watching = true;
    new MutationObserver(() => applyEditorTheme()).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class', 'style']
    });
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyEditorTheme());
}

/** The monospace font stack from the design tokens, for Monaco's `fontFamily`. */
export function editorFont(): { family: string; size: number; lineHeight: number } {
    const style = getComputedStyle(document.documentElement);
    const family = style.getPropertyValue('--font-mono').trim() || 'ui-monospace, SFMono-Regular, Menlo, monospace';
    const size = parseFloat(style.getPropertyValue('--editor-font-size')) || 14;
    const lineHeight = parseFloat(style.getPropertyValue('--editor-line-height')) || 22;
    return { family, size, lineHeight };
}
