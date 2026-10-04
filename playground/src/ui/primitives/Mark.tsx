/**
 * The Minab mark ("Three petals", W1 board 01b): an M, a shield and a check
 * mark, drawn as a tulip. A stroke drawing in `currentColor`. The stroke grows
 * as the mark shrinks, and the middle petal is dropped at 32 px and below.
 */

const SIDE_LEFT = 'M24 20 C16 44 16 72 24 92 C34 112 46 122 60 130';
const TOP = 'M24 20 C36 34 50 46 60 58 C70 46 84 34 96 20';
const PETAL = 'M47 45 C52 38 56 32 60 26 C64 32 68 38 73 45';
const CHECK = 'M96 20 C104 42 102 62 90 76 L62 104 L46 88';
const SIDE_RIGHT = 'M102 86 C99 106 84 120 60 130';

function strokeFor(size: number): number {
    if (size <= 16) return 18;
    if (size <= 32) return 14;
    if (size <= 64) return 11;
    return 8;
}

export function Mark({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg
            className={className ? `mb-mark ${className}` : 'mb-mark'}
            width={(size * 120) / 140}
            height={size}
            viewBox="0 0 120 140"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeFor(size)}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={SIDE_LEFT} />
            <path d={TOP} />
            {size > 32 && <path d={PETAL} />}
            <path d={CHECK} />
            <path d={SIDE_RIGHT} />
        </svg>
    );
}
