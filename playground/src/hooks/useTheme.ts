import { useEffect, useState } from 'react';
import { setTheme } from '../state/controller.js';
import { usePlayground, type ThemePreference } from '../state/store.js';

export interface ThemeView {
    preference: ThemePreference;
    effective: 'light' | 'dark';
    setPreference: (theme: ThemePreference) => void;
    /** system → light → dark → system */
    cycle: () => void;
}

/** The CSS shows the light theme only when the OS asks for light; with no preference it shows dark. */
const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** The theme the page shows for a preference, given the OS media query. */
export function effectiveTheme(preference: ThemePreference, matchMedia?: (query: string) => { matches: boolean }): 'light' | 'dark' {
    if (preference !== 'system') return preference;
    return matchMedia?.(LIGHT_QUERY).matches ? 'light' : 'dark';
}

function browserMatchMedia(): ((query: string) => MediaQueryList) | undefined {
    return typeof window === 'undefined' ? undefined : query => window.matchMedia(query);
}

/** Applies the theme preference to <html data-theme> and reports the effective theme. */
export function useThemeSync(): void {
    const preference = usePlayground(s => s.theme);
    useEffect(() => {
        const root = document.documentElement;
        if (preference === 'system') delete root.dataset.theme;
        else root.dataset.theme = preference;
    }, [preference]);
}

export function useTheme(): ThemeView {
    const preference = usePlayground(s => s.theme);
    const [system, setSystem] = useState(() => effectiveTheme('system', browserMatchMedia()));
    useEffect(() => {
        const media = window.matchMedia(LIGHT_QUERY);
        const listener = () => setSystem(media.matches ? 'light' : 'dark');
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
    }, []);
    const effective = preference === 'system' ? system : preference;
    return {
        preference,
        effective,
        setPreference: setTheme,
        cycle: () => setTheme(preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system')
    };
}
