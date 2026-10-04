/**
 * The playground's state, in one store.
 *
 * Only data lives here — what's being edited, what the engine last said,
 * which tab is open. The async choreography (debounced analysis, auto-run,
 * applying a host before running) is in `controller.ts`, and components
 * read state through the hooks in `src/hooks/`, never this store directly.
 */

import { create } from 'zustand';
import type { AnalyzeReport, EngineStatus, Range, RunReport } from '../engine/protocol.js';
import { EMPTY_HOST, type Workspace } from './workspace.js';
import { load } from './persistence.js';

export type OutputTab = 'result' | 'sql' | 'execution' | 'console' | 'ast' | 'problems';
export type HostTab = 'schema' | 'data' | 'record' | 'field';
export type ThemePreference = 'system' | 'light' | 'dark';

/** Which surface owns the active workspace: the playground, a lesson, or an embed. */
export type Scope = 'play' | 'embed' | `lesson:${string}`;

export interface Toast {
    id: number;
    message: string;
    tone: 'info' | 'success' | 'error';
}

/** A source span the editor should emphasize — a pushed-down subexpression, an AST node, a problem. */
export interface Highlight {
    range: Range;
    kind: 'pushdown' | 'ast' | 'problem' | 'log';
}

export interface PlaygroundState {
    engine: EngineStatus;
    scope: Scope;
    workspace: Workspace;
    analysis?: AnalyzeReport;
    report?: RunReport;
    /** The source the current report was produced from — when it differs from the editor's, the result is stale. */
    reportSource?: string;
    running: boolean;
    autoRun: boolean;
    hostError?: string;
    hostTables: string[];
    outputTab: OutputTab;
    hostTab: HostTab;
    hostOpen: boolean;
    highlight?: Highlight;
    /** A one-off request for the editor to reveal and select a range (clicking a problem, say). */
    reveal?: { range: Range; nonce: number };
    theme: ThemePreference;
    paletteOpen: boolean;
    referenceOpen: boolean;
    toast?: Toast;
    /** Lesson ids the visitor has completed. */
    completedLessons: string[];
    /** The last run, in words, for screen readers. */
    announcement: string;
}

export const usePlayground = create<PlaygroundState>()(() => ({
    engine: { phase: 'starting' },
    scope: 'play',
    workspace: { source: '', host: EMPTY_HOST },
    running: false,
    autoRun: load<boolean>('autoRun') ?? true,
    hostTables: [],
    outputTab: 'result',
    hostTab: 'data',
    hostOpen: true,
    theme: load<ThemePreference>('theme') ?? 'system',
    paletteOpen: false,
    referenceOpen: false,
    completedLessons: load<string[]>('completedLessons') ?? [],
    announcement: ''
}));

export const setState = usePlayground.setState;
export const getState = usePlayground.getState;
