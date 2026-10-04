/**
 * The Console tab: the lines a program logged with `LOG(value, label?)`, in order.
 * Hovering a line highlights the `LOG` call in the editor; clicking selects it.
 * Wireframe style only (W2 restyles it).
 */

import type { Range, RunReport } from '../../engine/protocol.js';
import { EmptyState } from '../primitives/primitives.js';

export interface ConsoleViewProps {
    report?: RunReport;
    /** Hovering or focusing a line: highlight its source span (undefined clears). */
    onHighlight: (range: Range | undefined) => void;
    /** Clicking a line: select its source span in the editor. */
    onReveal: (range: Range) => void;
}

export function ConsoleView({ report, onHighlight, onReveal }: ConsoleViewProps) {
    if (!report) return <EmptyState icon="code" title="Run the program to see its logs" />;
    if (report.stage === 'parse' || report.stage === 'check' || report.stage === 'config') {
        return (
            <EmptyState icon="alert" title="Nothing ran">
                Fix the problems first — nothing is executed until the program checks.
            </EmptyState>
        );
    }
    if (report.logs.length === 0) {
        return (
            <EmptyState icon="code" title="No logs">
                Wrap a value in <code className="mb-inline-code">LOG(value, "label")</code> to see it here. A LOG inside a query runs in the database and prints
                nothing.
            </EmptyState>
        );
    }
    return (
        <div className="mb-console">
            <ol className="mb-console-lines" aria-label="Logs">
                {report.logs.map(entry => {
                    const range = entry.range;
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
                                {range && <span className="mb-muted mb-console-pos">{`${range.start.line + 1}:${range.start.character + 1}`}</span>}
                                <code className="mb-console-text">{entry.message}</code>
                            </button>
                        </li>
                    );
                })}
            </ol>
            {report.logsTruncated && <p className="mb-muted">More logs were made than the limit allows. The rest were dropped.</p>}
        </div>
    );
}
