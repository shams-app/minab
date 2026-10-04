import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { examples } from '../src/content/examples/index.js';
import { lessons } from '../src/content/tour/index.js';
import type { Example, ExampleHost, Lesson } from '../src/content/types.js';
import { Engine } from '../src/engine/engine.js';
import type { RunReport } from '../src/engine/protocol.js';
import { hostSettings, workspaceFromExample, type WorkspaceHost } from '../src/state/workspace.js';

/**
 * The showcase never shows something broken: every gallery example, every
 * record preset and every tour lesson runs here against the real engine
 * and the real (in-process) Postgres, and must do what its content says.
 */

let engine: Engine;
let runId = 0;

beforeAll(() => {
    engine = new Engine();
});
afterAll(() => engine.close());

function hostFrom(host: ExampleHost, overrides: Partial<WorkspaceHost> = {}): WorkspaceHost {
    return {
        dataset: typeof host.dataset === 'string' ? host.dataset : null,
        schema: typeof host.dataset === 'string' ? undefined : host.dataset.schema,
        rule: { ...host.rule },
        record: host.record,
        fieldValue: host.fieldValue,
        dataSource: 'postgres',
        ...overrides
    };
}

async function run(source: string, host: WorkspaceHost): Promise<RunReport> {
    const set = await engine.setHost(hostSettings(host));
    expect(set, 'host config').toEqual(expect.objectContaining({ ok: true }));
    return engine.run(source, ++runId);
}

function describeReport(report: RunReport): string {
    return JSON.stringify({
        stage: report.stage,
        result: report.result,
        refusal: report.refusal,
        error: report.error,
        diagnostics: report.diagnostics.map(d => d.message),
        statements: report.trace.length
    });
}

function assertExpectation(example: Example, report: RunReport): void {
    const expectation = example.expect;
    const context = `${example.id}: ${describeReport(report)}`;
    switch (expectation.kind) {
        case 'rows':
            expect(report.stage, context).toBe('done');
            expect(report.result?.kind, context).toBe('rows');
            if (report.result?.kind !== 'rows') return;
            expect(report.result.rows, context).toHaveLength(expectation.count);
            if (expectation.first) expect(report.result.rows[0], context).toMatchObject(expectation.first);
            expect(report.trace, context).toHaveLength(1);
            return;
        case 'verdict':
            expect(report.stage, context).toBe('done');
            expect(report.result, context).toEqual({ kind: 'verdict', value: expectation.value });
            if (expectation.statements !== undefined) expect(report.trace, context).toHaveLength(expectation.statements);
            return;
        case 'value':
            expect(report.stage, context).toBe('done');
            expect(report.result, context).toMatchObject({ kind: 'value', value: expectation.value });
            if (expectation.statements !== undefined) expect(report.trace, context).toHaveLength(expectation.statements);
            if (expectation.logs !== undefined)
                expect(
                    report.logs.map(l => l.message),
                    context
                ).toEqual(expectation.logs);
            return;
        case 'check-only':
            expect(report.diagnostics, context).toEqual([]);
            expect(report.program.checkOnly, context).toBe(true);
            expect(report.refusal?.construct, context).toBe(expectation.construct);
            return;
        case 'diagnostics':
            expect(report.stage, context).toBe('check');
            expect(report.diagnostics.map(d => d.message).join('\n'), context).toMatch(expectation.message);
            return;
    }
}

describe('gallery examples', () => {
    test('ids are unique', () => {
        expect(new Set(examples.map(e => e.id)).size).toBe(examples.length);
    });

    test.each(examples.map(e => [e.id, e] as const))('%s does what its card says', async (_id, example) => {
        const workspace = workspaceFromExample(example);
        const report = await run(workspace.source, workspace.host);
        assertExpectation(example, report);
        if (example.expect.kind !== 'diagnostics') {
            expect(
                report.diagnostics.filter(d => d.severity === 1),
                example.id
            ).toEqual([]);
        }
    });

    const withPresets = examples.filter(e => e.presets?.length);
    test.each(withPresets.map(e => [e.id, e] as const))('%s presets give the verdict they promise', async (_id, example) => {
        for (const preset of example.presets!) {
            const host = hostFrom(example.host, {
                ...(preset.record ? { record: preset.record } : {}),
                ...(preset.fieldValue !== undefined ? { fieldValue: preset.fieldValue } : {})
            });
            const report = await run(example.source, host);
            expect(report.result, `${example.id} / ${preset.id}: ${describeReport(report)}`).toEqual({ kind: 'verdict', value: preset.expect });
        }
    });

    test('the first preset of a rule example matches its default record', () => {
        for (const example of withPresets) {
            const first = example.presets![0];
            if (first.record) expect(first.record, example.id).toEqual(example.host.record);
            if (first.fieldValue !== undefined) expect(first.fieldValue, example.id).toEqual(example.host.fieldValue);
        }
    });
});

describe('tour lessons', () => {
    test('are numbered in order', () => {
        expect(lessons.map(l => l.number)).toEqual(lessons.map((_, i) => i + 1));
    });

    const goalOf = async (lesson: Lesson, source: string, host: WorkspaceHost) => {
        const report = await run(source, host);
        return { met: lesson.goal({ report, source }), report };
    };

    test.each(lessons.map(l => [l.id, l] as const))('%s: the solution meets the goal', async (_id, lesson) => {
        const host = hostFrom(lesson.host, lesson.solutionHost ?? {});
        const { met, report } = await goalOf(lesson, lesson.solution, host);
        expect(met, `${lesson.id}: ${describeReport(report)}`).toBe(true);
    });

    test.each(lessons.map(l => [l.id, l] as const))('%s: the starter leaves something to do', async (_id, lesson) => {
        const nothingToChange = lesson.starter === lesson.solution && !lesson.solutionHost;
        const { met, report } = await goalOf(lesson, lesson.starter, hostFrom(lesson.host));
        expect(met, `${lesson.id}: ${describeReport(report)}`).toBe(nothingToChange);
        // A starter may fail its goal, but it must never be broken in a way the lesson doesn't intend.
        if (lesson.id !== 'strict-types') {
            expect(
                report.diagnostics.filter(d => d.severity === 1),
                lesson.id
            ).toEqual([]);
        }
    });

    test.each(lessons.filter(l => l.presets).map(l => [l.id, l] as const))('%s presets give the verdict they promise', async (_id, lesson) => {
        for (const preset of lesson.presets!) {
            const host = hostFrom(lesson.host, {
                ...(preset.record ? { record: preset.record } : {}),
                ...(preset.fieldValue !== undefined ? { fieldValue: preset.fieldValue } : {})
            });
            const report = await run(lesson.solution, host);
            expect(report.result, `${lesson.id} / ${preset.id}: ${describeReport(report)}`).toEqual({ kind: 'verdict', value: preset.expect });
        }
    });
});
