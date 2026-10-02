#!/usr/bin/env node
/**
 * Builds the production plan's progress page.
 *
 * Reads:
 *   - docs/production/phases/README.md: the phase list (rows `| [ID](ID.md) | Title | Kind | Size | Depends |`
 *     under `### <Lane> — <name>` headings). Depends is a list of links, or `—`.
 *   - docs/production/status/<ID>.md: `Status: ...`, and the sections "Questions for the owner" and "Later".
 *     No file means "not started".
 *   - docs/production/decisions.md: `**Answer:** _(open)_` marks an open decision.
 *   - docs/production/phases/prompts.md: one `### <ID> ` heading per phase (checked by --check).
 *
 * Usage (from the repository root, Node 18+, no dependencies):
 *   node docs/production/tools/progress.mjs           print the progress page to stdout
 *   node docs/production/tools/progress.mjs --write   write docs/production/progress.md
 *   node docs/production/tools/progress.mjs --check   check the plan files; exit 1 on a problem
 *   node docs/production/tools/progress.mjs --ready   print only the IDs that can start now
 *
 * Phase sessions never run --write and never commit progress.md: CI (or the owner) does,
 * after a merge. That is what keeps phase pull requests from colliding.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PHASES_DIR = join(PLAN_DIR, 'phases');
const STATUS_DIR = join(PLAN_DIR, 'status');
const LIST = join(PHASES_DIR, 'README.md');
const PROMPTS = join(PHASES_DIR, 'prompts.md');
const DECISIONS = join(PLAN_DIR, 'decisions.md');
const OUTPUT = join(PLAN_DIR, 'progress.md');

const STATUSES = ['done', 'waiting for approval', 'blocked', 'partial'];

/** @typedef {{ id: string, title: string, kind: string, size: string, lane: string, deps: string[], status: string }} Phase */

function readPhases() {
    const text = readFileSync(LIST, 'utf8');
    /** @type {Phase[]} */
    const phases = [];
    const problems = [];
    let lane = '';
    for (const line of text.split('\n')) {
        const heading = line.match(/^### ([A-Z]) — (.*)$/);
        if (heading) {
            lane = `${heading[1]} — ${heading[2]}`;
            continue;
        }
        const row = line.match(/^\| \[([A-Z][0-9]+)\]\(([^)]+)\) \| (.*?) \| (.*?) \| (.*?) \| (.*) \|$/);
        if (!row) continue;
        if (!lane) {
            problems.push(`row ${row[1]} is not under a lane heading`);
            continue;
        }
        const deps = [...row[6].matchAll(/\[([A-Z][0-9]+)\]\([^)]+\)/g)].map(m => m[1]);
        phases.push({ id: row[1], title: row[3], kind: row[4], size: row[5], lane, deps, status: 'not started' });
        if (row[2] !== `${row[1]}.md`) problems.push(`row ${row[1]} links to ${row[2]}, expected ${row[1]}.md`);
    }
    return { phases, problems };
}

function readStatus(id) {
    const path = join(STATUS_DIR, `${id}.md`);
    if (!existsSync(path)) return undefined;
    const text = readFileSync(path, 'utf8');
    const status = text.match(/^Status:\s*(.+?)\s*$/m)?.[1]?.toLowerCase() ?? 'unknown';
    return { status, questions: section(text, 'Questions for the owner'), later: section(text, 'Later') };
}

