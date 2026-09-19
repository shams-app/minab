import { useEffect, type ReactNode } from 'react';
import { IconButton } from '../primitives/primitives.js';

export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);
    if (!open) return null;
    return (
        <div className="mb-overlay" data-kind="drawer" onMouseDown={onClose}>
            <aside className="mb-drawer" role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}>
                <header className="mb-drawer-head">
                    <h2>{title}</h2>
                    <IconButton icon="x" label="Close" onClick={onClose} />
                </header>
                <div className="mb-drawer-body">{children}</div>
            </aside>
        </div>
    );
}
