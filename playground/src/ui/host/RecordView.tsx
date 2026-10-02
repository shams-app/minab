/**
 * The Record and Field tabs: what a rule is validating. Editing a value
 * re-runs the rule, so a visitor can watch the verdict flip.
 */

import { useEffect, useState } from 'react';
import type { RecordPreset } from '../../content/types.js';
import type { Row } from '../../engine/protocol.js';
import type { TableView } from '../../hooks/useHost.js';
import { Button, Callout, EmptyState } from '../primitives/primitives.js';
import { Icon } from '../primitives/Icon.js';

export function PresetChips({ presets, activeId, onPick }: { presets: RecordPreset[]; activeId?: string; onPick: (preset: RecordPreset) => void }) {
    if (presets.length === 0) return null;
    const active = presets.find(p => p.id === activeId);
    return (
        <div className="mb-presets">
            <p className="mb-label">Try a preset</p>
            <div className="mb-chip-row">
                {presets.map(p => (
                    <button
                        key={p.id}
                        type="button"
                        className="mb-chip"
                        data-state={p.id === activeId ? 'active' : undefined}
                        data-expect={p.expect ? 'pass' : 'fail'}
                        onClick={() => onPick(p)}
                    >
                        <Icon name={p.expect ? 'check' : 'x'} size={12} /> {p.label}
                    </button>
                ))}
            </div>
            {active && <p className="mb-muted">{active.note}</p>}
        </div>
    );
}

function parseInput(text: string, previous: unknown): unknown {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === 'null') return null;
    if (typeof previous === 'number' || /^-?\d+(\.\d+)?$/.test(trimmed)) {
        const n = Number(trimmed);
        if (!Number.isNaN(n)) return n;
    }
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (typeof previous === 'object' && previous !== null) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return text;
        }
    }
    return text;
}

