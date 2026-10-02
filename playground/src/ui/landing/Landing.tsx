/**
 * Landing-page sections. Each takes its words as props (from
 * `content/landing.ts`) and any live data from the page.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CodeBlock, Inline, Markdown } from '../primitives/Code.js';
import { Icon, type IconName } from '../primitives/Icon.js';
import { Tabs } from '../primitives/primitives.js';

export function Hero({
    eyebrow,
    headline,
    subhead,
    primary,
    secondary,
    note,
    demo
}: {
    eyebrow: string;
    headline: string;
    subhead: string;
    primary: { label: string; to: string };
    secondary: { label: string; to: string };
    note: string;
    demo: ReactNode;
}) {
    return (
        <section className="mb-hero">
            <div className="mb-hero-copy">
                <p className="mb-eyebrow">{eyebrow}</p>
                <h1 className="mb-hero-title">{headline}</h1>
                <p className="mb-hero-subhead">{subhead}</p>
                <div className="mb-row">
                    <Link className="mb-button" data-variant="primary" data-size="lg" to={primary.to}>
                        <Icon name="play" /> {primary.label}
                    </Link>
                    <Link className="mb-button" data-variant="secondary" data-size="lg" to={secondary.to}>
                        {secondary.label}
                    </Link>
                </div>
                <p className="mb-muted mb-hero-note">
                    <Icon name="database" size={14} /> {note}
                </p>
            </div>
            <div className="mb-hero-demo">{demo}</div>
        </section>
    );
}

export interface HeroDemoProps {
    tabs: Array<{ id: string; label: string }>;
    active: string;
    onSelect: (id: string) => void;
    caption: string;
    source: string;
    /** The output pane: SQL, rows, a verdict or a diagnostic, rendered by the page. */
    output: ReactNode;
    openHref: string;
}

export function HeroDemo({ tabs, active, onSelect, caption, source, output, openHref }: HeroDemoProps) {
    return (
        <div className="mb-hero-card">
            <Tabs idPrefix="hero" ariaLabel="Demo" size="sm" tabs={tabs} active={active} onChange={onSelect} />
            <div className="mb-hero-card-body" id="hero-panel" role="tabpanel">
                <p className="mb-muted">
                    <Inline text={caption} />
                </p>
                <CodeBlock
                    code={source
                        .split('\n')
                        .filter(l => !l.trimStart().startsWith('//'))
                        .join('\n')
                        .trim()}
                />
                <div className="mb-hero-output">{output}</div>
                <Link className="mb-link-button" to={openHref}>
                    Open in the playground →
                </Link>
            </div>
        </div>
    );
}

export function SectionHeader({ title, body }: { title: string; body?: string }) {
    return (
        <header className="mb-section-head">
            <h2>{title}</h2>
            {body && <Markdown source={body} className="mb-section-lead" />}
        </header>
    );
}

export function LayerCards({
    title,
    body,
    cards
}: {
    title: string;
    body: string;
    cards: Array<{ title: string; body: string; source: string; href: string }>;
}) {
    return (
        <section className="mb-section">
            <SectionHeader title={title} body={body} />
            <div className="mb-layer-grid">
                {cards.map(card => (
                    <article className="mb-layer-card" key={card.title}>
                        <h3>{card.title}</h3>
                        <Markdown source={card.body} className="mb-muted" />
                        <CodeBlock
                            code={card.source
                                .split('\n')
                                .filter(l => !l.trimStart().startsWith('//'))
                                .join('\n')
                                .trim()}
                        />
                        <Link className="mb-link-button" to={card.href}>
                            Run it →
                        </Link>
                    </article>
                ))}
            </div>
        </section>
    );
}

export function SigilGrid({
    title,
    body,
    items
}: {
    title: string;
    body: string;
    items: ReadonlyArray<{ sigil: string; token: string; name: string; example: string }>;
}) {
    return (
        <section className="mb-section">
            <SectionHeader title={title} body={body} />
            <ul className="mb-sigil-grid">
                {items.map(item => (
                    <li key={item.sigil} className="mb-sigil-card">
                        <span className={`mb-sigil tok tok-${item.token}`}>{item.sigil}</span>
                        <span className="mb-sigil-name">{item.name}</span>
                        <CodeBlock code={item.example} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function HowItRuns({ title, steps }: { title: string; steps: ReadonlyArray<{ title: string; body: string }> }) {
    return (
        <section className="mb-section">
            <SectionHeader title={title} />
            <ol className="mb-steps">
                {steps.map((step, i) => (
                    <li key={step.title} className="mb-step">
                        <span className="mb-step-number">{i + 1}</span>
                        <h3>{step.title}</h3>
                        <Markdown source={step.body} className="mb-muted" />
                    </li>
                ))}
            </ol>
        </section>
    );
}

export function Comparison({ title, body, minab, sql, href }: { title: string; body: string; minab: string; sql?: string; href: string }) {
    return (
        <section className="mb-section">
            <SectionHeader title={title} body={body} />
            <div className="mb-comparison">
                <CodeBlock
                    code={minab
                        .split('\n')
                        .filter(l => !l.trimStart().startsWith('//'))
                        .join('\n')
                        .trim()}
                    caption="Minab"
                />
                <div className="mb-comparison-arrow" aria-hidden="true">
                    <Icon name="chevron-right" size={20} />
                </div>
                <CodeBlock code={sql ?? 'Compiling…'} language="sql" caption="PostgreSQL" wrap />
            </div>
            <Link className="mb-link-button" to={href}>
                Open it and change something →
            </Link>
        </section>
    );
}

export function FeatureGrid({ features }: { features: ReadonlyArray<{ icon: string; title: string; body: string }> }) {
    return (
        <section className="mb-section">
            <ul className="mb-feature-grid">
                {features.map(f => (
                    <li key={f.title} className="mb-feature">
                        <Icon name={f.icon as IconName} size={20} />
                        <h3>{f.title}</h3>
                        <Markdown source={f.body} className="mb-muted" />
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function CtaBand({
    title,
    body,
    primary,
    secondary
}: {
    title: string;
    body: string;
    primary: { label: string; to: string };
    secondary: { label: string; to: string };
}) {
    return (
        <section className="mb-cta">
            <h2>{title}</h2>
            <p>{body}</p>
            <div className="mb-row">
                <Link className="mb-button" data-variant="primary" data-size="lg" to={primary.to}>
                    {primary.label}
                </Link>
                <Link className="mb-button" data-variant="secondary" data-size="lg" to={secondary.to}>
                    {secondary.label}
                </Link>
            </div>
        </section>
    );
}

export function Footer({
    author,
    authorUrl,
    links,
    note
}: {
    author: string;
    authorUrl: string;
    links: ReadonlyArray<{ label: string; href: string }>;
    note: string;
}) {
    return (
        <footer className="mb-footer">
            <p>
                Minab — designed and built by{' '}
                {authorUrl ? (
                    <a href={authorUrl} target="_blank" rel="noreferrer">
                        {author}
                    </a>
                ) : (
                    author
                )}
                .
            </p>
            <nav aria-label="Project links">
                {links.map(l => (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                        {l.label} <Icon name="external" size={12} />
                    </a>
                ))}
            </nav>
            <p className="mb-muted">{note}</p>
        </footer>
    );
}
