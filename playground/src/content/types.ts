/**
 * The shapes of the playground's content: examples, record presets, and the
 * host each example runs against. Content is plain data so the gallery,
 * the tour, the workbench and the tests all read the same thing — and
 * `test/content.test.ts` runs every entry, so nothing on the site is
 * broken without a failing test saying so.
 */

import type { Row } from '../engine/protocol.js';

export type ExampleTag =
    | 'query'
    | 'record-rule'
    | 'field-rule'
    | 'aggregates'
    | 'joins'
    | 'functions'
    | 'control-flow'
    | 'types'
    | 'json'
    | 'writes'
    | 'check-only';

export type Level = 'beginner' | 'intermediate' | 'advanced';

/** What an example's host looks like: a dataset plus the rule context a real host would supply. */
export interface ExampleHost {
    /** A dataset id (`demo`), or a schema of its own for check-only programs that need tables the demo lacks. */
    dataset: string | { schema: { tables: unknown[] } };
    rule?: { recordTable?: string; fieldType?: string };
    record?: Row;
    fieldValue?: unknown;
}

/** A one-click alternative record (or `$` value) that flips a rule's verdict. */
export interface RecordPreset {
    id: string;
    label: string;
    /** What the rule should answer for this preset — checked by the tests. */
    expect: boolean;
    /** Why, in a sentence: shown under the chip. */
    note: string;
    record?: Row;
    fieldValue?: unknown;
}

export type Expectation =
    | { kind: 'rows'; count: number; first?: Row }
    | { kind: 'verdict'; value: boolean; statements?: number }
    | { kind: 'value'; value: unknown; statements?: number; /** The log lines (`LOG`) the run must make, in order. */ logs?: string[] }
    | { kind: 'check-only'; construct: string }
    | { kind: 'diagnostics'; message: RegExp };

export interface Example {
    id: string;
    title: string;
    /** One line for the gallery card. */
    summary: string;
    /** Markdown: what to notice when it runs. */
    notes: string;
    source: string;
    tags: ExampleTag[];
    level: Level;
    specRef: string;
    /** Where it lives in the repository, for examples that are the repo's own (`examples/<id>`). */
    repoPath?: string;
    host: ExampleHost;
    presets?: RecordPreset[];
    /** The output tab worth opening first. */
    focus: 'result' | 'sql' | 'execution' | 'console' | 'problems';
    expect: Expectation;
}

/** What a lesson's goal check sees: the latest run, and the source that produced it. */
export interface GoalContext {
    report: import('../engine/protocol.js').RunReport;
    source: string;
}

export interface Lesson {
    id: string;
    number: number;
    title: string;
    /** One line for the lesson list. */
    summary: string;
    /** Markdown: the explanation, then the task. */
    body: string;
    starter: string;
    solution: string;
    host: ExampleHost;
    /** For lessons solved by changing the record rather than the code. */
    solutionHost?: Pick<ExampleHost, 'record' | 'fieldValue'>;
    presets?: RecordPreset[];
    /** The task, in one sentence — shown next to the goal status. */
    task: string;
    goal: (context: GoalContext) => boolean;
    hints: string[];
    focus: Example['focus'];
}
