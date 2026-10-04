import { useEffect, useMemo, useState } from 'react';
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
            .map(s => ({
                ...s,
                entries: s.entries.filter(e => `${e.title} ${e.syntax} ${e.description} ${(e.keywords ?? []).join(' ')}`.toLowerCase().includes(q))
            }))
            .filter(s => s.entries.length > 0);
    }, [sections, query]);
    const total = filtered.reduce((n, s) => n + s.entries.length, 0);
    const [inView, setInView] = useState<string>();
    // The section chip of the section being read turns active.
    useEffect(() => {
        if (compact || typeof IntersectionObserver === 'undefined') return;
        const seen = new Set<string>();
        const observer = new IntersectionObserver(
            entries => {
                for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
                const first = filtered.find(s => seen.has(`ref-${s.id}`));
                if (first) setInView(first.id);
            },
            { rootMargin: '-120px 0px -60% 0px' }
        );
        for (const s of filtered) {
            const node = document.getElementById(`ref-${s.id}`);
            if (node) observer.observe(node);
        }
        return () => observer.disconnect();
    }, [filtered, compact]);
    const searching = query.trim() !== '';
    return (
        <div className="mb-cheatsheet" data-compact={compact ? 'true' : undefined}>
            <div className="mb-cheatsheet-sticky">
                <div className="mb-search" data-filled={searching ? 'true' : undefined}>
                    <Icon name="search" />
                    <input
                        className="mb-input"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search: GROUPBY, $, CAST, switch…"
                        aria-label="Search the cheat sheet"
                    />
                    {searching ? (
                        <span className="mb-search-count mb-mono" role="status">
                            {total} {total === 1 ? 'card' : 'cards'}
                        </span>
                    ) : (
                        compact && <kbd className="mb-kbd mb-search-hint">esc</kbd>
                    )}
                </div>
                {!compact && (
                    <nav className="mb-cheatsheet-toc" aria-label="Sections">
                        {filtered.map(s => (
                            <a
                                key={s.id}
                                className="mb-chip"
                                href={`#ref-${s.id}`}
                                data-state={searching || inView === s.id ? 'active' : undefined}
                                aria-current={!searching && inView === s.id ? 'location' : undefined}
                            >
                                {s.title}
                            </a>
                        ))}
                    </nav>
                )}
            </div>
            {filtered.length === 0 && (
                <EmptyState icon="search" title="No matches">
                    Try a keyword, like FROM or EXISTS.
                </EmptyState>
            )}
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
                                        <a className="mb-badge" data-tone="neutral" href={specUrl} target="_blank" rel="noreferrer" title="Open the spec">
                                            {entry.specRef}
                                        </a>
                                    </div>
                                </header>
                                <CodeBlock code={entry.syntax} copyable />
                                <Markdown source={entry.description} />
                                {entry.exampleId && (
                                    <Button size="sm" variant="ghost" className="mb-cheat-run" onClick={() => onOpenExample(entry.exampleId!)}>
                                        Run an example →
                                    </Button>
                                )}
                            </article>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
