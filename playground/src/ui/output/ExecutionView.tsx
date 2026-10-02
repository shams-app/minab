/**
 * The Execution tab — the hybrid execution map.
 *
 * Minab doesn't send a rule to the database wholesale: it answers what it
 * can from the record in memory and pushes down only the smallest
 * table-touching pieces. This view lists what reached Postgres, and
 * hovering an entry highlights the source span it was compiled from.
 */

import type { Range, RunReport, TraceEntry } from '../../engine/protocol.js';
import { prettySql } from '../../syntax/highlight.js';
import { CodeBlock } from '../primitives/Code.js';
import { Badge, EmptyState } from '../primitives/primitives.js';
import { Icon } from '../primitives/Icon.js';
import { ParamsTable } from './SqlView.js';
import { formatCell } from './ResultView.js';

export interface ExecutionViewProps {
    report?: RunReport;
    /** Hovering or focusing an entry: highlight its source span (undefined clears). */
    onHighlight: (range: Range | undefined) => void;
    /** Clicking an entry's origin: select it in the editor. */
    onReveal: (range: Range) => void;
}

function summary(report: RunReport): string {
    const n = report.trace.length;
    const kind = report.program.kind;
    if (kind === 'query') return n === 1 ? 'The whole query ran as one statement in Postgres.' : `${n} statements reached Postgres.`;
    if (n === 0) return 'Nothing reached the database: every part of this program was answered in memory.';
    const rest =
        kind === 'record-rule' || kind === 'field-rule' ? 'everything else was answered from the record in memory' : 'everything else was evaluated in memory';
    return `${n} statement${n === 1 ? '' : 's'} reached Postgres; ${rest}.`;
}

function TraceItem({ entry, onHighlight, onReveal }: { entry: TraceEntry } & Pick<ExecutionViewProps, 'onHighlight' | 'onReveal'>) {
    const origin = entry.origin;
    return (
        <li
            className="mb-trace-item"
            data-state={entry.error ? 'error' : 'ok'}
            onMouseEnter={() => origin && onHighlight(origin.range)}
            onMouseLeave={() => onHighlight(undefined)}
            onFocus={() => origin && onHighlight(origin.range)}
            onBlur={() => onHighlight(undefined)}
            tabIndex={0}
        >
            <div className="mb-trace-head">
                <Badge tone="pushdown">
                    <Icon name="database" size={12} /> Statement {entry.index}
                </Badge>
                <span className="mb-muted">
                    {entry.rowCount} row{entry.rowCount === 1 ? '' : 's'} · {entry.durationMs.toFixed(1)} ms
                </span>
            </div>
            {origin && (
                <button type="button" className="mb-trace-origin" onClick={() => onReveal(origin.range)} title="Select in the editor">
                    <span className="mb-muted">from</span> <CodeBlock code={origin.text.replace(/\s+/g, ' ')} language="minab" />
                </button>
            )}
            <CodeBlock code={prettySql(entry.text)} language="sql" copyable wrap />
            <ParamsTable params={entry.params} />
            {entry.error ? (
                <p className="mb-trace-error">{entry.error}</p>
            ) : entry.preview.length > 0 && entry.columns.length === 1 && entry.columns[0] === 'value' ? (
                <p className="mb-muted">
                    returned <code className="mb-inline-code">{formatCell(entry.preview[0].value)}</code>
                </p>
            ) : null}
        </li>
    );
}

export function ExecutionView({ report, onHighlight, onReveal }: ExecutionViewProps) {
    if (!report) return <EmptyState icon="layers" title="Run the program to see how it executes" />;
    if (report.stage === 'parse' || report.stage === 'check' || report.stage === 'config') {
        return (
            <EmptyState icon="alert" title="Nothing ran">
                Fix the problems first — nothing is executed until the program checks.
            </EmptyState>
        );
    }
    return (
        <div className="mb-execution">
            <div className="mb-execution-summary">
                <p>{summary(report)}</p>
                <dl className="mb-timings">
                    <div>
                        <dt>parse</dt>
                        <dd>{report.timings.parseMs.toFixed(1)} ms</dd>
                    </div>
                    <div>
                        <dt>check</dt>
                        <dd>{report.timings.checkMs.toFixed(1)} ms</dd>
                    </div>
                    <div>
                        <dt>run</dt>
                        <dd>{report.runMs.toFixed(1)} ms</dd>
                    </div>
                </dl>
            </div>
            {report.trace.length > 0 ? (
                <ol className="mb-trace">
                    {report.trace.map(entry => (
                        <TraceItem key={entry.index} entry={entry} onHighlight={onHighlight} onReveal={onReveal} />
                    ))}
                </ol>
            ) : (
                <EmptyState icon="bolt" title="0 statements">
                    {report.program.kind === 'record-rule' || report.program.kind === 'field-rule'
                        ? 'The rule was settled from the record alone. Try a preset that needs the database, or add a check against another table (#Table[…]).'
                        : 'This program doesn’t read any table.'}
                </EmptyState>
            )}
            <p className="mb-muted mb-execution-legend">
                <span className="mb-legend-swatch" data-kind="pushdown" /> Underlined in the editor: the parts that became SQL.
            </p>
        </div>
    );
}
