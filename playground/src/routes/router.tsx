import { createBrowserRouter } from 'react-router';
import { LandingPage } from './LandingPage.js';
import { NotFoundPage } from './NotFoundPage.js';
import { Root } from './Root.js';
import { RouteError } from './RouteError.js';

/**
 * Only the landing page, the shell and the 404 are in the first bundle. Every other route loads its own chunk
 * when it is first visited, so the landing page does not pay for the workbench, the tour or the reference.
 */
export const router = createBrowserRouter(
    [
        {
            path: '/',
            element: <Root />,
            errorElement: <RouteError />,
            children: [
                { index: true, element: <LandingPage /> },
                { path: 'play', lazy: async () => ({ Component: (await import('./PlayPage.js')).PlayPage }) },
                { path: 'examples', lazy: async () => ({ Component: (await import('./ExamplesPage.js')).ExamplesPage }) },
                { path: 'learn', lazy: async () => ({ Component: (await import('./LearnRedirect.js')).LearnRedirect }) },
                { path: 'learn/:lesson', lazy: async () => ({ Component: (await import('./LearnPage.js')).LearnPage }) },
                { path: 'reference', lazy: async () => ({ Component: (await import('./ReferencePage.js')).ReferencePage }) },
                { path: '*', element: <NotFoundPage /> }
            ]
        },
        { path: '/embed', lazy: async () => ({ Component: (await import('./EmbedPage.js')).EmbedPage }), errorElement: <RouteError /> }
    ],
    { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' }
);