/** The bullet or paragraph lines of a `## <name>` section, without "None". */
function section(text, name) {
    const lines = text.split('\n');
    const start = lines.findIndex(l => l.trim().toLowerCase() === `## ${name.toLowerCase()}`);
    if (start < 0) return [];
    const out = [];
    for (const line of lines.slice(start + 1)) {
        if (/^## /.test(line)) break;
        const trimmed = line.trim();
        if (!trimmed || /^none\.?$/i.test(trimmed)) continue;
        out.push(trimmed.replace(/^[-*]\s+/, ''));
    }
    return out;
}

function readDecisions() {
    if (!existsSync(DECISIONS)) return { total: 0, open: [] };
    const text = readFileSync(DECISIONS, 'utf8');
    const blocks = text.split(/<a id="(d\d+)"><\/a>/).slice(1);
    const open = [];
    let total = 0;
    for (let i = 0; i < blocks.length; i += 2) {
        total++;
        const answer = blocks[i + 1].match(/\*\*Answer:\*\*(.*)/)?.[1] ?? '';
        if (!answer.trim() || answer.includes('_(open)_')) open.push(blocks[i].toUpperCase());
    }
    return { total, open };
}

function check(phases, listProblems) {
    const problems = [...listProblems];
    const ids = new Set();
    for (const p of phases) {
        if (ids.has(p.id)) problems.push(`duplicate phase id ${p.id}`);
        ids.add(p.id);
    }
    for (const p of phases) {
        for (const d of p.deps) if (!ids.has(d)) problems.push(`${p.id} depends on unknown phase ${d}`);
        if (p.deps.includes(p.id)) problems.push(`${p.id} depends on itself`);
        if (!existsSync(join(PHASES_DIR, `${p.id}.md`))) problems.push(`card phases/${p.id}.md is missing`);
    }
    const prompts = existsSync(PROMPTS) ? readFileSync(PROMPTS, 'utf8') : '';
    for (const p of phases) {
        if (!new RegExp(`^### ${p.id} `, 'm').test(prompts)) problems.push(`phases/prompts.md has no "### ${p.id} " prompt`);
    }
    // cycles
    const state = new Map();
    const byId = new Map(phases.map(p => [p.id, p]));
    const visit = (id, path) => {
        if (state.get(id) === 'done') return;
        if (state.get(id) === 'active') {
            problems.push(`dependency cycle: ${[...path, id].join(' → ')}`);
            return;
        }
        state.set(id, 'active');
        for (const d of byId.get(id)?.deps ?? []) visit(d, [...path, id]);
        state.set(id, 'done');
    };
    for (const p of phases) visit(p.id, []);
    // status files
    if (existsSync(STATUS_DIR)) {
        for (const file of readdirSync(STATUS_DIR)) {
            if (!file.endsWith('.md') || file === 'README.md') continue;
            const id = file.slice(0, -3);
            if (!ids.has(id)) problems.push(`status/${file} has no phase in the list`);
            const s = readStatus(id);
            if (s && !STATUSES.includes(s.status)) problems.push(`status/${file}: unknown status "${s.status}"`);
        }
    }
    return problems;
}

/** Earliest wave per phase: 1 + the latest wave of its Depends (wave 1 = no Depends). */
function waves(phases) {
    const byId = new Map(phases.map(p => [p.id, p]));
    const memo = new Map();
    const wave = id => {
        if (memo.has(id)) return memo.get(id);
        memo.set(id, 1);
        const deps = byId.get(id)?.deps ?? [];
        const w = deps.length ? 1 + Math.max(...deps.map(wave)) : 1;
        memo.set(id, w);
        return w;
    };
    for (const p of phases) wave(p.id);
    return memo;
}

/** Drops edges implied by other edges, so the graph stays readable. */
function reducedEdges(phases) {
    const byId = new Map(phases.map(p => [p.id, p]));
    const reach = new Map();
    const reachable = id => {
        if (reach.has(id)) return reach.get(id);
        const set = new Set();
        reach.set(id, set);
        for (const d of byId.get(id)?.deps ?? []) {
            set.add(d);
            for (const x of reachable(d)) set.add(x);
        }
        return set;
    };
    const edges = [];
    for (const p of phases) {
        for (const d of p.deps) {
            const implied = p.deps.some(o => o !== d && reachable(o).has(d));
            if (!implied) edges.push([d, p.id]);
        }
    }
    return edges;
}

function build() {
    const { phases, problems: listProblems } = readPhases();
    const questions = [];
    const later = [];
    for (const p of phases) {
        const s = readStatus(p.id);
        if (!s) continue;
        p.status = s.status;
        for (const q of s.questions) questions.push(`**${p.id}:** ${q}`);
        for (const l of s.later) later.push(`**${p.id}:** ${l}`);
    }
    const done = id => phases.find(p => p.id === id)?.status === 'done';
    for (const p of phases) {
        if (p.status === 'not started' && p.deps.every(done)) p.status = 'ready';
    }
    return { phases, listProblems, questions, later };
}

const CLASS = {
    done: 'done',
    'waiting for approval': 'waiting',
    blocked: 'blocked',
    partial: 'partial',
    ready: 'ready',
    'not started': 'todo'
};

function render({ phases, questions, later }) {
    const w = waves(phases);
    const decisions = readDecisions();
    const count = s => phases.filter(p => p.status === s).length;
    const list = s => {
        const items = phases.filter(p => p.status === s).map(p => `[${p.id}](phases/${p.id}.md)`);
        return items.length ? items.join(', ') : 'none';
    };
    const out = [];
    out.push('# Progress');
    out.push('');
    out.push('**Generated by `node docs/production/tools/progress.mjs --write`. Do not edit by hand.** Phase branches never change this file; CI rebuilds it after each merge to `main`.');
    out.push('');
    out.push(
        `**${count('done')} of ${phases.length} done** · ${count('waiting for approval')} waiting for approval · ${count('blocked')} blocked · ${count('partial')} partial · **${count('ready')} ready to start** · ${count('not started')} not started · decisions answered: ${decisions.total - decisions.open.length} of ${decisions.total}`
    );
    out.push('');
    out.push('Legend: 🟩 done · 🟨 waiting for approval · 🟥 blocked · 🟧 partial · ⬜ with a **bold blue outline**: ready to start (all Depends done) · ⬜ grey: not started. Arrows point from a phase to the phases that need it (arrows implied by other arrows are left out).');
    out.push('');
    out.push('```mermaid');
    out.push('flowchart LR');
    const lanes = [...new Set(phases.map(p => p.lane))];
    lanes.forEach((lane, i) => {
        out.push(`   subgraph lane${i}["${lane}"]`);
        out.push('      direction TB');
        for (const p of phases.filter(x => x.lane === lane)) out.push(`      ${p.id}["${p.id}"]:::${CLASS[p.status] ?? 'todo'}`);
        out.push('   end');
    });
    for (const [from, to] of reducedEdges(phases)) out.push(`   ${from} --> ${to}`);
    out.push('   classDef done fill:#2da44e,stroke:#1a7f37,color:#fff');
    out.push('   classDef waiting fill:#d4a72c,stroke:#9a6700,color:#000');
    out.push('   classDef blocked fill:#cf222e,stroke:#a40e26,color:#fff');
    out.push('   classDef partial fill:#fb8f44,stroke:#bc4c00,color:#000');
    out.push('   classDef ready fill:#fff,stroke:#0969da,stroke-width:3px,color:#000');
    out.push('   classDef todo fill:#eaeef2,stroke:#8c959f,color:#57606a');
    out.push('```');
    out.push('');
    out.push(`**Ready to start now (${count('ready')}):** ${list('ready')}`);
    out.push('');
    out.push(`**Waiting for approval (${count('waiting for approval')}):** ${list('waiting for approval')}`);
    out.push('');
    out.push(`**Blocked (${count('blocked')}):** ${list('blocked')}`);
    out.push('');
    out.push(`**Partial (${count('partial')}):** ${list('partial')}`);
    out.push('');
    out.push(`**Not started, waiting on Depends (${count('not started')}):** ${list('not started')}`);
    out.push('');
    out.push(`**Done (${count('done')}):** ${list('done')}`);
    out.push('');
    out.push(`**Open decisions (${decisions.open.length}):** ${decisions.open.length ? decisions.open.map(d => `[${d}](decisions.md#${d.toLowerCase()})`).join(', ') : 'none'}`);
    out.push('');
    out.push('## Waves');
    out.push('');
    out.push('The earliest wave each phase can run in, if every phase took one step. Phases in the same wave can run at the same time. The number of waves is the length of the longest Depends chain.');
    out.push('');
    out.push('| Wave | Phases |');
    out.push('| --- | --- |');
    const maxWave = Math.max(...w.values());
    for (let i = 1; i <= maxWave; i++) {
        const ids = phases.filter(p => w.get(p.id) === i).map(p => (p.status === 'done' ? `~~${p.id}~~` : p.id));
        out.push(`| ${i} | ${ids.join(', ')} |`);
    }
    out.push('');
    out.push('## Questions for the owner');
    out.push('');
    out.push('Collected from the "Questions for the owner" section of every status file.');
    out.push('');
    out.push(questions.length ? questions.map(q => `- ${q}`).join('\n') : 'None.');
    out.push('');
    out.push('## Later');
    out.push('');
    out.push('Collected from the "Later" section of every status file. This is the one list of deferred work; there is no shared TODO file.');
    out.push('');
    out.push(later.length ? later.map(l => `- ${l}`).join('\n') : 'None.');
    out.push('');
    return out.join('\n');
}

const args = new Set(process.argv.slice(2));
const result = build();

if (args.has('--check')) {
    const problems = check(result.phases, result.listProblems);
    if (problems.length) {
        console.error(`Plan check failed (${problems.length}):\n- ${problems.join('\n- ')}`);
        process.exit(1);
    }
    console.log(`Plan check passed: ${result.phases.length} phases, no problems.`);
} else if (args.has('--ready')) {
    console.log(result.phases.filter(p => p.status === 'ready').map(p => p.id).join(' '));
} else if (args.has('--write')) {
    writeFileSync(OUTPUT, render(result));
    console.log(`Wrote ${OUTPUT}`);
} else {
    process.stdout.write(render(result));
}
