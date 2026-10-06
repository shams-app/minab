import { useEffect, useState } from 'react';
import { preloadEditor } from '../monaco/LazyCodeEditor.js';
import { setTheme, toast, warmUpEngine } from '../state/controller.js';
import { usePlayground } from '../state/store.js';

/** The URL flag that turns the TV demo mode on: `/?demo=tv`. */
const FLAG = 'demo';
const VALUE = 'tv';
const SESSION_KEY = 'minab-playground:demo';

/** The route chunks the demo script visits. Loading them early means no click waits for the network. */
const CHUNKS = [() => import('../routes/PlayPage.js'), () => import('../routes/ExamplesPage.js'), () => import('../routes/LearnPage.js')];

/**
 * Is the TV demo mode on? The flag is read from the URL once, then kept for the tab (sessionStorage),
 * because links inside the app drop the query string. Storage can throw, so every access is guarded.
 */
export function isDemoMode(): boolean {
    try {
        if (new URLSearchParams(window.location.search).get(FLAG) === VALUE) {
            window.sessionStorage.setItem(SESSION_KEY, VALUE);
            return true;
        }
        return window.sessionStorage.getItem(SESSION_KEY) === VALUE;
    } catch {
        return new URLSearchParams(window.location.search).get(FLAG) === VALUE;
    }
}

/**
 * TV demo mode (W5, D44). When `?demo=tv` is in the URL:
 *  - `<html data-demo="tv">` makes the text and the editor font larger (see `tokens.css`) and the theme is dark;
 *  - Monaco, the engine, PostgreSQL (PGlite) and every page chunk of the script load at once;
 *  - when all of that is done, `<html data-demo-ready="true">` is set and a toast says so.
 * After that the whole demo works with the network off.
 */
export function useDemoMode(): void {
    const engine = usePlayground(s => s.engine);
    const dbReady = engine.phase === 'ready' && engine.database === 'ready';
    const [chunksReady, setChunksReady] = useState(false);

    useEffect(() => {
        if (!isDemoMode()) return;
        const root = document.documentElement;
        root.dataset.demo = 'tv';
        setTheme('dark');
        preloadEditor();
        warmUpEngine();
        void Promise.all(CHUNKS.map(load => load()))
            .then(() => setChunksReady(true))
            .catch(() => undefined);
        return () => {
            delete root.dataset.demo;
            delete root.dataset.demoReady;
        };
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        if (root.dataset.demo !== 'tv' || !dbReady || !chunksReady || root.dataset.demoReady) return;
        root.dataset.demoReady = 'true';
        toast('Demo ready. Everything is loaded. It works offline now.', 'success');
    }, [dbReady, chunksReady]);
}
