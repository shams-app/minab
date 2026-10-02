import { useCallback, useMemo, useState } from 'react';
import { engineClient } from '../client/engine-client.js';
import { datasetById, datasets, type Dataset } from '../content/datasets/index.js';
import { exampleById } from '../content/examples/index.js';
import { lessonById } from '../content/tour/index.js';
import type { RecordPreset } from '../content/types.js';
import type { Row, SqlConsoleResult, TablePreview } from '../engine/protocol.js';
import { applyPreset, setHostOpen, setHostTab, updateHost } from '../state/controller.js';
import { usePlayground, type HostTab } from '../state/store.js';
import { hostContents, type WorkspaceHost } from '../state/workspace.js';

/** A table as the Schema view shows it. */
export interface TableView {
    name: string;
    primaryKey?: string;
    columns: Array<{ name: string; type: string; kind: 'scalar' | 'ref' | 'collection'; target?: string; via?: string }>;
    /** Rows in the seed, when known. */
    rowCount?: number;
}

export interface HostView {
    host: WorkspaceHost;
    tab: HostTab;
    setTab: (tab: HostTab) => void;
    open: boolean;
    setOpen: (open: boolean) => void;
    /** The config failed to parse; programs are checked against an empty schema until it's fixed. */
    error?: string;
    dataset?: Dataset;
    datasets: Dataset[];
    tables: TableView[];
    /** What the rule context says this program is. */
    ruleKind: 'none' | 'record' | 'field';
    recordTable?: string;
    fieldType?: string;
    setRuleContext: (rule: WorkspaceHost['rule']) => void;
    record?: Row;
    setRecord: (record: Row | undefined) => void;
    fieldValue?: unknown;
    setFieldValue: (value: unknown) => void;
    presets: RecordPreset[];
    activePresetId?: string;
    applyPreset: (preset: RecordPreset) => void;
    /** The schema as JSON text, for the JSON editor. */
    schemaJson: string;
    /** Replaces the schema from JSON text; answers an error message, or undefined on success. */
    setSchemaJson: (text: string) => string | undefined;
    /** Back to the dataset's own schema and rows. */
    resetSchema: () => void;
    schemaEdited: boolean;
    preview: (table: string, limit?: number) => Promise<TablePreview>;
    runSql: (text: string) => Promise<SqlConsoleResult>;
    resetDatabase: () => Promise<void>;
}

function tableViews(schema: { tables: unknown[] }, seed: Record<string, Row[]>): TableView[] {
    return (schema.tables as Array<{ name: string; primaryKey?: string; columns?: Record<string, unknown> | Array<{ name: string; type: unknown }> }>)
        .filter(t => t && typeof t.name === 'string')
        .map(t => {
            const entries: Array<[string, unknown]> = Array.isArray(t.columns) ? t.columns.map(c => [c.name, c.type]) : Object.entries(t.columns ?? {});
            return {
                name: t.name,
                primaryKey: t.primaryKey,
                rowCount: seed[t.name]?.length,
                columns: entries.map(([name, type]) => {
                    if (typeof type === 'string') return { name, type, kind: 'scalar' as const };
                    const spec = (type ?? {}) as { ref?: string; collection?: string; foreignKey?: string; type?: string };
                    if (spec.ref) return { name, type: `→ ${spec.ref}`, kind: 'ref' as const, target: spec.ref, via: spec.foreignKey };
                    if (spec.collection)
                        return { name, type: `⇉ ${spec.collection}[]`, kind: 'collection' as const, target: spec.collection, via: spec.foreignKey };
                    return { name, type: spec.type ?? '?', kind: 'scalar' as const };
                })
            };
        });
}

function samePreset(preset: RecordPreset, host: WorkspaceHost): boolean {
    if (preset.record && JSON.stringify(preset.record) !== JSON.stringify(host.record)) return false;
    if (preset.fieldValue !== undefined && JSON.stringify(preset.fieldValue) !== JSON.stringify(host.fieldValue)) return false;
    return true;
}

/** The host panel: schema, data, the record under validation and `$`. */
export function useHost(): HostView {
    const workspace = usePlayground(s => s.workspace);
    const scope = usePlayground(s => s.scope);
    const tab = usePlayground(s => s.hostTab);
    const open = usePlayground(s => s.hostOpen);
    const error = usePlayground(s => s.hostError);
    const host = workspace.host;

    const presets = useMemo(() => {
        if (scope.startsWith('lesson:')) return lessonById(scope.slice(7))?.presets ?? [];
        return workspace.exampleId ? (exampleById(workspace.exampleId)?.presets ?? []) : [];
    }, [scope, workspace.exampleId]);

    const { schema, seed } = useMemo(() => hostContents(host), [host]);
    const tables = useMemo(() => tableViews(schema, seed), [schema, seed]);

    const setSchemaJson = useCallback(
        (text: string): string | undefined => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                return `Invalid JSON — ${(e as Error).message}`;
            }
            if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { tables?: unknown }).tables)) {
                return 'Expected an object with a "tables" array.';
            }
            const dataset = host.dataset ? datasetById(host.dataset) : undefined;
            // Keep the dataset's rows for tables that still exist, so editing a column doesn't empty the database.
            const nextSeed: Record<string, Row[]> = {};
            for (const table of (parsed as { tables: Array<{ name?: string }> }).tables) {
                if (table?.name && (host.seed ?? dataset?.seed)?.[table.name]) nextSeed[table.name] = (host.seed ?? dataset!.seed)[table.name];
            }
            updateHost({ schema: parsed as WorkspaceHost['schema'], seed: nextSeed });
            return undefined;
        },
        [host]
    );

    return {
        host,
        tab,
        setTab: setHostTab,
        open,
        setOpen: setHostOpen,
        error,
        dataset: host.dataset ? datasetById(host.dataset) : undefined,
        datasets,
        tables,
        ruleKind: host.rule.fieldType ? 'field' : host.rule.recordTable ? 'record' : 'none',
        recordTable: host.rule.recordTable,
        fieldType: host.rule.fieldType,
        setRuleContext: rule => updateHost({ rule }),
        record: host.record,
        setRecord: record => updateHost({ record }),
        fieldValue: host.fieldValue,
        setFieldValue: fieldValue => updateHost({ fieldValue }),
        presets,
        activePresetId: presets.find(p => samePreset(p, host))?.id,
        applyPreset,
        schemaJson: JSON.stringify(schema, null, 2),
        setSchemaJson,
        resetSchema: () => updateHost({ schema: undefined, seed: undefined }),
        schemaEdited: host.schema !== undefined && host.dataset !== null,
        preview: (table, limit = 50) => engineClient().call('tablePreview', table, limit),
        runSql: text => engineClient().call('sql', text),
        resetDatabase: () => engineClient().call('resetDatabase')
    };
}

/** Local UI state for a table browser: which table, its rows, loading. */
export function useTablePreview(preview: HostView['preview']) {
    const [state, setState] = useState<{ table?: string; data?: TablePreview; loading: boolean; error?: string }>({ loading: false });
    const load = useCallback(
        async (table: string) => {
            setState(s => ({ ...s, table, loading: true, error: undefined }));
            try {
                const data = await preview(table);
                setState({ table, data, loading: false });
            } catch (e) {
                setState({ table, loading: false, error: (e as Error).message });
            }
        },
        [preview]
    );
    return { ...state, load };
}
