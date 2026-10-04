/**
 * The Console tab: the lines a program logged with `LOG(value, label?)`, in order.
 * A row is a label (muted), the value (colored by its kind) and `line:col`.
 * Hovering a row highlights the `LOG` call in the editor; clicking selects it.
 */

import type { LogEntry, Range, RunReport } from '../../engine/protocol.js';
import { EmptyState } from '../primitives/primitives.js';

export interface ConsoleViewProps {
    report?: RunReport;
    /** Hovering or focusing a line: highlight its source span (undefined clears). */
    onHighlight: (range: Range | undefined) => void;
    /** Clicking a line: select its source span in the editor. */
    onReveal: (range: Range) => void;
}

/** Split `label: value` into its parts; a line without a label is all value. */
function splitMessage(entry: LogEntry): { label?: string; value: string } {
    const prefix = entry.label !== undefined ? `${entry.label}: ` : undefined;
    if (prefix && entry.message.startsWith(prefix)) return { label: entry.label, value: entry.message.slice(prefix.length) };
    return { value: entry.message };
}

/** Which syntax color a logged value gets. */
function valueKind(value: string): 'number' | 'string' | 'constant' | 'plain' {
    if (/^-?\d[\d.,e+-]*$/i.test(value)) return 'number';
    if (value.startsWith('"') || value.startsWith("'")) return 'string';
    if (/^(true|false|null)$/.test(value)) return 'constant';
    return 'plain';
}

export function ConsoleView({ report, onHighlight, onReveal }: ConsoleViewProps) {
    if (!report) return <EmptyState glyph="LOG()" title="Run the program to see its logs" />;
    if (report.stage === 'parse' || report.stage === 'check' || report.stage === 'config') {
        return (
            <EmptyState icon="alert" title="Nothing ran">
                Fix the problems first — nothing is executed until the program checks.
            </EmptyState>
        );
    }
    if (report.logs.length === 0) {
        return (
            <EmptyState glyph="LOG()" title="No log lines">
                Wrap a value in <code className="mb-inline-code">LOG(value, "label")</code> to see it here. A LOG inside a query runs in the database and prints
                nothing.
            </EmptyState>
        );
    }
    const count = report.logs.length;
    return (
        <div className="mb-console">
            <p className="mb-console-meta">
                {count} line{count === 1 ? '' : 's'}, in evaluation order
            </p>
            <ol className="mb-console-lines" aria-label="Logs">
                {report.logs.map(entry => {
                    const range = entry.range;
                    const { label, value } = splitMessage(entry);
                    return (
                        <li key={entry.index}>
                            <button
                                type="button"
                                className="mb-console-line"
                                disabled={!range}
                                onClick={() => range && onReveal(range)}
                                onMouseEnter={() => range && onHighlight(range)}
                                onMouseLeave={() => onHighlight(undefined)}
                                onFocus={() => range && onHighlight(range)}
                                onBlur={() => onHighlight(undefined)}
                                title={range ? 'Select in the editor' : undefined}
                            >
                                <span className="mb-console-label">{label ?? ''}</span>
                                <code className="mb-console-text" data-kind={valueKind(value)}>
                                    {value}
                                </code>
                                {range && <span className="mb-muted mb-console-pos">{`${range.start.line + 1}:${range.start.character + 1}`}</span>}
                            </button>
                        </li>
                    );
                })}
            </ol>
            {report.logsTruncated && <p className="mb-muted">More logs were made than the limit allows. The rest were dropped.</p>}
        </div>
    );
}
