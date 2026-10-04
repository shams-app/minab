/**
 * Signatures and one-line docs for the built-ins. The checker's table
 * (`src/language/minab-builtins.ts`) has the rules, not the prose.
 * `parseSignature` cuts a signature into its parameters for signature help.
 */

/** Signatures and one-line docs for the built-ins. */
export const BUILTIN_DOCS: Record<string, { signature: string; doc: string }> = {
    COUNT: {
        signature: 'COUNT(collection<T>) → INTEGER',
        doc: 'How many rows (or array elements) the collection holds.'
    },
    SUM: {
        signature: 'SUM(collection<N>) → N',
        doc: 'Adds up a numeric column spread across a collection — `SUM(.orders.total)`.'
    },
    AVG: {
        signature: 'AVG(collection<N>) → DECIMAL',
        doc: 'The mean of a numeric column across a collection.'
    },
    MIN: {
        signature: 'MIN(collection<T>) → T',
        doc: 'The smallest value of an orderable column across a collection.'
    },
    MAX: {
        signature: 'MAX(collection<T>) → T',
        doc: 'The largest value of an orderable column across a collection.'
    },
    EXISTS: {
        signature: 'EXISTS(collection<T>) → BOOLEAN',
        doc: 'Whether the collection has at least one row — pushed down as one `SELECT EXISTS`.'
    },
    ALL: {
        signature: 'ALL(collection<BOOLEAN>) → BOOLEAN',
        doc: 'True when every value is true.'
    },
    ANY: {
        signature: 'ANY(collection<BOOLEAN>) → BOOLEAN',
        doc: 'True when at least one value is true.'
    },
    LOWER: {
        signature: 'LOWER(s: TEXT) → TEXT',
        doc: 'The text in lower case. `null` gives `null`.'
    },
    UPPER: {
        signature: 'UPPER(s: TEXT) → TEXT',
        doc: 'The text in upper case. `null` gives `null`.'
    },
    TRIM: {
        signature: 'TRIM(s: TEXT) → TEXT',
        doc: 'Removes spaces, tabs and line breaks at both ends.'
    },
    LENGTH: {
        signature: 'LENGTH(s: TEXT) → INTEGER',
        doc: 'The number of characters (Unicode code points): `LENGTH("😀")` is `1`.'
    },
    SUBSTRING: {
        signature: 'SUBSTRING(s: TEXT, start: INTEGER, length?: INTEGER) → TEXT',
        doc: 'Part of the text. `start` counts from 1. Without `length`, it reads to the end.'
    },
    REPLACE: {
        signature: 'REPLACE(s: TEXT, from: TEXT, to: TEXT) → TEXT',
        doc: 'Replaces every match of `from` with `to`.'
    },
    STARTS_WITH: {
        signature: 'STARTS_WITH(s: TEXT, part: TEXT) → BOOLEAN',
        doc: 'Whether the text starts with `part`. Ignores case for `CITEXT`. `%` and `_` are plain characters.'
    },
    ENDS_WITH: {
        signature: 'ENDS_WITH(s: TEXT, part: TEXT) → BOOLEAN',
        doc: 'Whether the text ends with `part`. Ignores case for `CITEXT`.'
    },
    CONTAINS: {
        signature: 'CONTAINS(s: TEXT, part: TEXT) → BOOLEAN',
        doc: 'Whether the text has `part` inside. Ignores case for `CITEXT`.'
    },
    COALESCE: {
        signature: 'COALESCE(a: T, b: T, …) → T',
        doc: 'The first value that is not `null`. Not nullable when any argument is not nullable.'
    },
    ROUND: {
        signature: 'ROUND(n: N, digits?: INTEGER) → N',
        doc: 'Rounds half away from zero: `ROUND(2.5)` is `3`, `ROUND(-2.5)` is `-3`. `digits` defaults to 0.'
    },
    ABS: { signature: 'ABS(n: N) → N', doc: 'The value without its sign.' },
    FLOOR: {
        signature: 'FLOOR(n: N) → INTEGER',
        doc: 'Rounds down to a whole number.'
    },
    CEIL: {
        signature: 'CEIL(n: N) → INTEGER',
        doc: 'Rounds up to a whole number.'
    },
    GREATEST: {
        signature: 'GREATEST(a: T, b: T, …) → T',
        doc: 'The largest value. `null` arguments are ignored; the answer is `null` only when all are.'
    },
    LEAST: {
        signature: 'LEAST(a: T, b: T, …) → T',
        doc: 'The smallest value. `null` arguments are ignored; the answer is `null` only when all are.'
    },
    NOW: {
        signature: 'NOW() → DATETIME',
        doc: 'The instant the run started. Every `NOW()` in one run is the same. In SQL it is a parameter, not the database clock.'
    },
    TODAY: {
        signature: 'TODAY() → DATE',
        doc: 'The date of `NOW()` in the time zone of the run.'
    },
    YEAR: {
        signature: 'YEAR(d: DATE | DATETIME) → INTEGER',
        doc: 'The year. A `DATETIME` is read in the time zone of the run.'
    },
    MONTH: {
        signature: 'MONTH(d: DATE | DATETIME) → INTEGER',
        doc: 'The month, 1 to 12. A `DATETIME` is read in the time zone of the run.'
    },
    DAY: {
        signature: 'DAY(d: DATE | DATETIME) → INTEGER',
        doc: 'The day of the month. A `DATETIME` is read in the time zone of the run.'
    },
    HOUR: {
        signature: 'HOUR(t: TIME | DATETIME) → INTEGER',
        doc: 'The hour, 0 to 23. A `DATETIME` is read in the time zone of the run.'
    },
    MINUTE: {
        signature: 'MINUTE(t: TIME | DATETIME) → INTEGER',
        doc: 'The minute, 0 to 59. A `DATETIME` is read in the time zone of the run.'
    },
    DATE_ADD: {
        signature: 'DATE_ADD(d: DATE | DATETIME, n: INTEGER, unit: "year" | "month" | "week" | "day" | "hour" | "minute" | "second") → same type as d',
        doc: 'Adds `n` units (may be negative). Month ends clamp: Jan 31 + 1 month is Feb 28. Hours, minutes and seconds are for a `DATETIME` only. The unit is a text literal.'
    },
    DATE_DIFF: {
        signature: 'DATE_DIFF(a: DATE | DATETIME, b: DATE | DATETIME, unit: "year" | "month" | "week" | "day" | "hour" | "minute" | "second") → INTEGER',
        doc: 'Whole units from `b` to `a`, truncated toward zero. Both are `DATE` or both are `DATETIME`. The unit is a text literal.'
    },
    LOG: {
        signature: 'LOG(value: V, label?: TEXT) → V',
        doc: 'Records the value as a log line and gives it back unchanged. In a part that runs as SQL it prints nothing.'
    }
};

/** One parameter of a signature, as written: `s: TEXT`, `length?: INTEGER` or `…`. */
export function parseSignature(signature: string): { name: string; parameters: string[] } | undefined {
    const open = signature.indexOf('(');
    if (open < 0) return undefined;
    // The closing bracket that matches the first one. A type can hold `(`? No, but a text literal can.
    let depth = 0;
    let inText = false;
    let close = -1;
    for (let i = open; i < signature.length; i++) {
        const c = signature[i];
        if (c === '"') inText = !inText;
        else if (!inText && c === '(') depth++;
        else if (!inText && c === ')' && --depth === 0) {
            close = i;
            break;
        }
    }
    if (close < 0) return undefined;
    const inside = signature.slice(open + 1, close);
    const parameters: string[] = [];
    let current = '';
    inText = false;
    for (const c of inside) {
        if (c === '"') inText = !inText;
        if (c === ',' && !inText) {
            parameters.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    if (current.trim()) parameters.push(current.trim());
    return { name: signature.slice(0, open), parameters };
}
