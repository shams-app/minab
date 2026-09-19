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

function systemDark(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
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
    const [dark, setDark] = useState(systemDark);
    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = () => setDark(media.matches);
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
    }, []);
    const effective = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
    return {
        preference,
        effective,
        setPreference: setTheme,
        cycle: () => setTheme(preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system')
    };
}
