import { Link } from 'react-router';
import { EmptyState } from '../ui/primitives/primitives.js';

export function NotFoundPage() {
    return (
        <div className="mb-page">
            <EmptyState
                icon="search"
                title="Nothing here"
                action={
                    <Link className="mb-button" data-variant="primary" to="/">
                        Go home
                    </Link>
                }
            >
                <code className="mb-inline-code">EXISTS(#Page[.path == $])</code> answered <strong>false</strong>.
            </EmptyState>
        </div>
    );
}
