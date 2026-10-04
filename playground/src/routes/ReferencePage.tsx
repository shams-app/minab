import { useNavigate } from 'react-router';
import { cheatsheet, SPEC_URL } from '../content/reference/cheatsheet.js';
import { Icon } from '../ui/primitives/Icon.js';
import { CheatSheet } from '../ui/reference/CheatSheet.js';
import { PageHeader } from '../ui/landing/Landing.js';

export function ReferencePage() {
    const navigate = useNavigate();
    return (
        <div className="mb-page">
            <PageHeader
                title="Reference"
                body="The language on one page. The spec is the authority; every card links to its section."
                action={
                    <a className="mb-button" data-variant="secondary" href={SPEC_URL} target="_blank" rel="noreferrer">
                        Read the full spec <Icon name="external" size={14} />
                    </a>
                }
            />
            <CheatSheet sections={cheatsheet} specUrl={SPEC_URL} onOpenExample={id => navigate(`/play?example=${id}`)} />
        </div>
    );
}
