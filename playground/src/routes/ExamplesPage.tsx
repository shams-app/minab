import { useNavigate } from 'react-router';
import { useGallery } from '../hooks/useGallery.js';
import { preloadEditor } from '../monaco/LazyCodeEditor.js';
import { ExampleCard, ExampleGrid, GalleryFilters } from '../ui/gallery/Gallery.js';
import { SectionHeader } from '../ui/landing/Landing.js';

export function ExamplesPage() {
    const gallery = useGallery();
    const navigate = useNavigate();
    return (
        <div className="mb-page" onMouseEnter={preloadEditor}>
            <SectionHeader
                title="Examples"
                body={`${gallery.total} programs, every one verified against the engine. The first eleven are the repository’s own \`examples/\`.`}
            />
            <GalleryFilters
                query={gallery.query}
                onQuery={gallery.setQuery}
                tags={gallery.tags}
                onToggleTag={gallery.toggleTag}
                level={gallery.level}
                onLevel={gallery.setLevel}
                resultCount={gallery.results.length}
                total={gallery.total}
                onClear={gallery.clear}
            />
            <ExampleGrid empty={gallery.results.length === 0} onClear={gallery.clear}>
                {gallery.results.map(example => (
                    <ExampleCard
                        key={example.id}
                        example={example}
                        href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/play?example=${example.id}`}
                        onOpen={() => navigate(`/play?example=${example.id}`)}
                    />
                ))}
            </ExampleGrid>
        </div>
    );
}
