import { useRouteError } from 'react-router';
import { restartEngine } from '../state/controller.js';
import { Button, EmptyState } from '../ui/primitives/primitives.js';

/** The last line of defense: a render error shows this instead of a blank page. */
export function RouteError() {
    const error = useRouteError() as Error | undefined;
    return (
        <div className="mb-page">
            <EmptyState
                icon="alert"
                tone="danger"
                title="Something broke on this page"
                action={<div className="mb-row"><Button variant="primary" onClick={() => window.location.reload()}>Reload</Button><Button onClick={restartEngine}>Restart the engine</Button></div>}
            >
                <p>{error?.message ?? 'An unexpected error occurred.'}</p>
                <p className="mb-muted">Your work is saved in this browser — reloading won’t lose it.</p>
            </EmptyState>
        </div>
    );
}
