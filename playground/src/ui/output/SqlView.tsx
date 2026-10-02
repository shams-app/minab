/**
 * The SQL tab: the one statement a query compiles to — or, for a rule, why
 * there is no single statement, plus the statements the last run sent.
 */

import type { AnalyzeReport, TraceEntry } from '../../engine/protocol.js';
import { prettySql } from '../../syntax/highlight.js';
import { CodeBlock } from '../primitives/Code.js';
import { Callout, EmptyState } from '../primitives/primitives.js';
import { formatCell } from './ResultView.js';

export function ParamsTable({ params }: { params: unknown[] }) {
    if (params.length === 0) return null;
    return (
        <table className="mb-table mb-params" aria-label="Parameters">
            <thead>
                <tr>
                    <th scope="col">Parameter</th>
                    <th scope="col">Value</th>
                </tr>
            </thead>
            <tbody>
                {params.map((p, i) => (
                    <tr key={i}>
                        <td>
                            <code className="mb-inline-code">
                                <span className="tok tok-sigil-field">${i + 1}</span>
                            </code>
                        </td>
                        <td>{formatCell(p)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export interface SqlViewProps {
    analysis?: AnalyzeReport;
    /** Statements from the last run, shown when the program has no single SQL form. */
    trace: TraceEntry[];
    onShowExecution: () => void;
}

export function SqlView({ analysis, trace, onShowExecution }: SqlViewProps) {
    if (!analysis) return <EmptyState icon="code" title="Compiling…" />;
    const compiled = analysis.compiled;
    if (compiled.ok) {
        return (
            <div className="mb-sql">
                <p className="mb-muted">The whole program compiles to one parameterized PostgreSQL statement — this is exactly what runs.</p>
                <CodeBlock code={prettySql(compiled.text)} language="sql" copyable caption="Compiled SQL" wrap />
                <ParamsTable params={compiled.params} />
            </div>
        );
    }
    return (
        <div className="mb-sql">
            <Callout tone={compiled.pushesDown ? 'pushdown' : 'info'} icon={compiled.pushesDown ? 'layers' : 'info'} title="No single SQL statement">
                <p>{compiled.reason}</p>
                {compiled.detail && <p className="mb-muted">Compiler: {compiled.detail}</p>}
            </Callout>
            {compiled.pushesDown && trace.length > 0 && (
                <>
                    <p className="mb-muted">What the last run sent:</p>
                    {trace.map(entry => (
                        <div key={entry.index}>
                            <CodeBlock code={prettySql(entry.text)} language="sql" copyable caption={`Statement ${entry.index}`} wrap />
                            <ParamsTable params={entry.params} />
                        </div>
                    ))}
                    <button type="button" className="mb-link-button" onClick={onShowExecution}>
                        See where each statement came from →
                    </button>
                </>
            )}
        </div>
    );
}
