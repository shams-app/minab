#!/usr/bin/env node
/**
 * The plan guard: fails a pull request that edits a protected file its phase
 * may not edit (see docs/production/README.md, "Protected files").
 *
 * The phase comes from the pull request title: `[C3] Run CAST` is phase C3.
 * A title without an `[ID]` prefix is the owner's own pull request: everything
 * is allowed, and the guard prints a notice.
 *
 * Usage (from the repository root, Node 18+, no dependencies):
 *   node scripts/plan-guard.mjs --title "<PR title>" <file> [<file> ...]
 *   git diff --name-status origin/main...HEAD | node scripts/plan-guard.mjs --title "<PR title>"
 *
 * Files come from the arguments or, when there are none, from stdin, one per
 * line. A line may be a plain path (treated as changed) or a
 * `git diff --name-status` line (`A`, `M`, `D` + tab + path; `R`/`C` + tab +
 * old path + tab + new path). The status matters only for one rule: a release
 * phase may delete any changelog fragment.
 *
 * Exit 0: no problem. Exit 1: at least one file is not allowed. Exit 2: bad usage.
 */
import { readFileSync } from 'node:fs';

const RELEASE_CHANGELOG = ['V1', 'V2', 'V3', 'V5'];
const RELEASE_ALL = ['V1', 'V2', 'V3', 'V4', 'V5'];
const README_OUTPUT_BLOCKS = ['C2', 'C3', 'C4', 'C6', 'R7', 'L7', 'X4', 'X5', 'X6'];

/**
 * @typedef {{ status: 'added' | 'changed' | 'deleted', path: string }} Change
 */

/** The phase ID from a title like `[C3] Run CAST`, or null. */
function phaseOf(title) {
    const match = title.trim().match(/^\[([A-Z][0-9]+)\]/);
    return match ? match[1] : null;
}

/** Parses one input line into changes (a rename gives a delete and an add). */
function parseLine(line) {
    const parts = line.split('\t').map(p => p.trim());
    if (parts.length === 1) {
        return parts[0] ? [{ status: 'changed', path: parts[0] }] : [];
    }
    const code = parts[0].charAt(0);
    if (code === 'R' && parts.length >= 3) {
        return [{ status: 'deleted', path: parts[1] }, { status: 'added', path: parts[2] }];
    }
    if (code === 'C' && parts.length >= 3) {
        return [{ status: 'added', path: parts[2] }];
    }
    const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'changed';
    return [{ status, path: parts[1] }];
}

/**
 * Returns null when the phase may make this change, or the reason it may not.
 * @param {string} phase
 * @param {Change} change
 */
function problemWith(phase, { status, path }) {
    const only = (allowed, what) =>
        allowed.includes(phase) ? null : `${what} may be changed only by ${allowed.map(id => `[${id}]`).join(', ')}`;

    if (path === 'CHANGELOG.md' || path === 'vscode-extension/CHANGELOG.md') {
        return only(RELEASE_CHANGELOG, 'a CHANGELOG (write changes/<ID>.md instead)');
    }
    if (path === 'README.md') {
        return only([...RELEASE_ALL, 'G1', ...README_OUTPUT_BLOCKS], 'the root README (C/R/L/X phases: checked output blocks only)');
    }
    if (path === 'docs/status.md' || path === 'docs/roadmap.md') {
        return only(['A1', 'V1'], 'this closed history file');
    }
    if (path === 'docs/production/progress.md') {
        return 'the progress page is built by the plan-progress workflow, never by a phase';
    }
    if (path === 'docs/production/README.md' || path.startsWith('docs/production/phases/')) {
        return only(['A2'], 'the plan rules and cards');
    }
    const statusFile = path.match(/^docs\/production\/status\/([A-Z][0-9]+)\.md$/);
    if (statusFile) {
        return statusFile[1] === phase ? null : `a phase writes only its own status file (docs/production/status/${phase}.md)`;
    }
    const fragment = path.match(/^changes\/([A-Z][0-9]+)(?:-[0-9]+)?\.md$/);
    if (fragment) {
        if (fragment[1] === phase) return null;
        if (status === 'deleted' && phase.startsWith('V')) return null;
        return `a phase writes only its own changelog fragments (changes/${phase}.md, changes/${phase}-2.md)`;
    }
    if (path === '.github/workflows/ci.yml') {
        return only(['Q1'], 'ci.yml (add a new workflow file instead)');
    }
    return null;
}

/**
 * Checks a pull request. Returns the lines to print and whether it passed.
 * @param {string} title
 * @param {Change[]} changes
 */
function check(title, changes) {
    const phase = phaseOf(title);
    if (!phase) {
        return {
            ok: true,
            lines: [`Notice: the title has no [ID] prefix, so this is the owner's own pull request. All ${changes.length} changed files are allowed.`]
        };
    }
    const lines = [];
    for (const change of changes) {
        const problem = problemWith(phase, change);
        if (problem) lines.push(`Not allowed in [${phase}]: ${change.path} (${change.status}): ${problem}.`);
    }
    if (lines.length === 0) {
        lines.push(`Plan guard passed for [${phase}]: ${changes.length} changed files, none protected outside this phase.`);
        return { ok: true, lines };
    }
    lines.push('', 'See docs/production/README.md, "Protected files". If your card allows the change, ask the owner.');
    return { ok: false, lines };
}

function main(argv) {
    let title = null;
    const files = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--title') title = argv[++i] ?? null;
        else files.push(argv[i]);
    }
    if (title === null) {
        console.error('Usage: node scripts/plan-guard.mjs --title "<PR title>" [<file> ...]  (files from stdin when none are given)');
        return 2;
    }
    const lines = files.length > 0 ? files : readFileSync(0, 'utf8').split('\n');
    const result = check(title, lines.flatMap(parseLine));
    (result.ok ? console.log : console.error)(result.lines.join('\n'));
    return result.ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
