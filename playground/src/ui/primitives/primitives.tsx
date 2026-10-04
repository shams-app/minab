/**
 * The design system's building blocks. Each is small, typed, and styled only
 * through `wireframe.css` class names that read design tokens. The props are
 * the contract (see design/contract.md).
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: 'sm' | 'md' | 'lg';
    icon?: IconName;
    /** Shows a spinner and disables the button. */
    busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'secondary', size = 'md', icon, busy, children, className, disabled, ...rest },
    ref
) {
    return (
        <button
            ref={ref}
            type="button"
            className={`mb-button${className ? ` ${className}` : ''}`}
            data-variant={variant}
            data-size={size}
            data-state={busy ? 'busy' : undefined}
            disabled={disabled || busy}
            {...rest}
        >
            {busy ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
            {children && <span>{children}</span>}
        </button>
    );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon: IconName;
    /** Required: the accessible name, also shown as a tooltip. */
    label: string;
    pressed?: boolean;
    size?: 'sm' | 'md';
}

export function IconButton({ icon, label, pressed, size = 'md', className, ...rest }: IconButtonProps) {
    return (
        <button
            type="button"
            className={`mb-icon-button${className ? ` ${className}` : ''}`}
            aria-label={label}
            title={label}
            aria-pressed={pressed}
            data-size={size}
            {...rest}
        >
            <Icon name={icon} size={size === 'sm' ? 14 : 16} />
        </button>
    );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'pushdown' | 'check-only';

export function Badge({ tone = 'neutral', children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
    return (
        <span className="mb-badge" data-tone={tone} title={title}>
            {children}
        </span>
    );
}

export interface TabItem<T extends string> {
    id: T;
    label: string;
    icon?: IconName;
    /** A count or marker shown next to the label. */
    badge?: ReactNode;
    badgeTone?: BadgeTone;
}

export interface TabsProps<T extends string> {
    tabs: TabItem<T>[];
    active: T;
    onChange: (id: T) => void;
    ariaLabel: string;
    size?: 'sm' | 'md';
    /** id prefix for aria-controls wiring */
    idPrefix: string;
}

export function Tabs<T extends string>({ tabs, active, onChange, ariaLabel, size = 'md', idPrefix }: TabsProps<T>) {
    return (
        <div className="mb-tabs" role="tablist" aria-label={ariaLabel} data-size={size}>
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`${idPrefix}-tab-${tab.id}`}
                    aria-controls={`${idPrefix}-panel`}
                    aria-selected={tab.id === active}
                    tabIndex={tab.id === active ? 0 : -1}
                    className="mb-tab"
                    data-state={tab.id === active ? 'active' : 'inactive'}
                    onClick={() => onChange(tab.id)}
                    onKeyDown={event => {
                        const index = tabs.findIndex(t => t.id === tab.id);
                        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                        if (!step) return;
                        event.preventDefault();
                        const next = tabs[(index + step + tabs.length) % tabs.length];
                        onChange(next.id);
                        document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
                    }}
                >
                    {tab.icon && <Icon name={tab.icon} size={14} />}
                    <span>{tab.label}</span>
                    {tab.badge !== undefined && tab.badge !== null && <Badge tone={tab.badgeTone}>{tab.badge}</Badge>}
                </button>
            ))}
        </div>
    );
}

export function Kbd({ keys }: { keys: string[] }) {
    return (
        <span className="mb-kbd-group">
            {keys.map(k => (
                <kbd key={k} className="mb-kbd">
                    {k}
                </kbd>
            ))}
        </span>
    );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
    return <span className="mb-spinner" style={{ width: size, height: size }} role={label ? 'status' : undefined} aria-label={label} />;
}

export interface EmptyStateProps {
    icon?: IconName;
    title: string;
    children?: ReactNode;
    action?: ReactNode;
    tone?: 'neutral' | 'danger' | 'warning' | 'check-only' | 'success';
    /** A big glyph in its sigil color (`.` for "nothing run yet"). Shown instead of the icon. */
    glyph?: ReactNode;
}

export function EmptyState({ icon, title, children, action, tone = 'neutral', glyph }: EmptyStateProps) {
    return (
        <div className="mb-empty" data-tone={tone}>
            {glyph ? (
                <span className="mb-empty-glyph" aria-hidden="true">
                    {glyph}
                </span>
            ) : (
                icon && <Icon name={icon} size={22} />
            )}
            <p className="mb-empty-title">{title}</p>
            {children && <div className="mb-empty-body">{children}</div>}
            {action && <div className="mb-empty-action">{action}</div>}
        </div>
    );
}

export function Callout({
    tone = 'info',
    icon,
    title,
    children
}: {
    tone?: 'info' | 'warning' | 'danger' | 'success' | 'check-only' | 'pushdown';
    icon?: IconName;
    title?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="mb-callout" data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}>
            {icon && <Icon name={icon} size={16} />}
            <div>
                {title && <p className="mb-callout-title">{title}</p>}
                {children && <div className="mb-callout-body">{children}</div>}
            </div>
        </div>
    );
}

/** A labelled switch for boolean settings (auto-run). */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint?: string }) {
    return (
        <label className="mb-toggle" title={hint}>
            <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
            <span className="mb-toggle-track" aria-hidden="true">
                <span className="mb-toggle-thumb" />
            </span>
            <span className="mb-toggle-label">{label}</span>
        </label>
    );
}
