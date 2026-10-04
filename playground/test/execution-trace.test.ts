import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { examples } from '../src/content/examples/index.js';
import { Engine } from '../src/engine/engine.js';
import { hostSettings, workspaceFromExample } from '../src/state/workspace.js';

/**
 * The Execution tab data (statement text, parameters, source ranges, rows) of
 * three gallery examples, recorded before the engine moved to the runtime API
 * (R8). The data must stay the same. Set `UPDATE_TRACE_BASELINE=1` to record it again.
 */

const IDS = ['first-query', 'booking-overlap', 'customer-exists'];
const FIXTURE = new URL('./fixtures/execution-trace.json', import.meta.url);

let engine: Engine;
beforeAll(() => {
    engine = new Engine();
});
afterAll(() => engine.close());

async function traceOf(id: string) {
    const example = examples.find(e => e.id === id)!;
    const workspace = workspaceFromExample(example);
    await engine.setHost(hostSettings(workspace.host));
    const report = await engine.run(workspace.source, 1);
    // Durations change from run to run, so they are left out.
    return {
        stage: report.stage,
        result: report.result,
        trace: report.trace.map(({ durationMs: _durationMs, ...entry }) => entry)
    };
}

// One run after another: the engine has one host at a time.
async function allTraces() {
    const all: Record<string, Awaited<ReturnType<typeof traceOf>>> = {};
    for (const id of IDS) all[id] = await traceOf(id);
    return all;
}

describe('execution trace', () => {
    test.each(IDS)('%s keeps the same statements, ranges and rows', async id => {
        if (process.env.UPDATE_TRACE_BASELINE && id === IDS[0]) writeFileSync(FIXTURE, JSON.stringify(await allTraces(), null, 2) + '\n');
        const actual = await traceOf(id);
        const baseline = JSON.parse(readFileSync(FIXTURE, 'utf8'));
        expect(actual.trace.length).toBeGreaterThan(0);
        expect(JSON.parse(JSON.stringify(actual))).toEqual(baseline[id]);
    });
});
