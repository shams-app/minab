import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { examples } from '../content/examples/index.js';
import { lessons } from '../content/tour/index.js';
import { run, setAutoRun, setOutputTab, setPaletteOpen, setReferenceOpen, setTheme, toast } from '../state/controller.js';
import { getState } from '../state/store.js';
import { engineClient } from '../client/engine-client.js';
import { useShare } from './useShare.js';

export interface Command {
    id: string;
    title: string;
    group: 'Actions' | 'Examples' | 'Lessons' | 'Pages';
    /** Extra words to match on. */
    keywords?: string;
    shortcut?: string[];
    run: () => void;
}

/** Everything the ⌘K palette can do. */
export function useCommands(): Command[] {
    const navigate = useNavigate();
    const share = useShare();
    return useMemo(() => {
        const close = (fn: () => void) => () => {
            setPaletteOpen(false);
            fn();
        };
        const actions: Command[] = [
            { id: 'run', title: 'Run program', group: 'Actions', shortcut: ['⌘', '↵'], run: close(() => void run()) },
            { id: 'share', title: 'Copy share link', group: 'Actions', shortcut: ['⌘', 'S'], run: close(() => void share.copyLink()) },
            { id: 'embed', title: 'Copy embed code', group: 'Actions', run: close(() => void share.copyEmbed()) },
            { id: 'export', title: 'Download for the CLI (.zip)', group: 'Actions', keywords: 'export seed sql', run: close(() => void share.exportBundle()) },
            { id: 'autorun', title: 'Toggle auto-run', group: 'Actions', run: close(() => setAutoRun(!getState().autoRun)) },
            { id: 'sql', title: 'Show compiled SQL', group: 'Actions', run: close(() => setOutputTab('sql')) },
            { id: 'execution', title: 'Show execution map', group: 'Actions', keywords: 'trace pushdown', run: close(() => setOutputTab('execution')) },
            { id: 'ast', title: 'Show syntax tree', group: 'Actions', keywords: 'ast parse', run: close(() => setOutputTab('ast')) },
            { id: 'reference', title: 'Open the cheat sheet', group: 'Actions', keywords: 'reference docs help', run: close(() => setReferenceOpen(true)) },
            {
                id: 'reset-db',
                title: 'Reset the demo database',
                group: 'Actions',
                run: close(
                    () =>
                        void engineClient()
                            .call('resetDatabase')
                            .then(() => toast('Demo data restored.', 'success'))
                )
            },
            { id: 'theme-light', title: 'Theme: light', group: 'Actions', run: close(() => setTheme('light')) },
            { id: 'theme-dark', title: 'Theme: dark', group: 'Actions', run: close(() => setTheme('dark')) },
            { id: 'theme-system', title: 'Theme: match system', group: 'Actions', run: close(() => setTheme('system')) }
        ];
        const pages: Command[] = [
            { id: 'page-home', title: 'Home', group: 'Pages', run: close(() => navigate('/')) },
            { id: 'page-play', title: 'Playground', group: 'Pages', run: close(() => navigate('/play')) },
            { id: 'page-examples', title: 'Examples', group: 'Pages', run: close(() => navigate('/examples')) },
            { id: 'page-learn', title: 'Tour', group: 'Pages', keywords: 'learn lessons', run: close(() => navigate('/learn')) },
            { id: 'page-reference', title: 'Reference', group: 'Pages', keywords: 'cheat sheet', run: close(() => navigate('/reference')) }
        ];
        const exampleCommands: Command[] = examples.map(e => ({
            id: `example-${e.id}`,
            title: e.title,
            group: 'Examples',
            keywords: `${e.id} ${e.summary} ${e.tags.join(' ')}`,
            run: close(() => navigate(`/play?example=${e.id}`))
        }));
        const lessonCommands: Command[] = lessons.map(l => ({
            id: `lesson-${l.id}`,
            title: `${l.number}. ${l.title}`,
            group: 'Lessons',
            keywords: `${l.id} ${l.summary}`,
            run: close(() => navigate(`/learn/${l.id}`))
        }));
        return [...actions, ...pages, ...exampleCommands, ...lessonCommands];
    }, [navigate, share]);
}
