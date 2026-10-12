import { describe, expect, test } from 'vitest';
import { effectiveTheme } from '../src/hooks/useTheme.js';

/** A fake `window.matchMedia` for an OS that states `scheme`. */
function os(scheme: 'light' | 'dark' | 'no-preference') {
    return (query: string) => ({ matches: query === `(prefers-color-scheme: ${scheme})` });
}

describe('useTheme: the effective theme', () => {
    test('an OS with no preference shows dark, as the CSS does', () => {
        expect(effectiveTheme('system', os('no-preference'))).toBe('dark');
    });

    test('the system preference follows the OS', () => {
        expect(effectiveTheme('system', os('light'))).toBe('light');
        expect(effectiveTheme('system', os('dark'))).toBe('dark');
    });

    test('a chosen theme wins over the OS', () => {
        expect(effectiveTheme('light', os('dark'))).toBe('light');
        expect(effectiveTheme('dark', os('light'))).toBe('dark');
    });

    test('without a window (server render) it is dark', () => {
        expect(effectiveTheme('system')).toBe('dark');
    });
});
