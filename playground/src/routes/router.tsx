import { createBrowserRouter, Navigate } from 'react-router';
import { lessons } from '../content/tour/index.js';
import { EmbedPage } from './EmbedPage.js';
import { ExamplesPage } from './ExamplesPage.js';
import { LandingPage } from './LandingPage.js';
import { LearnPage } from './LearnPage.js';
import { NotFoundPage } from './NotFoundPage.js';
import { PlayPage } from './PlayPage.js';
import { ReferencePage } from './ReferencePage.js';
import { Root } from './Root.js';
import { RouteError } from './RouteError.js';

export const router = createBrowserRouter(
    [
        {
            path: '/',
            element: <Root />,
            errorElement: <RouteError />,
            children: [
                { index: true, element: <LandingPage /> },
                { path: 'play', element: <PlayPage /> },
                { path: 'examples', element: <ExamplesPage /> },
                { path: 'learn', element: <Navigate to={`/learn/${lessons[0].id}`} replace /> },
                { path: 'learn/:lesson', element: <LearnPage /> },
                { path: 'reference', element: <ReferencePage /> },
                { path: '*', element: <NotFoundPage /> }
            ]
        },
        { path: '/embed', element: <EmbedPage />, errorElement: <RouteError /> }
    ],
    { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' }
);
