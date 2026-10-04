/**
 * Production plan phase Q4 — the budget check of `bench/`. It uses a results file, so no bench runs here.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { compare, toMarkdown, type Budgets } from '../bench/check.mjs';
import type { BenchResults } from '../bench/run.mjs';

const budgets: Budgets = JSON.parse(readFileSync(resolve('bench/budgets.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'minab-bench-'));

/** Results that are well inside every budget. */
function goodResults(): BenchResults {
    return {
        node: 'test',
        platform: 'test',
        rows: Object.fromEntries(Object.entries(budgets.rows).map(([id, row]) => [id, { value: row.budget / 2, unit: row.unit }]))
    };
}

function check(results: BenchResults, budgetsFile: Budgets) {
    const resultsPath = join(scratch, 'results.json');
    const budgetsPath = join(scratch, 'budgets.json');
    writeFileSync(resultsPath, JSON.stringify(results));
    writeFileSync(budgetsPath, JSON.stringify(budgetsFile));
    return spawnSync(process.execPath, [resolve('bench/check.mjs'), '--results', resultsPath, '--budgets', budgetsPath], { encoding: 'utf8' });
}

describe('bench/budgets.json', () => {
    test('has the eight agreed rows, each with a budget above zero', () => {
        expect(Object.keys(budgets.rows).sort()).toEqual(
            ['completion', 'memory50', 'prepareCold', 'prepareWarm', 'rerun100', 'runCorrelated', 'runLocal', 'workerGzip'].sort()
        );
        for (const row of Object.values(budgets.rows)) expect(row.budget).toBeGreaterThan(0);
        expect(budgets.allowance).toBe(1.5);
    });
});

describe('compare', () => {
    test('a result inside the budget is ok, between the budget and the allowance is a warning, above it fails', () => {
        const results = goodResults();
        results.rows.prepareWarm!.value = 6; // budget 5, limit 7.5
        results.rows.runLocal!.value = 0.2; // budget 0.05, limit 0.075
        const { rows, ok } = compare(results, budgets);
        const status = Object.fromEntries(rows.map(row => [row.id, row.status]));
        expect(status.prepareWarm).toBe('warn');
        expect(status.runLocal).toBe('fail');
        expect(status.completion).toBe('ok');
        expect(ok).toBe(false);
    });

    test('a row with allowance 1 (the bundle size) fails at once above its budget', () => {
        const results = goodResults();
        results.rows.workerGzip!.value = budgets.rows.workerGzip!.budget + 1;
        expect(compare(results, budgets).rows.find(row => row.id === 'workerGzip')!.status).toBe('fail');
    });

    test('a row that was not measured fails', () => {
        const results = goodResults();
        delete results.rows.memory50;
        const outcome = compare(results, budgets);
        expect(outcome.ok).toBe(false);
        expect(outcome.rows.find(row => row.id === 'memory50')!.status).toBe('missing');
        expect(toMarkdown(outcome)).toContain('not measured');
    });
});

describe('bench:check', () => {
    test('passes with good results', () => {
        const run = check(goodResults(), budgets);
        expect(run.status).toBe(0);
        expect(run.stdout).toContain('All rows are within their limits.');
    });

    test('fails when a budget is lowered below the measured number', () => {
        const lowered: Budgets = structuredClone(budgets);
        lowered.rows.prepareWarm!.budget = 0.01; // the results say 2.5 ms
        const run = check(goodResults(), lowered);
        expect(run.status).toBe(1);
        expect(run.stdout).toContain('Some rows are above their limits.');
        expect(run.stdout).toMatch(/prepare a typical one-line rule.*fail/);
    });
});

process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
