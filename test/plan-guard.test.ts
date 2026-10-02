/**
 * Production plan phase A1 — the plan guard (`scripts/plan-guard.mjs`).
 * The guard runs on every pull request and fails one that edits a protected
 * file its phase may not edit (docs/production/README.md, "Protected files").
 * These tests run the real script, the same way the workflow does.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const script = resolve(import.meta.dirname, '../scripts/plan-guard.mjs');

/** Runs the guard with `git diff --name-status` style lines on stdin. */
function guard(title: string, ...lines: string[]) {
    const result = spawnSync(process.execPath, [script, '--title', title], { input: lines.join('\n') + '\n', encoding: 'utf8' });
    return { code: result.status, output: result.stdout + result.stderr };
}

describe('plan guard', () => {
    test('only release phases change CHANGELOG.md', () => {
        const fails = guard('[C3] Run CAST', 'M\tCHANGELOG.md');
        expect(fails.code).toBe(1);
        expect(fails.output).toContain('CHANGELOG.md');
        expect(guard('[V1] First public release', 'M\tCHANGELOG.md').code).toBe(0);
    });

    test('a phase changes only its own status file', () => {
        expect(guard('[C3] Run CAST', 'A\tdocs/production/status/C3.md').code).toBe(0);
        const fails = guard('[C3] Run CAST', 'A\tdocs/production/status/C3.md', 'A\tdocs/production/status/C4.md');
        expect(fails.code).toBe(1);
        expect(fails.output).toContain('docs/production/status/C4.md');
        expect(fails.output).not.toContain('status/C3.md (');
    });

    test('a phase changes only its own changelog fragments', () => {
        expect(guard('[C3] Run CAST', 'A\tchanges/C3.md', 'A\tchanges/C3-2.md').code).toBe(0);
        const fails = guard('[C3] Run CAST', 'A\tchanges/C4.md');
        expect(fails.code).toBe(1);
        expect(fails.output).toContain('changes/C4.md');
        // C30 is not C3.
        expect(guard('[C3] Run CAST', 'A\tchanges/C30.md').code).toBe(1);
    });

    test('a release phase may delete any fragment, but not write one', () => {
        expect(guard('[V2] Release 0.3', 'D\tchanges/C3.md').code).toBe(0);
        expect(guard('[V2] Release 0.3', 'M\tchanges/C3.md').code).toBe(1);
        expect(guard('[C4] Fix nulls', 'D\tchanges/C3.md').code).toBe(1);
    });

    test('a title without [ID] is the owner: everything passes, with a notice', () => {
        const result = guard('Tidy the plan', 'M\tCHANGELOG.md', 'M\tdocs/production/progress.md', 'M\tdocs/production/status/C3.md');
        expect(result.code).toBe(0);
        expect(result.output).toContain('Notice');
    });

    test('only Q1 changes ci.yml', () => {
        expect(guard('[Q2] Release workflow', 'M\t.github/workflows/ci.yml').code).toBe(1);
        expect(guard('[Q1] CI matrix', 'M\t.github/workflows/ci.yml').code).toBe(0);
    });

    test('the other protected files', () => {
        expect(guard('[C3] Run CAST', 'M\tdocs/production/progress.md').code).toBe(1);
        expect(guard('[A2] Decision sitting', 'M\tdocs/production/progress.md').code).toBe(1);
        expect(guard('[C3] Run CAST', 'M\tdocs/production/phases/C3.md').code).toBe(1);
        expect(guard('[A2] Decision sitting', 'M\tdocs/production/phases/C3.md', 'M\tdocs/production/README.md').code).toBe(0);
        expect(guard('[C3] Run CAST', 'M\tdocs/status.md').code).toBe(1);
        expect(guard('[A1] Plan bootstrap', 'M\tdocs/status.md', 'M\tdocs/roadmap.md').code).toBe(0);
        expect(guard('[Q1] CI matrix', 'M\tREADME.md').code).toBe(1);
        expect(guard('[C3] Run CAST', 'M\tREADME.md').code).toBe(0);
        expect(guard('[G1] Launch', 'M\tREADME.md').code).toBe(0);
    });

    test('unprotected files and plain paths pass', () => {
        expect(guard('[C3] Run CAST', 'src/language/minab-interpreter.ts', 'M\ttest/evaluation.test.ts').code).toBe(0);
    });

    test('a rename out of a protected path counts as deleting it', () => {
        expect(guard('[C3] Run CAST', 'R100\tdocs/production/status/C4.md\tdocs/production/status/C3.md').code).toBe(1);
    });

    test('files can also come as arguments', () => {
        const result = spawnSync(process.execPath, [script, '--title', '[C3] Run CAST', 'CHANGELOG.md'], { encoding: 'utf8' });
        expect(result.status).toBe(1);
    });

    test('a missing --title is a usage error', () => {
        const result = spawnSync(process.execPath, [script, 'CHANGELOG.md'], { encoding: 'utf8' });
        expect(result.status).toBe(2);
    });
});
