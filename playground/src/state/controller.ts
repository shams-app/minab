/**
 * The choreography between the editor, the host and the engine.
 *
 *  - Typing re-analyses after a short pause (diagnostics, the program's
 *    kind, its compiled SQL) and, with auto-run on, runs after a longer one.
 *  - A host change (schema, record, `$`) is applied to the engine before
 *    the next analysis or run, since the checker depends on it.
 *  - Responses that arrive after a newer request are dropped, so a slow
 *    run can never overwrite a newer answer.
 */

import { engineClient } from '../client/engine-client.js';
import type { Example, Lesson, RecordPreset } from '../content/types.js';
import type { Range } from '../engine/protocol.js';
import { remove, save } from './persistence.js';
import { getState, setState, type HostTab, type OutputTab, type Scope, type ThemePreference } from './store.js';
import { hostSettings, workspaceFromExample, type Workspace, type WorkspaceHost } from './workspace.js';

const ANALYZE_DELAY = 200;
const AUTO_RUN_DELAY = 550;

let analyzeTimer: ReturnType<typeof setTimeout> | undefined;
let runTimer: ReturnType<typeof setTimeout> | undefined;
let analyzeSeq = 0;
let runSeq = 0;
let runAbort: AbortController | undefined;
let appliedHostKey: string | undefined;
let toastSeq = 0;
let connected = false;

function engine() {
    const client = engineClient();
    if (!connected) {
        connected = true;
        client.onStatus(status => {
            setState({ engine: status });
            // A restarted worker starts with no host: re-apply it before the next request.
            if (status.phase === 'starting') appliedHostKey = undefined;
        });
    }
    return client;
}

function storageKey(scope: Scope): string {
    return `workspace:${scope}`;
}

function persist(): void {
    const { scope, workspace } = getState();
    if (scope === 'embed') return;
    save(storageKey(scope), workspace);
}

async function applyHost(): Promise<void> {
    const host = getState().workspace.host;
    const key = JSON.stringify(host);
    if (key === appliedHostKey) return;
    appliedHostKey = key;
    const result = await engine().call('setHost', hostSettings(host));
    if (JSON.stringify(getState().workspace.host) !== key) return;
    setState(result.ok ? { hostError: undefined, hostTables: result.tables } : { hostError: result.error, hostTables: [] });
}

export async function analyzeNow(): Promise<void> {
    const seq = ++analyzeSeq;
    await applyHost();
    const source = getState().workspace.source;
    const analysis = await engine().call('analyze', source);
    if (seq === analyzeSeq) setState({ analysis });
}

/** Runs the current program now. */
export async function run(): Promise<void> {
    clearTimeout(runTimer);
    const seq = ++runSeq;
    // The run this one replaces is stopped in the worker, not only ignored here.
    runAbort?.abort();
    const abort = (runAbort = new AbortController());
    setState({ running: true });
    try {
        await applyHost();
        const source = getState().workspace.source;
        const report = await engine().run(source, seq, abort.signal);
        if (seq !== runSeq) return;
        setState({ report, reportSource: source, analysis: report, running: false, highlight: undefined });
        announce(report);
    } catch (e) {
        if (seq !== runSeq) return;
        setState({ running: false });
        toast(`The engine stopped: ${(e as Error).message}`, 'error');
    }
}

function scheduleAnalysis(): void {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(() => void analyzeNow(), ANALYZE_DELAY);
    if (getState().autoRun) {
        clearTimeout(runTimer);
        runTimer = setTimeout(() => void run(), AUTO_RUN_DELAY);
    }
}

/** Loads a workspace into a surface and runs it. */
export function openWorkspace(scope: Scope, workspace: Workspace, options: { run?: boolean; outputTab?: OutputTab } = {}): void {
    setState({
        scope,
        workspace,
        report: undefined,
        reportSource: undefined,
        analysis: undefined,
        highlight: undefined,
        outputTab: options.outputTab ?? getState().outputTab,
        hostTab: workspace.host.rule.fieldType ? 'field' : workspace.host.rule.recordTable ? 'record' : 'data'
    });
    persist();
    if (options.run ?? true) void run();
    else void analyzeNow();
}

