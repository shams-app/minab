import { useState, type ReactNode } from 'react';
import type { TableView } from '../../hooks/useHost.js';
import { Badge, Button } from '../primitives/primitives.js';

export interface SchemaViewProps {
    tables: TableView[];
    datasetTitle?: string;
    datasetDescription?: string;
    edited: boolean;
    onReset: () => void;
    /** The JSON editor, rendered by the page (it needs Monaco). */
    jsonEditor: ReactNode;
}

export function SchemaView({ tables, datasetTitle, datasetDescription, edited, onReset, jsonEditor }: SchemaViewProps) {
    const [mode, setMode] = useState<'cards' | 'json'>('cards');
    return (
        <div className="mb-schema">
            <div className="mb-schema-head">
                <div>
                    <p className="mb-schema-title">
                        {datasetTitle ?? 'Custom schema'} {edited && <Badge tone="warning">edited</Badge>}
                    </p>
                    {datasetDescription && <p className="mb-muted">{datasetDescription}</p>}
                </div>
                <div className="mb-row">
                    <Button size="sm" variant="ghost" onClick={() => setMode(mode === 'cards' ? 'json' : 'cards')}>
                        {mode === 'cards' ? 'Edit as JSON' : 'Show tables'}
                    </Button>
                    {edited && (
                        <Button size="sm" variant="ghost" icon="reset" onClick={onReset}>
                            Reset
                        </Button>
                    )}
                </div>
            </div>
            <p className="mb-muted mb-schema-note">Minab source never declares tables — the host supplies them. Programs are checked against this schema.</p>
            {mode === 'json' ? (
                <div className="mb-schema-json">{jsonEditor}</div>
            ) : (
                <div className="mb-schema-grid">
                    {tables.map(table => (
                        <article key={table.name} className="mb-table-card">
                            <header>
                                <span className="mb-table-card-name">{table.name}</span>
                                {table.rowCount !== undefined && <span className="mb-muted">{table.rowCount} rows</span>}
                            </header>
                            <ul>
                                {table.columns.map(column => (
                                    <li key={column.name} data-kind={column.kind}>
                                        <span className="mb-column-name">
                                            {column.name}
                                            {table.primaryKey === column.name && <span title="primary key"> 🔑</span>}
                                        </span>
                                        <span className="mb-column-type" title={column.via ? `foreign key: ${column.via}` : undefined}>
                                            {column.type}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}
