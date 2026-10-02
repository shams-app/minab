import { useEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '../../hooks/useCommands.js';
import { Icon } from '../primitives/Icon.js';
import { Kbd } from '../primitives/primitives.js';

export interface CommandPaletteProps {
    open: boolean;
    commands: Command[];
    onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const input = useRef<HTMLInputElement>(null);

    const results = useMemo(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return commands
            .filter(c => {
                const haystack = `${c.title} ${c.group} ${c.keywords ?? ''}`.toLowerCase();
                return words.every(w => haystack.includes(w));
            })
            .slice(0, 40);
    }, [commands, query]);

    useEffect(() => {
        if (open) {
            setQuery('');
            setIndex(0);
            setTimeout(() => input.current?.focus(), 0);
        }
    }, [open]);
    useEffect(() => setIndex(0), [query]);

    if (!open) return null;
    let lastGroup = '';
    return (
        <div className="mb-overlay" onMouseDown={onClose}>
            <div className="mb-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={e => e.stopPropagation()}>
                <div className="mb-palette-input">
                    <Icon name="search" />
                    <input
                        ref={input}
                        value={query}
                        placeholder="Examples, lessons, actions…"
                        aria-label="Search"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="palette-results"
                        aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Escape') onClose();
                            else if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setIndex(i => Math.min(i + 1, results.length - 1));
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setIndex(i => Math.max(i - 1, 0));
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                results[index]?.run();
                            }
                        }}
                    />
                    <Kbd keys={['esc']} />
                </div>
                <ul className="mb-palette-results" id="palette-results" role="listbox">
                    {results.length === 0 && <li className="mb-muted mb-palette-empty">Nothing matches “{query}”.</li>}
                    {results.map((c, i) => {
                        const header = c.group !== lastGroup ? c.group : undefined;
                        lastGroup = c.group;
                        return (
                            <li key={c.id} role="presentation">
                                {header && <p className="mb-palette-group">{header}</p>}
                                <div
                                    id={`cmd-${c.id}`}
                                    role="option"
                                    aria-selected={i === index}
                                    className="mb-palette-item"
                                    data-state={i === index ? 'active' : undefined}
                                    onMouseEnter={() => setIndex(i)}
                                    onClick={() => c.run()}
                                >
                                    <span>{c.title}</span>
                                    {c.shortcut && <Kbd keys={c.shortcut} />}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
