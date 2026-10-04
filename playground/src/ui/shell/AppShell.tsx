/**
 * The frame around every page but the embed: a top bar with the lockup
 * (mark and wordmark), the primary navigation, and global actions. Below
 * 720 px the navigation folds into a Menu button.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Icon } from '../primitives/Icon.js';
import { Mark } from '../primitives/Mark.js';
import { IconButton } from '../primitives/primitives.js';

export interface NavItem {
    to: string;
    label: string;
}

export interface AppShellProps {
    nav: NavItem[];
    theme: { preference: 'system' | 'light' | 'dark'; onCycle: () => void };
    onOpenPalette: () => void;
    repoUrl: string;
    children: ReactNode;
    /** Full-height app pages (workbench, tour) vs scrolling documents (landing, gallery). */
    layout: 'app' | 'document';
}

/** The `.minab` logotype alone, for text-only places. */
export function Wordmark() {
    return (
        <span className="mb-wordmark" aria-label="Minab">
            <span className="mb-wordmark-glyph" aria-hidden="true">
                .
            </span>
            minab
        </span>
    );
}

/** The mark and the wordmark together: the top bar, the embed header, the footer. */
export function Lockup({ markSize = 28 }: { markSize?: number }) {
    return (
        <span className="mb-lockup">
            <Mark size={markSize} />
            <Wordmark />
        </span>
    );
}

export function AppShell({ nav, theme, onOpenPalette, repoUrl, children, layout }: AppShellProps) {
    const themeIcon = theme.preference === 'dark' ? 'moon' : theme.preference === 'light' ? 'sun' : 'monitor';
    const [menuOpen, setMenuOpen] = useState(false);
    const { pathname } = useLocation();
    useEffect(() => setMenuOpen(false), [pathname]);
    return (
        <div className="mb-shell" data-layout={layout}>
            <a className="mb-skip-link" href="#main">
                Skip to content
            </a>
            <header className="mb-topbar">
                <NavLink to="/" className="mb-brand" aria-label="Minab home">
                    <Lockup />
                </NavLink>
                <nav className="mb-nav" aria-label="Primary" id="primary-nav" data-open={menuOpen ? 'true' : undefined}>
                    {nav.map(item => (
                        <NavLink key={item.to} to={item.to} className={({ isActive }) => `mb-nav-link${isActive ? ' is-active' : ''}`}>
                            {item.label}
                        </NavLink>
                    ))}
                    <a className="mb-nav-link mb-nav-extra" href={repoUrl} target="_blank" rel="noreferrer">
                        GitHub
                    </a>
                </nav>
                <div className="mb-topbar-actions">
                    <button type="button" className="mb-palette-trigger" onClick={onOpenPalette} aria-label="Search examples, lessons and actions">
                        <Icon name="search" size={14} /> <span>Search</span> <kbd className="mb-kbd">⌘K</kbd>
                    </button>
                    <IconButton
                        className="mb-menu-button"
                        icon="menu"
                        label="Menu"
                        pressed={menuOpen}
                        aria-expanded={menuOpen}
                        aria-controls="primary-nav"
                        onClick={() => setMenuOpen(open => !open)}
                    />
                    <IconButton icon={themeIcon} label={`Theme: ${theme.preference} (click to change)`} onClick={theme.onCycle} />
                    <a
                        className="mb-icon-button mb-github"
                        href={repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Minab on GitHub"
                        title="Minab on GitHub"
                    >
                        <Icon name="github" />
                    </a>
                </div>
            </header>
            <main id="main" className="mb-main">
                {children}
            </main>
        </div>
    );
}
