import { useEffect, useState } from 'react';
import type { SqlConsoleResult, TablePreview } from '../../engine/protocol.js';
import { RowsTable } from '../output/ResultView.js';
import { Button, Callout, EmptyState, Spinner } from '../primitives/primitives.js';

export interface DataViewProps {
    tables: string[];
    active?: string;
    preview?: TablePreview;
    loading: boolean;
    error?: string;
    onSelect: (table: string) => void;
    onReset: () => Promise<void>;
    onRunSql: (text: string) => Promise<SqlConsoleResult>;
}

export function DataView({ tables, active, preview, loading, error, onSelect, onReset, onRunSql }: DataViewProps) {
    const [consoleOpen, setConsoleOpen] = useState(false);
    useEffect(() => {
        if (!active && tables.length > 0) onSelect(tables[0]);
    }, [active, tables, onSelect]);
    if (tables.length === 0)
        return (
            <EmptyState icon="database" title="No tables">
                This host’s schema declares no tables.
            </EmptyState>
        );
    return (
        <div className="mb-data">
            <div className="mb-data-head">
                <div className="mb-chip-row" role="tablist" aria-label="Tables">
                    {tables.map(t => (
                        <button
                            key={t}
                            type="button"
                            role="tab"
                            aria-selected={t === active}
                            className="mb-chip"
                            data-state={t === active ? 'active' : undefined}
                            onClick={() => onSelect(t)}
                        >
                            {t}
                        </button>
                    ))}
                </div>
                <div className="mb-row">
                    <Button size="sm" variant="ghost" icon="code" onClick={() => setConsoleOpen(!consoleOpen)}>
                        {consoleOpen ? 'Hide SQL console' : 'SQL console'}
                    </Button>
                    <Button size="sm" variant="ghost" icon="reset" onClick={() => void onReset().then(() => active && onSelect(active))}>
                        Reset data
                    </Button>
                </div>
            </div>
            {consoleOpen && <SqlConsole onRun={onRunSql} onDone={() => active && onSelect(active)} />}
            {error ? (
                <Callout tone="danger" icon="alert">
                    {error}
                </Callout>
            ) : loading && !preview ? (
                <EmptyState icon="database" title="Loading…">
                    <Spinner />
                </EmptyState>
            ) : preview ? (
                <>
                    <p className="mb-muted">
                        {preview.total} row{preview.total === 1 ? '' : 's'} in <strong>{preview.table}</strong>
                        {preview.rows.length < preview.total ? ` · showing ${preview.rows.length}` : ''} — real rows in the in-browser Postgres.
                    </p>
                    <RowsTable columns={preview.columns.map(c => c.name)} rows={preview.rows} caption={`${preview.table} rows`} />
                </>
            ) : null}
        </div>
    );
}

export function SqlConsole({ onRun, onDone }: { onRun: (text: string) => Promise<SqlConsoleResult>; onDone?: () => void }) {
    const [text, setText] = useState('SELECT name, country FROM "Customer" ORDER BY name;');
    const [result, setResult] = useState<SqlConsoleResult>();
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        setBusy(true);
        setResult(await onRun(text));
        setBusy(false);
        onDone?.();
    };
    const last = result?.statements[result.statements.length - 1];
    return (
        <div className="mb-sql-console">
            <label className="mb-label" htmlFor="sql-console-input">
                Raw SQL against the demo database — changes last until you reset.
            </label>
            <textarea
                id="sql-console-input"
                className="mb-textarea mb-mono"
                rows={3}
                value={text}
                spellCheck={false}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void submit();
                    }
                }}
            />
            <div className="mb-row">
                <Button size="sm" variant="primary" icon="play" busy={busy} onClick={() => void submit()}>
                    Run SQL
                </Button>
                {result && <span className="mb-muted">{result.durationMs.toFixed(1)} ms</span>}
            </div>
            {result?.error && (
                <Callout tone="danger" icon="alert">
                    {result.error}
                </Callout>
            )}
            {last && last.columns.length > 0 && <RowsTable columns={last.columns} rows={last.rows} caption="SQL console result" />}
            {last && last.columns.length === 0 && <p className="mb-muted">{last.affectedRows ?? 0} row(s) affected.</p>}
        </div>
    );
}
