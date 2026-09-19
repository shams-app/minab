import { useMemo, useState } from 'react';
import type { CheatSection } from '../../content/reference/cheatsheet.js';
import { CodeBlock, Markdown } from '../primitives/Code.js';
import { Badge, Button, EmptyState } from '../primitives/primitives.js';
import { Icon } from '../primitives/Icon.js';

export interface CheatSheetProps {
    sections: CheatSection[];
    specUrl: string;
    onOpenExample: (id: string) => void;
    /** Compact single-column rendering for the workbench drawer. */
    compact?: boolean;
}

export function CheatSheet({ sections, specUrl, onOpenExample, compact }: CheatSheetProps) {
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return sections;
        return sections
            .map(s => ({ ...s, entries: s.entries.filter(e => `${e.title} ${e.syntax} ${e.description} ${(e.keywords ?? []).join(' ')}`.toLowerCase().includes(q)) }))
            .filter(s => s.entries.length > 0);
    }, [sections, query]);
    return (
        <div className="mb-cheatsheet" data-compact={compact ? 'true' : undefined}>
            <div className="mb-search">
                <Icon name="search" />
                <input className="mb-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search: GROUPBY, $, CAST, switch…" aria-label="Search the cheat sheet" />
            </div>
            {!compact && (
                <nav className="mb-cheatsheet-toc" aria-label="Sections">
                    {filtered.map(s => <a key={s.id} href={`#ref-${s.id}`}>{s.title}</a>)}
                </nav>
            )}
            {filtered.length === 0 && <EmptyState icon="search" title="No matches">Try a keyword, like FROM or EXISTS.</EmptyState>}
            {filtered.map(section => (
                <section key={section.id} id={`ref-${section.id}`} className="mb-cheatsheet-section">
                    <h2>{section.title}</h2>
                    <Markdown source={section.intro} className="mb-muted" />
                    <div className="mb-cheatsheet-grid">
                        {section.entries.map(entry => (
                            <article key={entry.id} className="mb-cheat-card" id={`ref-${entry.id}`}>
                                <header>
                                    <h3>{entry.title}</h3>
                                    <div className="mb-row">
                                        {entry.status === 'check-only' && <Badge tone="check-only">check-only</Badge>}
                                        <a className="mb-badge" data-tone="neutral" href={specUrl} target="_blank" rel="noreferrer" title="Open the spec">{entry.specRef}</a>
                                    </div>
                                </header>
                                <CodeBlock code={entry.syntax} copyable />
                                <Markdown source={entry.description} />
                                {entry.exampleId && <Button size="sm" variant="ghost" icon="play" onClick={() => onOpenExample(entry.exampleId!)}>Run an example</Button>}
                            </article>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
