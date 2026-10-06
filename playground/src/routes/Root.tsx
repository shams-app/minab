/**
 * The frame for every page except the embed: shell, command palette,
 * cheat-sheet drawer, toasts, global shortcuts, per-page titles.
 */

import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { cheatsheet, REPO_URL, SPEC_URL } from '../content/reference/cheatsheet.js';
import { useCommands } from '../hooks/useCommands.js';
import { useDemoMode } from '../hooks/useDemoMode.js';
import { useShare } from '../hooks/useShare.js';
import { useTheme, useThemeSync } from '../hooks/useTheme.js';
import { dismissToast, run, setPaletteOpen, setReferenceOpen } from '../state/controller.js';
import { getState, usePlayground } from '../state/store.js';
import { CommandPalette } from '../ui/overlays/CommandPalette.js';
import { Drawer } from '../ui/overlays/Drawer.js';
import { Toast } from '../ui/primitives/Toast.js';
import { CheatSheet } from '../ui/reference/CheatSheet.js';
import { AppShell } from '../ui/shell/AppShell.js';

const NAV = [
    { to: '/play', label: 'Playground' },
    { to: '/learn', label: 'Tour' },
    { to: '/examples', label: 'Examples' },
    { to: '/reference', label: 'Reference' }
];

const TITLES: Array<[RegExp, string]> = [
    [/^\/$/, 'Minab — a query and validation language'],
    [/^\/play/, 'Playground · Minab'],
    [/^\/learn/, 'Tour · Minab'],
    [/^\/examples/, 'Examples · Minab'],
    [/^\/reference/, 'Reference · Minab']
];

export function Root() {
    useThemeSync();
    useDemoMode();
    const theme = useTheme();
    const commands = useCommands();
    const share = useShare();
    const navigate = useNavigate();
    const location = useLocation();
    const paletteOpen = usePlayground(s => s.paletteOpen);
    const referenceOpen = usePlayground(s => s.referenceOpen);
    const toast = usePlayground(s => s.toast);
    const appPage = /^\/(play|learn)/.test(location.pathname);

    useEffect(() => {
        document.title = TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] ?? 'Minab';
    }, [location.pathname]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setPaletteOpen(!getState().paletteOpen);
            } else if (mod && e.key.toLowerCase() === 's' && appPage) {
                e.preventDefault();
                void share.copyLink();
            } else if (mod && e.key === 'Enter' && appPage && !(e.target as HTMLElement).closest('.monaco-editor')) {
                e.preventDefault();
                void run();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [appPage, share]);

    return (
        <AppShell
            nav={NAV}
            theme={{ preference: theme.preference, onCycle: theme.cycle }}
            onOpenPalette={() => setPaletteOpen(true)}
            repoUrl={REPO_URL}
            layout={appPage ? 'app' : 'document'}
        >
            <Outlet />
            <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
            <Drawer open={referenceOpen} title="Cheat sheet" onClose={() => setReferenceOpen(false)}>
                <CheatSheet
                    compact
                    sections={cheatsheet}
                    specUrl={SPEC_URL}
                    onOpenExample={id => {
                        setReferenceOpen(false);
                        navigate(`/play?example=${id}`);
                    }}
                />
            </Drawer>
            <Toast toast={toast} onDismiss={dismissToast} />
        </AppShell>
    );
}