export function openExample(example: Example, scope: Scope = 'play'): void {
    openWorkspace(scope, workspaceFromExample(example), { outputTab: example.focus });
}

export function openLesson(lesson: Lesson, workspace: Workspace): void {
    openWorkspace(`lesson:${lesson.id}`, workspace, { outputTab: lesson.focus });
}

export function setSource(source: string): void {
    const { workspace } = getState();
    if (workspace.source === source) return;
    setState({ workspace: { ...workspace, source } });
    persist();
    scheduleAnalysis();
}

export function updateHost(patch: Partial<WorkspaceHost>): void {
    const { workspace } = getState();
    setState({ workspace: { ...workspace, host: { ...workspace.host, ...patch } } });
    persist();
    clearTimeout(analyzeTimer);
    if (getState().autoRun) void run();
    else void analyzeNow();
}

export function applyPreset(preset: RecordPreset): void {
    updateHost({
        ...(preset.record ? { record: preset.record } : {}),
        ...(preset.fieldValue !== undefined ? { fieldValue: preset.fieldValue } : {})
    });
}

export function setAutoRun(autoRun: boolean): void {
    setState({ autoRun });
    save('autoRun', autoRun);
    if (autoRun) void run();
}

export function setOutputTab(outputTab: OutputTab): void {
    setState({ outputTab });
}

export function setHostTab(hostTab: HostTab): void {
    setState({ hostTab, hostOpen: true });
}

export function setHostOpen(hostOpen: boolean): void {
    setState({ hostOpen });
}

export function setHighlight(range: Range | undefined, kind: 'pushdown' | 'ast' | 'problem' | 'log' = 'pushdown'): void {
    setState({ highlight: range ? { range, kind } : undefined });
}

export function revealInEditor(range: Range): void {
    setState({ reveal: { range, nonce: Date.now() } });
}

export function setTheme(theme: ThemePreference): void {
    setState({ theme });
    save('theme', theme);
}

export function setPaletteOpen(paletteOpen: boolean): void {
    setState({ paletteOpen });
}

export function setReferenceOpen(referenceOpen: boolean): void {
    setState({ referenceOpen });
}

export function toast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
    const id = ++toastSeq;
    setState({ toast: { id, message, tone } });
    setTimeout(() => {
        if (getState().toast?.id === id) setState({ toast: undefined });
    }, 3200);
}

export function dismissToast(): void {
    setState({ toast: undefined });
}

export function markLessonComplete(id: string): void {
    const completed = getState().completedLessons;
    if (completed.includes(id)) return;
    const next = [...completed, id];
    setState({ completedLessons: next });
    save('completedLessons', next);
}

export function resetTourProgress(): void {
    setState({ completedLessons: [] });
    save('completedLessons', []);
}

export function forgetWorkspace(scope: Scope): void {
    remove(storageKey(scope));
}

export function restartEngine(): void {
    appliedHostKey = undefined;
    engine().restart();
    void run();
}

export function warmUpEngine(): void {
    void engine()
        .call('warmUp')
        .catch(() => undefined);
}

/** Sets the screen-reader announcement for a finished run (rendered into an aria-live region). */
function announce(report: NonNullable<ReturnType<typeof getState>['report']>): void {
    const result = report.result;
    const announcement = report.error
        ? `Failed: ${report.error.message}`
        : report.refusal
          ? `Checked. ${report.refusal.label} are not executed yet.`
          : report.stage === 'check' || report.stage === 'parse'
            ? `${report.diagnostics.length} problem${report.diagnostics.length === 1 ? '' : 's'}`
            : result?.kind === 'rows'
              ? `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} in ${Math.round(report.totalMs)} milliseconds`
              : result?.kind === 'verdict'
                ? `Rule ${result.value ? 'passes' : 'fails'}`
                : result?.kind === 'value'
                  ? `Value: ${JSON.stringify(result.value)}`
                  : 'Done';
    setState({ announcement });
}
