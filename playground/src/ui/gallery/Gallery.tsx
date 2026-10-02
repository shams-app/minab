import type { Example, ExampleTag, Level } from '../../content/types.js';
import { TAG_LABELS } from '../../content/examples/index.js';
import { CodeBlock, Inline } from '../primitives/Code.js';
import { Badge, Button, EmptyState } from '../primitives/primitives.js';
import { Icon } from '../primitives/Icon.js';

export interface GalleryFiltersProps {
    query: string;
    onQuery: (query: string) => void;
    tags: Array<{ id: ExampleTag; label: string; count: number; active: boolean }>;
    onToggleTag: (tag: ExampleTag) => void;
    level: Level | 'all';
    onLevel: (level: Level | 'all') => void;
    resultCount: number;
    total: number;
    onClear: () => void;
}

export function GalleryFilters(props: GalleryFiltersProps) {
    return (
        <div className="mb-gallery-filters">
            <div className="mb-search">
                <Icon name="search" />
                <input
                    className="mb-input"
                    value={props.query}
                    onChange={e => props.onQuery(e.target.value)}
                    placeholder="Search examples…"
                    aria-label="Search examples"
                />
            </div>
            <div className="mb-chip-row" role="group" aria-label="Filter by topic">
                {props.tags.map(tag => (
                    <button
                        key={tag.id}
                        type="button"
                        className="mb-chip"
                        aria-pressed={tag.active}
                        data-state={tag.active ? 'active' : undefined}
                        data-tag={tag.id}
                        onClick={() => props.onToggleTag(tag.id)}
                    >
                        {tag.label} <span className="mb-muted">{tag.count}</span>
                    </button>
                ))}
            </div>
            <div className="mb-row">
                <label className="mb-label" htmlFor="gallery-level">
                    Level
                </label>
                <select id="gallery-level" className="mb-select" value={props.level} onChange={e => props.onLevel(e.target.value as Level | 'all')}>
                    <option value="all">All levels</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                </select>
                <span className="mb-muted" role="status">
                    {props.resultCount} of {props.total}
                </span>
                {props.resultCount !== props.total && (
                    <Button size="sm" variant="ghost" onClick={props.onClear}>
                        Clear filters
                    </Button>
                )}
            </div>
        </div>
    );
}

export interface ExampleCardProps {
    example: Example;
    href: string;
    onOpen: () => void;
}

export function ExampleCard({ example, href, onOpen }: ExampleCardProps) {
    const preview = example.source
        .split('\n')
        .filter(l => !l.trimStart().startsWith('//'))
        .join('\n')
        .trim();
    return (
        <article className="mb-example-card" data-level={example.level}>
            <header>
                <h3>
                    <a
                        href={href}
                        onClick={e => {
                            e.preventDefault();
                            onOpen();
                        }}
                    >
                        {example.title}
                    </a>
                </h3>
                <p className="mb-muted">
                    <Inline text={example.summary} />
                </p>
            </header>
            <CodeBlock code={preview.split('\n').slice(0, 7).join('\n')} className="mb-example-preview" />
            <footer>
                <div className="mb-chip-row">
                    {example.tags.map(tag => (
                        <Badge key={tag} tone={tag === 'check-only' ? 'check-only' : 'neutral'}>
                            {TAG_LABELS[tag]}
                        </Badge>
                    ))}
                </div>
                <span className="mb-muted">
                    {example.level} · {example.specRef}
                    {example.repoPath ? ' · from the repo' : ''}
                </span>
            </footer>
        </article>
    );
}

export function ExampleGrid({ children, empty, onClear }: { children: React.ReactNode; empty: boolean; onClear: () => void }) {
    if (empty) return <EmptyState icon="search" title="No examples match" action={<Button onClick={onClear}>Clear filters</Button>} />;
    return <div className="mb-example-grid">{children}</div>;
}
