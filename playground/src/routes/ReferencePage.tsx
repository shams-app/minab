import { useNavigate } from 'react-router';
import { cheatsheet, SPEC_URL } from '../content/reference/cheatsheet.js';
import { CheatSheet } from '../ui/reference/CheatSheet.js';
import { SectionHeader } from '../ui/landing/Landing.js';

export function ReferencePage() {
    const navigate = useNavigate();
    return (
        <div className="mb-page">
            <SectionHeader title="Reference" body={`The language on one page. The [spec](${SPEC_URL}) is the authority; every card links to its section.`} />
            <CheatSheet sections={cheatsheet} specUrl={SPEC_URL} onOpenExample={id => navigate(`/play?example=${id}`)} />
        </div>
    );
}
