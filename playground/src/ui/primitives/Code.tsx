import { Marked } from 'marked';
import { useMemo, useState, type ReactNode } from 'react';
import { highlightMinab, highlightSql, type Span } from '../../syntax/highlight.js';
import { IconButton } from './primitives.js';

function tokenClass(type: string): string {
    return `tok tok-${type.replace('.', '-')}`;
}

function renderLines(lines: Span[][]): ReactNode {
    return lines.map((line, index) => (
        <span className="mb-code-line" key={index}>
            {line.map((span, i) =>
                span.type === 'whitespace' ? (
                    span.text
                ) : (
                    <span key={i} className={tokenClass(span.type)}>
                        {span.text}
                    </span>
                )
            )}
            {'\n'}
        </span>
    ));
}

export interface CodeBlockProps {
    code: string;
    language?: 'minab' | 'sql' | 'plain';
    /** Shows a copy button. */
    copyable?: boolean;
    /** Wraps long lines instead of scrolling. */
    wrap?: boolean;
    caption?: ReactNode;
    className?: string;
}

/** Highlighted, read-only code. For editable code, use the Monaco `CodeEditor`. */
export function CodeBlock({ code, language = 'minab', copyable, wrap, caption, className }: CodeBlockProps) {
    const lines = useMemo(() => {
        const trimmed = code.replace(/\n+$/, '');
        if (language === 'plain') return [[{ text: trimmed, type: 'identifier' as const }]];
        return language === 'sql' ? highlightSql(trimmed) : highlightMinab(trimmed);
    }, [code, language]);
    const [copied, setCopied] = useState(false);
    const [wrapped, setWrapped] = useState(false);
    const copyButton = copyable && (
        <IconButton
            className="mb-code-copy"
            size="sm"
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Copied' : 'Copy'}
            onClick={() => {
                void navigator.clipboard?.writeText(code).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                });
            }}
        />
    );
    return (
        <figure
            className={`mb-code${className ? ` ${className}` : ''}`}
            data-language={language}
            data-wrap={wrap ? 'true' : undefined}
            data-wrapped={wrapped ? 'true' : undefined}
        >
            {caption ? (
                <div className="mb-code-bar">
                    <figcaption className="mb-code-caption">{caption}</figcaption>
                    <span className="mb-code-tools">
                        {copyable && !wrap && <IconButton size="sm" icon="panel" label="Wrap lines" pressed={wrapped} onClick={() => setWrapped(w => !w)} />}
                        {copyButton}
                    </span>
                </div>
            ) : null}
            <pre>
                <code>{renderLines(lines)}</code>
            </pre>
            {!caption && copyButton}
        </figure>
    );
}

/** Plain text where `backticked` spans render as highlighted inline code — for titles and one-liners. */
export function Inline({ text }: { text: string }) {
    const parts = text.split(/(`[^`]+`)/g);
    return (
        <>
            {parts.map((part, i) =>
                part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <InlineCode key={i}>{part.slice(1, -1)}</InlineCode> : part
            )}
        </>
    );
}

/** Inline code with Minab highlighting (`.status`, `#Booking`). */
export function InlineCode({ children }: { children: string }) {
    const spans = highlightMinab(children)[0] ?? [];
    return (
        <code className="mb-inline-code">
            {spans.map((s, i) => (
                <span key={i} className={tokenClass(s.type)}>
                    {s.text}
                </span>
            ))}
        </code>
    );
}

const markdown = new Marked({
    gfm: true,
    renderer: {
        code({ text, lang }) {
            const lines = lang === 'sql' ? highlightSql(text) : highlightMinab(text);
            const html = lines
                .map(line =>
                    line.map(s => (s.type === 'whitespace' ? escapeHtml(s.text) : `<span class="${tokenClass(s.type)}">${escapeHtml(s.text)}</span>`)).join('')
                )
                .join('\n');
            return `<figure class="mb-code" data-language="${lang ?? 'minab'}"><pre><code>${html}</code></pre></figure>`;
        },
        codespan({ text }) {
            const raw = unescapeHtml(text);
            const spans = highlightMinab(raw)[0] ?? [];
            return `<code class="mb-inline-code">${spans.map(s => `<span class="${tokenClass(s.type)}">${escapeHtml(s.text)}</span>`).join('')}</code>`;
        },
        link({ href, text }) {
            const external = /^https?:/.test(href);
            return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${text}</a>`;
        }
    }
});

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unescapeHtml(text: string): string {
    return text
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/** Renders trusted, repository-authored Markdown (lessons, example notes, cheat-sheet prose). */
export function Markdown({ source, className }: { source: string; className?: string }) {
    const html = useMemo(() => markdown.parse(source, { async: false }) as string, [source]);
    return <div className={`mb-prose${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
