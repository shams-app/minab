import { useMemo, useState } from 'react';
import { examples, featuredExampleIds, TAG_LABELS } from '../content/examples/index.js';
import type { Example, ExampleTag, Level } from '../content/types.js';

export interface GalleryView {
    query: string;
    setQuery: (query: string) => void;
    tags: Array<{ id: ExampleTag; label: string; count: number; active: boolean }>;
    toggleTag: (tag: ExampleTag) => void;
    level: Level | 'all';
    setLevel: (level: Level | 'all') => void;
    results: Example[];
    featured: Example[];
    total: number;
    clear: () => void;
}

export function useGallery(): GalleryView {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState<ExampleTag[]>([]);
    const [level, setLevel] = useState<Level | 'all'>('all');

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        return examples.filter(
            e =>
                (active.length === 0 || active.every(tag => e.tags.includes(tag))) &&
                (level === 'all' || e.level === level) &&
                (!q || `${e.title} ${e.summary} ${e.source} ${e.tags.join(' ')}`.toLowerCase().includes(q))
        );
    }, [query, active, level]);

    const tags = (Object.keys(TAG_LABELS) as ExampleTag[]).map(id => ({
        id,
        label: TAG_LABELS[id],
        count: examples.filter(e => e.tags.includes(id)).length,
        active: active.includes(id)
    }));

    return {
        query,
        setQuery,
        tags,
        toggleTag: tag => setActive(a => (a.includes(tag) ? a.filter(t => t !== tag) : [...a, tag])),
        level,
        setLevel,
        results,
        featured: featuredExampleIds.map(id => examples.find(e => e.id === id)!).filter(Boolean),
        total: examples.length,
        clear: () => {
            setQuery('');
            setActive([]);
            setLevel('all');
        }
    };
}
