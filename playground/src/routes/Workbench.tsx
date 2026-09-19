/**
 * The workbench, composed: hooks in, UI components out. Used by the
 * playground and (with a lesson beside it) by the tour. This file is glue —
 * the design handoff restyles the components it composes, not this.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { engineClient } from '../client/engine-client.js';
import configSchema from '../content/minab-config.schema.json';
import { examples } from '../content/examples/index.js';
import type { AstNodeView } from '../engine/protocol.js';
import { useEngine } from '../hooks/useEngine.js';
import { useHost, useTablePreview } from '../hooks/useHost.js';
import { useShare } from '../hooks/useShare.js';
import { useWorkbench } from '../hooks/useWorkbench.js';
import { LazyCodeEditor } from '../monaco/LazyCodeEditor.js';
import { openExample, setHostOpen, setReferenceOpen, toast, warmUpEngine } from '../state/controller.js';
import { usePlayground } from '../state/store.js';
import { DataView } from '../ui/host/DataView.js';
import { HostPanel } from '../ui/host/HostPanel.js';
import { FieldView, RecordView } from '../ui/host/RecordView.js';
import { SchemaView } from '../ui/host/SchemaView.js';
import { AstView } from '../ui/output/AstView.js';
import { ExecutionView } from '../ui/output/ExecutionView.js';
import { OutputPanel } from '../ui/output/OutputPanel.js';
import { ProblemsList } from '../ui/output/ProblemsList.js';
import { ResultView } from '../ui/output/ResultView.js';
import { SqlView } from '../ui/output/SqlView.js';
import { Icon } from '../ui/primitives/Icon.js';
import { Button } from '../ui/primitives/primitives.js';
import { EditorStatusBar, RunButton, Toolbar } from '../ui/workbench/Toolbar.js';
import { WorkbenchLayout } from '../ui/workbench/WorkbenchLayout.js';

const SCHEMA_EDITOR_SCHEMA = { $ref: '#/definitions/schema', definitions: configSchema.definitions };

function useAst(source: string, active: boolean) {
    const [tree, setTree] = useState<AstNodeView>();
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (!active) return;
        setLoading(true);
        const timer = setTimeout(() => {
            engineClient().call('ast', source).then(t => { setTree(t); setLoading(false); }, () => setLoading(false));
        }, 250);
        return () => clearTimeout(timer);
    }, [source, active]);
    return { tree, loading };
}

export interface WorkbenchProps {
    variant: 'play' | 'lesson';
    /** Content shown above the editor (the tour's goal, say). */
    aside?: ReactNode;
    editorPath: string;
}

