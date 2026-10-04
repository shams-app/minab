/**
 * Landing-page sections. Each takes its words as props (from
 * `content/landing.ts`) and any live data from the page.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CodeBlock, Inline, Markdown } from '../primitives/Code.js';
import { Icon, type IconName } from '../primitives/Icon.js';
import { Mark } from '../primitives/Mark.js';
import { Badge, Tabs } from '../primitives/primitives.js';

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
    /** The Postgres dot on the tab bar. */
    database: 'starting' | 'ready';
    /** The footer line, for example "5 rows · 1 statement · 3.4 ms". Empty while loading. */
    meta?: string;
}

export function HeroDemo({ tabs, active, onSelect, caption, source, output, openHref, database, meta }: HeroDemoProps) {
    return (
        <div className="mb-hero-card">
            <div className="mb-hero-tabbar">
                <Tabs idPrefix="hero" ariaLabel="Demo" size="sm" tabs={tabs} active={active} onChange={onSelect} />
                <span className="mb-hero-db" data-state={database} role="status">
                    <span className="mb-status-dot" aria-hidden="true" />
                    {database === 'ready' ? 'Postgres ready' : 'Starting Postgres…'}
                </span>
            </div>
            <div className="mb-hero-card-body" id="hero-panel" role="tabpanel">
                <p className="mb-hero-caption">
                    <Inline text={caption} />
                </p>
                <CodeBlock code={stripComments(source)} className="mb-hero-code" />
                <div className="mb-hero-output">{output}</div>
                <div className="mb-hero-foot">
                    <span className="mb-muted mb-mono">{meta}</span>
                    <Link className="mb-link-button" to={openHref}>
                        Open in the playground →
                    </Link>
                </div>
            </div>
        </div>
    );
}

/** The hero's loading state: a spinner line, a progress bar, the size note and shimmer lines. */
export function DemoLoading() {
    return (
        <div className="mb-demo-loading" role="status">
            <p className="mb-demo-loading-title">
                <span className="mb-spinner" aria-hidden="true" /> Starting PostgreSQL in your browser…
            </p>
            <div className="mb-demo-progress" aria-hidden="true">
                <span />
            </div>
            <p className="mb-muted">About 3.5 MB, once. Later runs are instant.</p>
            <div className="mb-shimmer" aria-hidden="true">
                <span style={{ width: '88%' }} />
                <span style={{ width: '64%' }} />
                <span style={{ width: '76%' }} />
            </div>
        </div>
    );
}

function stripComments(source: string): string {
    return source
        .split('\n')
        .filter(l => !l.trimStart().startsWith('//'))
        .join('\n')
        .trim();
}

export function SectionHeader({ title, body }: { title: string; body?: string }) {
    return (
        <header className="mb-section-head">
            <h2>{title}</h2>
            {body && <Markdown source={body} className="mb-section-lead" />}
        </header>
    );
}

/** The h1 of a document page: gallery, reference. */
export function PageHeader({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
    return (
        <header className="mb-page-head">
            <div>
                <h1>{title}</h1>
                {body && <Markdown source={body} className="mb-page-lead" />}
            </div>
            {action}
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
    cards: Array<{ title: string; badge: string; body: string; source: string; href: string }>;
}) {
    return (
        <section className="mb-section">
            <SectionHeader title={title} body={body} />
            <div className="mb-layer-grid">
                {cards.map(card => (
                    <article className="mb-layer-card" key={card.title}>
                        <header>
                            <h3>{card.title}</h3>
                            <Badge tone="neutral">{card.badge}</Badge>
                        </header>
                        <Markdown source={card.body} className="mb-layer-body" />
                        <CodeBlock code={stripComments(card.source)} />
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
        <div className="mb-sigil-section">
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
        </div>
    );
}

export interface HowItRunsProps {
    title: string;
    steps: ReadonlyArray<{ title: string; body: string }>;
    /** The dashed diagram under the steps (hidden on phones): a rule, and the one statement it sent. */
    diagram?: { rule: string; sql?: string; verdict?: string };
}

export function HowItRuns({ title, steps, diagram }: HowItRunsProps) {
    return (
        <section className="mb-section">
            <SectionHeader title={title} />
            <ol className="mb-steps">
                {steps.map((step, i) => (
                    <li key={step.title} className="mb-step">
                        <span className="mb-step-number">{String(i + 1).padStart(2, '0')}</span>
                        <h3>{step.title}</h3>
                        <Markdown source={step.body} className="mb-step-body" />
                    </li>
                ))}
            </ol>
            {diagram && (
                <figure className="mb-run-diagram" aria-label="One rule, two paths">
                    <CodeBlock code={stripComments(diagram.rule)} className="mb-run-rule" />
                    <div className="mb-run-branches">
                        <div className="mb-run-branch">
                            <p className="mb-label">In memory</p>
                            <p className="mb-muted">Comparisons on the record: no database needed.</p>
                        </div>
                        <div className="mb-run-branch" data-pushdown="true">
                            <p className="mb-label">
                                <span aria-hidden="true">⇣</span> Pushed down
                            </p>
                            <p className="mb-muted">Only the part that touches a table.</p>
                        </div>
                    </div>
                    {diagram.sql && <CodeBlock code={diagram.sql} language="sql" wrap className="mb-run-sql" />}
                    {diagram.verdict && <p className="mb-run-verdict">{diagram.verdict}</p>}
                </figure>
            )}
        </section>
    );
}

export function Comparison({ title, body, minab, sql, href }: { title: string; body: string; minab: string; sql?: string; href: string }) {
    return (
        <section className="mb-section">
            <SectionHeader title={title} body={body} />
            <div className="mb-comparison">
                <CodeBlock code={stripComments(minab)} caption="Minab" />
                <div className="mb-comparison-arrow" aria-hidden="true">
                    <Icon name="chevron-right" size={20} />
                </div>
                <CodeBlock code={sql ?? 'Compiling…'} language="sql" caption="PostgreSQL · compiled live" wrap />
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
                        <span className="mb-feature-tile" aria-hidden="true">
                            <Icon name={f.icon as IconName} size={18} />
                        </span>
                        <h3>{f.title}</h3>
                        <Markdown source={f.body} className="mb-feature-body" />
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
            <div className="mb-cta-copy">
                <h2>{title}</h2>
                <p>{body}</p>
            </div>
            <div className="mb-cta-actions">
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

/** The line about the name. Its wording is approved and comes from the content file. */
export function NameBand({ text }: { text: string }) {
    return (
        <section className="mb-name-band" aria-label="About the name">
            <p>{text}</p>
        </section>
    );
}

export function Footer({
    author,
    authorUrl,
    links,
    note,
    version
}: {
    author: string;
    authorUrl: string;
    links: ReadonlyArray<{ label: string; href: string }>;
    note: string;
    /** The Minab version the site runs. */
    version: string;
}) {
    return (
        <footer className="mb-footer">
            <p className="mb-footer-credit">
                <Mark size={20} className="mb-footer-mark" />
                <span>
                    Minab — designed and built by{' '}
                    {authorUrl ? (
                        <a href={authorUrl} target="_blank" rel="noreferrer">
                            {author}
                        </a>
                    ) : (
                        author
                    )}
                    .
                </span>
            </p>
            <nav aria-label="Project links">
                {links.map(l => (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                        {l.label} <Icon name="external" size={12} />
                    </a>
                ))}
            </nav>
            <p className="mb-muted">
                {note} <span data-testid="minab-version">Minab {version}</span>
            </p>
        </footer>
    );
}
