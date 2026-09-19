import { useEffect, useState } from 'react';
import { engineClient } from '../client/engine-client.js';
import { exampleById } from '../content/examples/index.js';
import type { Example } from '../content/types.js';
import type { RunReport } from '../engine/protocol.js';
import { hostSettings, workspaceFromExample } from '../state/workspace.js';

export interface SnippetView {
    example?: Example;
    report?: RunReport;
    loading: boolean;
    error?: string;
}

/**
 * Runs a gallery example on its own host without touching the workbench —
 * for the landing page, where snippets show their real compiled SQL and
 * results rather than screenshots.
 */
export function useSnippet(exampleId: string, enabled = true): SnippetView {
    const example = exampleById(exampleId);
    const [state, setState] = useState<Omit<SnippetView, 'example'>>({ loading: true });
    useEffect(() => {
        if (!example || !enabled) return;
        let cancelled = false;
        setState(s => ({ ...s, loading: true }));
        const workspace = workspaceFromExample(example);
        engineClient()
            .call('runSnippet', hostSettings(workspace.host), workspace.source)
            .then(
                report => !cancelled && setState({ report, loading: false }),
                e => !cancelled && setState({ loading: false, error: (e as Error).message })
            );
        return () => {
            cancelled = true;
        };
    }, [example, enabled]);
    return { example, ...state };
}