export function Workbench({ variant, aside, editorPath }: WorkbenchProps) {
    const wb = useWorkbench();
    const host = useHost();
    const engine = useEngine();
    const share = useShare();
    const navigate = useNavigate();
    const hostOpen = usePlayground(s => s.hostOpen);
    const tables = useTablePreview(host.preview);
    const ast = useAst(wb.source, wb.outputTab === 'ast');
    const [schemaText, setSchemaText] = useState(host.schemaJson);
    // Boot Postgres in the background: the first query shouldn't pay for it.
    useEffect(() => warmUpEngine(), []);
    useEffect(() => setSchemaText(host.schemaJson), [host.schemaJson]);

    const report = wb.report;
    const rows = report?.result?.kind === 'rows' ? report.result.rows.length : undefined;
    const onSelectTable = useCallback((t: string) => void tables.load(t), [tables.load]);

    const toolbar = variant === 'play'
        ? (
            <Toolbar
                example={wb.example}
                examples={examples}
                onPickExample={id => navigate(`/play?example=${id}`)}
                onResetExample={wb.example ? () => openExample(wb.example!) : undefined}
                engine={engine}
                running={wb.running}
                onRun={wb.run}
                autoRun={wb.autoRun}
                onAutoRunChange={wb.setAutoRun}
                onShare={() => void share.copyLink()}
                onEmbed={() => void share.copyEmbed()}
                onExport={() => void share.exportBundle().catch(e => toast(`Export failed: ${(e as Error).message}`, 'error'))}
                onOpenReference={() => setReferenceOpen(true)}
            />
        )
        : (
            <div className="mb-toolbar mb-toolbar-compact" role="toolbar" aria-label="Program">
                <div className="mb-toolbar-start"><span className="mb-muted">Your program</span></div>
                <div className="mb-toolbar-end"><RunButton onRun={wb.run} running={wb.running} /></div>
            </div>
        );

    const editor = (
        <LazyCodeEditor
            path={editorPath}
            value={wb.source}
            onChange={wb.setSource}
            ariaLabel="Minab program"
            diagnostics={wb.diagnostics}
            pushdowns={wb.stale ? undefined : report?.trace}
            checkOnly={wb.program?.checkOnlyConstructs}
            highlight={wb.highlight}
            reveal={wb.reveal}
            onRun={wb.run}
        />
    );

    const statusBar = (
        <EditorStatusBar
            kind={wb.program?.kind}
            resultType={wb.program?.resultType}
            errors={wb.problems.errors}
            warnings={wb.problems.warnings}
            checkOnly={wb.program?.checkOnly ?? false}
            onShowProblems={() => wb.setOutputTab('problems')}
        />
    );

    const outputBody = (() => {
        switch (wb.outputTab) {
            case 'result':
                return (
                    <ResultView
                        report={report}
                        running={wb.running}
                        stale={wb.stale}
                        subject={{ recordTable: host.recordTable, fieldType: host.fieldType, fieldValue: host.fieldValue, record: host.record }}
                        onRun={wb.run}
                        onShowProblems={() => wb.setOutputTab('problems')}
                        onShowExecution={() => wb.setOutputTab('execution')}
                    />
                );
            case 'sql':
                return <SqlView analysis={wb.analysis} trace={report?.trace ?? []} onShowExecution={() => wb.setOutputTab('execution')} />;
            case 'execution':
                return <ExecutionView report={report} onHighlight={r => wb.setHighlight(r, 'pushdown')} onReveal={wb.revealInEditor} />;
            case 'problems':
                return <ProblemsList diagnostics={wb.diagnostics} configError={wb.analysis?.configError} onSelect={wb.revealInEditor} />;
            case 'ast':
                return <AstView tree={ast.tree} loading={ast.loading} onHighlight={r => wb.setHighlight(r, 'ast')} onReveal={wb.revealInEditor} />;
        }
    })();

    const output = (
        <OutputPanel
            tab={wb.outputTab}
            onTabChange={wb.setOutputTab}
            counts={{ problems: wb.problems.errors + wb.problems.warnings, statements: report && !wb.stale ? report.trace.length : undefined, rows }}
        >
            {outputBody}
        </OutputPanel>
    );

    const hostBody = (() => {
        switch (host.tab) {
            case 'schema':
                return (
                    <SchemaView
                        tables={host.tables}
                        datasetTitle={host.dataset?.title}
                        datasetDescription={host.dataset?.description}
                        edited={host.schemaEdited}
                        onReset={host.resetSchema}
                        jsonEditor={
                            <div className="mb-json-editor">
                                <div className="mb-json-editor-slot">
                                    <LazyCodeEditor path={`${editorPath}.schema.json`} language="json" value={schemaText} onChange={setSchemaText} ariaLabel="Schema JSON" jsonSchema={SCHEMA_EDITOR_SCHEMA} compact />
                                </div>
                                <div className="mb-row">
                                    <Button size="sm" variant="primary" onClick={() => {
                                        const error = host.setSchemaJson(schemaText);
                                        toast(error ?? 'Schema applied — the program is re-checked against it.', error ? 'error' : 'success');
                                    }}>Apply schema</Button>
                                    <span className="mb-muted">Rows are kept for tables that still exist.</span>
                                </div>
                            </div>
                        }
                    />
                );
            case 'data':
                return (
                    <DataView
                        tables={host.tables.map(t => t.name)}
                        active={tables.table}
                        preview={tables.data}
                        loading={tables.loading}
                        error={tables.error}
                        onSelect={onSelectTable}
                        onReset={async () => {
                            await host.resetDatabase();
                            toast('Demo data restored.', 'success');
                        }}
                        onRunSql={host.runSql}
                    />
                );
            case 'record':
                return (
                    <RecordView
                        ruleKind={host.ruleKind}
                        recordTable={host.recordTable}
                        tables={host.tables}
                        record={host.record}
                        presets={host.presets}
                        activePresetId={host.activePresetId}
                        onPreset={host.applyPreset}
                        onRecordChange={host.setRecord}
                        onRecordTableChange={table => host.setRuleContext({ ...host.host.rule, recordTable: table })}
                    />
                );
            case 'field':
                return (
                    <FieldView
                        ruleKind={host.ruleKind}
                        fieldType={host.fieldType}
                        fieldValue={host.fieldValue}
                        recordTable={host.recordTable}
                        presets={host.presets}
                        activePresetId={host.activePresetId}
                        onPreset={host.applyPreset}
                        onFieldTypeChange={type => host.setRuleContext({ ...host.host.rule, fieldType: type })}
                        onFieldValueChange={host.setFieldValue}
                    />
                );
        }
    })();

    return (
        <>
            <WorkbenchLayout
                toolbar={toolbar}
                aside={aside}
                editor={editor}
                statusBar={statusBar}
                output={output}
                host={<HostPanel tab={host.tab} onTabChange={host.setTab} ruleKind={host.ruleKind} error={host.error} onCollapse={() => setHostOpen(false)}>{hostBody}</HostPanel>}
                hostOpen={hostOpen}
                hostCollapsedBar={
                    <button type="button" className="mb-host-reopen" onClick={() => setHostOpen(true)}>
                        <Icon name="database" size={14} /> Host — schema, data{host.ruleKind !== 'none' ? ', record' : ''} <Icon name="chevron-right" size={12} />
                    </button>
                }
                runFab={<div className="mb-run-fab"><RunButton onRun={wb.run} running={wb.running} /></div>}
                mobileBadges={{ result: rows }}
            />
            <div className="mb-visually-hidden" aria-live="polite">{wb.announcement}</div>
        </>
    );
}
