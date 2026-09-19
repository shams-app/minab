import { useMemo } from 'react';
import { restartEngine } from '../state/controller.js';
import { usePlayground } from '../state/store.js';

export type EngineIndicator = 'starting' | 'ready' | 'booting-db' | 'db-ready' | 'failed';

export interface EngineView {
    indicator: EngineIndicator;
    /** Short status text for a pill: "Starting…", "Postgres ready". */
    label: string;
    /** Longer explanation for a tooltip. */
    detail: string;
    error?: string;
    restart: () => void;
}

/** The engine worker's health, and whether the in-browser Postgres has booted. */
export function useEngine(): EngineView {
    const status = usePlayground(s => s.engine);
    return useMemo(() => {
        if (status.phase === 'starting') {
            return { indicator: 'starting', label: 'Starting…', detail: 'Loading the Minab toolchain.', restart: restartEngine };
        }
        if (status.phase === 'failed') {
            return { indicator: 'failed', label: 'Engine stopped', detail: status.error, error: status.error, restart: restartEngine };
        }
        switch (status.database) {
            case 'booting':
                return { indicator: 'booting-db', label: 'Starting Postgres…', detail: 'Booting PostgreSQL (WebAssembly) in your browser — about a second, once.', restart: restartEngine };
            case 'ready':
                return { indicator: 'db-ready', label: 'Postgres ready', detail: 'Programs run against a real PostgreSQL, compiled to WebAssembly, in this tab.', restart: restartEngine };
            case 'failed':
                return { indicator: 'failed', label: 'Postgres failed', detail: status.databaseError ?? 'The database could not start.', error: status.databaseError, restart: restartEngine };
            default:
                return { indicator: 'ready', label: 'Ready', detail: 'The checker is ready; Postgres starts on the first run.', restart: restartEngine };
        }
    }, [status]);
}
