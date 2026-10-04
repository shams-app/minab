import { Link } from 'react-router';
import { InlineCode } from '../ui/primitives/Code.js';
import { EmptyState } from '../ui/primitives/primitives.js';

export function NotFoundPage() {
    return (
        <div className="mb-page">
            <EmptyState
                glyph="∅"
                title="Nothing here"
                action={
                    <Link className="mb-button" data-variant="primary" to="/">
                        Go home
                    </Link>
                }
            >
                <code className="mb-empty-code">
                    <InlineCode>EXISTS(#Page[.path == $])</InlineCode> <span className="tok tok-constant">→ false</span>
                </code>
                <p>This page does not exist. The link may be old or mistyped.</p>
            </EmptyState>
        </div>
    );
}
