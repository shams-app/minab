/**
 * The Result tab: what the program answered — rows, a verdict, a value —
 * or why it didn't: problems, a check-only construct, a runtime error.
 */

import type { ProgramKind, Row, RunReport } from '../../engine/protocol.js';
import { Badge, Button, Callout, EmptyState, Spinner } from '../primitives/primitives.js';
import { Icon } from '../primitives/Icon.js';
import { CodeBlock } from '../primitives/Code.js';

export interface ResultViewProps {
    report?: RunReport;
    running: boolean;
    /** The editor changed since this report — show it dimmed. */
    stale: boolean;
    /** What the rule was checking, for the verdict card's caption. */
    subject?: { recordTable?: string; fieldType?: string; fieldValue?: unknown; record?: Row };
    onRun: () => void;
    onShowProblems: () => void;
    onShowExecution: () => void;
}

export function formatCell(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

export function RowsTable({ columns, rows, caption }: { columns: string[]; rows: Row[]; caption?: string }) {
    if (rows.length === 0) {
        return (
            <EmptyState icon="table" title="No rows">
                The query ran and matched nothing. {columns.length > 0 && <>Columns: {columns.join(', ')}.</>}
            </EmptyState>
        );
    }
    return (
        <div className="mb-table-wrap" tabIndex={0} role="region" aria-label={caption ?? 'Query result'}>
            <table className="mb-table">
                <thead>
                    <tr>
                        <th scope="col" className="mb-table-index">
                            #
                        </th>
                        {columns.map(c => (
                            <th scope="col" key={c}>
                                {c}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i}>
                            <td className="mb-table-index">{i + 1}</td>
                            {columns.map(c => {
                                const value = row[c];
                                return (
                                    <td
                                        key={c}
                                        data-type={value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value === 'object' ? 'json' : 'text'}
                                    >
                                        {formatCell(value)}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export interface VerdictCardProps {
    value: boolean;
    kind: ProgramKind;
    subject?: ResultViewProps['subject'];
    statements: number;
    onShowExecution: () => void;
}

export function VerdictCard({ value, kind, subject, statements, onShowExecution }: VerdictCardProps) {
    const word = value ? 'Passes' : kind === 'field-rule' ? 'Rejected' : 'Fails';
    const what =
        kind === 'field-rule' ? (
            <>
                The value <code className="mb-inline-code">{JSON.stringify(subject?.fieldValue)}</code> {value ? 'is valid' : 'is rejected'}
                {subject?.recordTable ? (
                    <>
                        {' '}
                        for <strong>{subject.recordTable}</strong>
                    </>
                ) : null}
                .
            </>
        ) : (
            <>
                The {subject?.recordTable ?? 'record'} under validation {value ? 'passes' : 'fails'} this rule.
            </>
        );
    return (
        <div className="mb-verdict" data-verdict={value ? 'pass' : 'fail'} role="status">
            <div className="mb-verdict-mark" aria-hidden="true">
                <Icon name={value ? 'check' : 'x'} size={28} />
            </div>
            <div className="mb-verdict-text">
                <p className="mb-verdict-title">{word}</p>
                <p className="mb-verdict-body">{what}</p>
                <button type="button" className="mb-link-button" onClick={onShowExecution}>
                    {statements === 0
                        ? 'Answered entirely from the record — nothing reached the database.'
                        : `${statements} statement${statements === 1 ? '' : 's'} reached the database — see how →`}
                </button>
            </div>
        </div>
    );
}

export function ValueView({ value, type }: { value: unknown; type?: string }) {
    return (
        <div className="mb-value">
            <div className="mb-value-head">
                <span>Value</span>
                {type && <Badge tone="accent">{type === 'DECIMAL' ? 'DECIMAL · exact' : type}</Badge>}
            </div>
            {typeof value === 'object' && value !== null ? (
                <CodeBlock code={JSON.stringify(value, null, 2) ?? 'null'} language="plain" copyable />
            ) : (
                <p
                    className="mb-value-big"
                    data-kind={typeof value === 'number' || /^(DECIMAL|INTEGER|INT|NUMBER|FLOAT)/i.test(type ?? '') ? 'number' : 'text'}
                >
                    {value === null || value === undefined ? 'null' : String(value)}
                </p>
            )}
        </div>
    );
}

export function ResultView({ report, running, stale, subject, onRun, onShowProblems, onShowExecution }: ResultViewProps) {
    if (!report) {
        return running ? (
            <EmptyState icon="database" title="Running…">
                <Spinner label="Running" />
            </EmptyState>
        ) : (
            <EmptyState
                glyph="."
                title="Nothing run yet"
                action={
                    <Button variant="primary" icon="play" onClick={onRun}>
                        Run
                    </Button>
                }
            >
                Press Run or ⌘/Ctrl + Enter.
            </EmptyState>
        );
    }
    const body = (() => {
        if (report.error?.kind === 'config') {
            return (
                <Callout tone="danger" icon="alert" title="The host config is invalid">
                    {report.error.message}
                </Callout>
            );
        }
        if (report.stage === 'parse' || report.stage === 'check') {
            const errors = report.diagnostics.filter(d => d.severity === 1).length;
            return (
                <EmptyState
                    icon="alert"
                    tone="danger"
                    title={`${errors} problem${errors === 1 ? '' : 's'} to fix first`}
                    action={<Button onClick={onShowProblems}>Show problems</Button>}
                >
                    Minab checks everything before it runs anything — nothing was sent to the database.
                </EmptyState>
            );
        }
        if (report.refusal) {
            return (
                <Callout
                    tone="check-only"
                    icon="flag"
                    title={
                        <>
                            Checked ✓ — {report.refusal.label} {report.refusal.label.endsWith('s') ? "aren't" : "isn't"} executed yet
                        </>
                    }
                >
                    <p>
                        This program parses, resolves and type-checks. The evaluator doesn’t run <strong>{report.refusal.label}</strong>
                        {report.refusal.specRef && <> (spec {report.refusal.specRef})</>} yet, and says so rather than guessing.
                    </p>
                    <p className="mb-muted">{report.refusal.reason}</p>
                </Callout>
            );
        }
        if (report.error) {
            return (
                <Callout
                    tone="danger"
                    icon="alert"
                    title={
                        report.error.kind === 'datasource'
                            ? 'The database refused a statement'
                            : report.error.kind === 'evaluation'
                              ? 'Could not evaluate this program'
                              : 'Something went wrong'
                    }
                >
                    <p>{report.error.message}</p>
                    {report.error.sql && <CodeBlock code={report.error.sql} language="sql" copyable />}
                </Callout>
            );
        }
        const result = report.result;
        if (!result)
            return (
                <EmptyState icon="info" title="No answer">
                    The program has no final expression.
                </EmptyState>
            );
        if (result.kind === 'rows') return <RowsTable columns={result.columns} rows={result.rows} />;
        if (result.kind === 'verdict') {
            return (
                <VerdictCard
                    value={result.value}
                    kind={report.program.kind}
                    subject={subject}
                    statements={report.trace.length}
                    onShowExecution={onShowExecution}
                />
            );
        }
        return <ValueView value={result.value} type={result.type} />;
    })();
    const rows = report.result?.kind === 'rows' ? report.result.rows.length : undefined;
    return (
        <div className="mb-result" data-state={stale ? 'stale' : running ? 'running' : 'fresh'}>
            {body}
            <p className="mb-result-meta">
                {rows !== undefined && (
                    <span>
                        {rows} row{rows === 1 ? '' : 's'}
                    </span>
                )}
                <span>
                    {report.trace.length} statement{report.trace.length === 1 ? '' : 's'}
                </span>
                <span>{report.totalMs.toFixed(1)} ms</span>
                {stale && <Badge tone="warning">edited since this run</Badge>}
                {running && <Spinner size={12} label="Running" />}
            </p>
        </div>
    );
}
