/**
 * Plain-text renderings of what a program produced: SQL with its
 * parameters, and a result as a table or JSON. The CLI prints these; the
 * web playground offers the same text for copying, so what a user pastes
 * from either is identical.
 */

import type { SqlQuery } from '../language/minab-executor.js';

/** SQL, then its parameters as SQL comments — so the whole block can be pasted into psql and edited, not just read. */
export function formatSql(query: SqlQuery): string {
    if (query.params.length === 0) return query.text;
    const params = query.params.map((value, index) => `--   $${index + 1} = ${JSON.stringify(value) ?? 'null'}`);
    return `${query.text}\n-- parameters\n${params.join('\n')}`;
}

/**
 * A validation rule answers with one value; a pipeline query answers with
 * rows. Printing rows as a table rather than as JSON is the difference
 * between reading a result and parsing one.
 */
export function formatValue(value: unknown): string {
    if (Array.isArray(value) && value.length > 0 && value.every(isPlainRow)) {
        return formatTable(value as Record<string, unknown>[]);
    }
    if (Array.isArray(value) && value.length === 0) return '(no rows)';
    return JSON.stringify(value ?? null, null, 2);
}

function isPlainRow(value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatTable(rows: Record<string, unknown>[]): string {
    const columns: string[] = [];
    for (const row of rows) {
        for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    }
    const cells = rows.map(row => columns.map(column => renderCell(row[column])));
    const widths = columns.map((column, index) =>
        Math.max(column.length, ...cells.map(row => row[index].length))
    );
    const line = (values: string[]) => values.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
    return [
        line(columns),
        widths.map(w => '-'.repeat(w)).join('  '),
        ...cells.map(line)
    ].join('\n');
}

function renderCell(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
