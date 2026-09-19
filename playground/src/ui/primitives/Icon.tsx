/**
 * A small stroke icon set for the wireframe. Replace freely during the
 * design handoff — components only ever refer to icons by `name`.
 */

export type IconName =
    | 'play' | 'share' | 'copy' | 'check' | 'x' | 'alert' | 'info' | 'database' | 'book' | 'grid'
    | 'sun' | 'moon' | 'monitor' | 'chevron-right' | 'chevron-left' | 'chevron-down' | 'external' | 'github'
    | 'spark' | 'reset' | 'download' | 'search' | 'command' | 'bolt' | 'layers' | 'tree' | 'table'
    | 'code' | 'lock' | 'eye' | 'menu' | 'panel' | 'flag' | 'lightbulb' | 'circle' | 'dot';

const PATHS: Record<IconName, string> = {
    play: 'M7 5v14l11-7z',
    share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    check: 'M5 12l5 5L20 7',
    x: 'M6 6l12 12M18 6L6 18',
    alert: 'M12 3l10 18H2zM12 10v4M12 17.5v.5',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5v.5',
    database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    book: 'M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 0 2 2h14',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
    'chevron-right': 'M9 6l6 6-6 6',
    'chevron-left': 'M15 6l-6 6 6 6',
    'chevron-down': 'M6 9l6 6 6-6',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    github: 'M9 19c-4 1.5-4-2-6-2.5M15 22v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V22',
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
    reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
    download: 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2M7 11l5 5 5-5M12 4v12',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
    command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    layers: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
    tree: 'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
    table: 'M3 5h18v14H3zM3 10h18M9 10v9',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    menu: 'M3 6h18M3 12h18M3 18h18',
    panel: 'M3 4h18v16H3zM3 15h18',
    flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
    lightbulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
    circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    dot: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'
};

export interface IconProps {
    name: IconName;
    size?: number;
    /** Omit for decorative icons (the default); set when the icon alone carries meaning. */
    label?: string;
    className?: string;
}

export function Icon({ name, size = 16, label, className }: IconProps) {
    return (
        <svg
            className={className ? `mb-icon ${className}` : 'mb-icon'}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            role={label ? 'img' : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
            data-icon={name}
        >
            <path d={PATHS[name]} fill={name === 'play' || name === 'dot' ? 'currentColor' : 'none'} />
        </svg>
    );
}
