import { useMemo } from 'react';
import { exampleById } from '../content/examples/index.js';
import type { Example } from '../content/types.js';
import type { AnalyzeReport, EngineDiagnostic, ProgramInfo, RunReport } from '../engine/protocol.js';
import {
    revealInEditor,
    run,
    setAutoRun,
    setHighlight,
    setOutputTab,
    setSource
} from '../state/controller.js';
import { usePlayground, type Highlight, type OutputTab } from '../state/store.js';

export interface ProblemCounts {
    errors: number;
    warnings: number;
}

export interface WorkbenchView {
    source: string;
    setSource: (source: string) => void;
    run: () => void;
    running: boolean;
    autoRun: boolean;
    setAutoRun: (on: boolean) => void;
    /** The latest analysis (updates as you type). */
    analysis?: AnalyzeReport;
    /** The latest run. */
    report?: RunReport;
    /** The editor changed since `report` was produced. */
    stale: boolean;
    program?: ProgramInfo;
    diagnostics: EngineDiagnostic[];
    problems: ProblemCounts;
    outputTab: OutputTab;
    setOutputTab: (tab: OutputTab) => void;
    highlight?: Highlight;
    setHighlight: typeof setHighlight;
    reveal?: { range: EngineDiagnostic['range']; nonce: number };
    revealInEditor: typeof revealInEditor;
    /** The example this workspace came from, if any. */
    example?: Example;
    announcement: string;
}

const NO_DIAGNOSTICS: EngineDiagnostic[] = [];

/** Everything the editor + output side of a workbench needs. */
export function useWorkbench(): WorkbenchView {
    const state = usePlayground();
    const { workspace, analysis, report, reportSource } = state;
    const diagnostics = analysis?.diagnostics ?? NO_DIAGNOSTICS;
    return useMemo(() => ({
        source: workspace.source,
        setSource,
        run: () => void run(),
        running: state.running,
        autoRun: state.autoRun,
        setAutoRun,
        analysis,
        report,
        stale: report !== undefined && reportSource !== workspace.source,
        program: analysis?.program,
        diagnostics,
        problems: {
            errors: diagnostics.filter(d => d.severity === 1).length,
            warnings: diagnostics.filter(d => d.severity === 2).length
        },
        outputTab: state.outputTab,
        setOutputTab,
        highlight: state.highlight,
        setHighlight,
        reveal: state.reveal,
        revealInEditor,
        example: workspace.exampleId ? exampleById(workspace.exampleId) : undefined,
        announcement: state.announcement
    }), [workspace, analysis, report, reportSource, diagnostics, state.running, state.autoRun, state.outputTab, state.highlight, state.reveal, state.announcement]);
}