function display(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export interface RecordViewProps {
    ruleKind: 'none' | 'record' | 'field';
    recordTable?: string;
    tables: TableView[];
    record?: Row;
    presets: RecordPreset[];
    activePresetId?: string;
    onPreset: (preset: RecordPreset) => void;
    onRecordChange: (record: Row | undefined) => void;
    onRecordTableChange: (table: string | undefined) => void;
}

export function RecordView({ ruleKind, recordTable, tables, record, presets, activePresetId, onPreset, onRecordChange, onRecordTableChange }: RecordViewProps) {
    const [json, setJson] = useState(false);
    const [jsonText, setJsonText] = useState('');
    const [jsonError, setJsonError] = useState<string>();
    useEffect(() => setJsonText(JSON.stringify(record ?? {}, null, 2)), [record]);

    const table = tables.find(t => t.name === recordTable);
    const keys = [
        ...new Set([
            ...Object.keys(record ?? {}),
            ...(table?.columns.flatMap(c => (c.kind === 'scalar' ? [c.name] : c.kind === 'ref' && c.via ? [c.via] : [])) ?? [])
        ])
    ];

    return (
        <div className="mb-record">
            <div className="mb-field-row">
                <label className="mb-label" htmlFor="record-table">
                    Rule table
                </label>
                <select id="record-table" className="mb-select" value={recordTable ?? ''} onChange={e => onRecordTableChange(e.target.value || undefined)}>
                    <option value="">— not a rule —</option>
                    {tables.map(t => (
                        <option key={t.name} value={t.name}>
                            {t.name}
                        </option>
                    ))}
                </select>
            </div>
            {ruleKind === 'none' ? (
                <EmptyState icon="info" title="This program isn’t a rule">
                    A program is a <strong>record-level rule</strong> when the host says which table it guards. Pick one above to validate a record of it — `.`
                    then means that record.
                </EmptyState>
            ) : (
                <>
                    <PresetChips presets={presets} activeId={activePresetId} onPick={onPreset} />
                    <div className="mb-record-head">
                        <p className="mb-label">
                            The {recordTable} record being validated (
                            <code className="mb-inline-code">
                                <span className="tok tok-sigil-record">.</span>
                            </code>
                            )
                        </p>
                        <Button size="sm" variant="ghost" onClick={() => setJson(!json)}>
                            {json ? 'Form' : 'JSON'}
                        </Button>
                    </div>
                    {json ? (
                        <>
                            <textarea
                                className="mb-textarea mb-mono"
                                rows={10}
                                value={jsonText}
                                spellCheck={false}
                                aria-label="Record as JSON"
                                onChange={e => {
                                    setJsonText(e.target.value);
                                    try {
                                        const parsed = JSON.parse(e.target.value);
                                        setJsonError(undefined);
                                        onRecordChange(parsed);
                                    } catch (err) {
                                        setJsonError((err as Error).message);
                                    }
                                }}
                            />
                            {jsonError && <p className="mb-field-error">{jsonError}</p>}
                        </>
                    ) : (
                        <div className="mb-form-grid">
                            {keys.map(key => (
                                <div className="mb-field-row" key={key}>
                                    <label className="mb-label mb-mono" htmlFor={`record-${key}`}>
                                        {key}
                                    </label>
                                    <input
                                        id={`record-${key}`}
                                        className="mb-input mb-mono"
                                        value={display(record?.[key])}
                                        placeholder="null"
                                        onChange={e => onRecordChange({ ...(record ?? {}), [key]: parseInput(e.target.value, record?.[key]) })}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="mb-muted">
                        Related rows (like <code className="mb-inline-code">.customer</code>) are read from the database through this record’s key.
                    </p>
                </>
            )}
        </div>
    );
}

export interface FieldViewProps {
    ruleKind: 'none' | 'record' | 'field';
    fieldType?: string;
    fieldValue?: unknown;
    recordTable?: string;
    presets: RecordPreset[];
    activePresetId?: string;
    onPreset: (preset: RecordPreset) => void;
    onFieldTypeChange: (type: string | undefined) => void;
    onFieldValueChange: (value: unknown) => void;
}

/** Reads an input as the declared type of `$`, so "500" is a number for DECIMAL and a string for TEXT. */
function parseTyped(text: string, type: string | undefined): unknown {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === 'null') return null;
    if (type === 'INTEGER' || type === 'DECIMAL') {
        const n = Number(trimmed);
        return Number.isNaN(n) ? text : n;
    }
    if (type === 'BOOLEAN') return trimmed === 'true' ? true : trimmed === 'false' ? false : text;
    if (type === 'JSON') {
        try {
            return JSON.parse(trimmed);
        } catch {
            return text;
        }
    }
    return text;
}

const FIELD_TYPES = ['TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'UUID', 'JSON'];

export function FieldView({
    ruleKind,
    fieldType,
    fieldValue,
    recordTable,
    presets,
    activePresetId,
    onPreset,
    onFieldTypeChange,
    onFieldValueChange
}: FieldViewProps) {
    return (
        <div className="mb-record">
            <div className="mb-field-row">
                <label className="mb-label" htmlFor="field-type">
                    Type of{' '}
                    <code className="mb-inline-code">
                        <span className="tok tok-sigil-field">$</span>
                    </code>
                </label>
                <select id="field-type" className="mb-select" value={fieldType ?? ''} onChange={e => onFieldTypeChange(e.target.value || undefined)}>
                    <option value="">— not a field rule —</option>
                    {FIELD_TYPES.map(t => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </select>
            </div>
            {ruleKind !== 'field' ? (
                <EmptyState icon="info" title="This program isn’t a field rule">
                    Give <code className="mb-inline-code">$</code> a type to validate a single value.
                    {!recordTable && ' Field rules also need a rule table (Record tab), so `.` can reach the rest of the record.'}
                </EmptyState>
            ) : (
                <>
                    <PresetChips presets={presets} activeId={activePresetId} onPick={onPreset} />
                    <div className="mb-field-row">
                        <label className="mb-label" htmlFor="field-value">
                            Value being validated
                        </label>
                        <input
                            id="field-value"
                            className="mb-input mb-mono"
                            value={display(fieldValue)}
                            placeholder="null"
                            onChange={e => onFieldValueChange(parseTyped(e.target.value, fieldType))}
                        />
                    </div>
                    {!recordTable && (
                        <Callout tone="warning" icon="alert">
                            Set a rule table in the Record tab so `.` has a record to refer to.
                        </Callout>
                    )}
                </>
            )}
        </div>
    );
}
