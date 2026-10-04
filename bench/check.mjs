// `npm run bench:check`: runs the bench and fails when a row is above its budget times the allowance (phase Q4).
//
// Usage: node bench/check.mjs [--results <file>] [--budgets <file>]
//   --results  use a results file you already have (for example bench/results.json) and do not run the bench
//   --budgets  use another budgets file (the default is bench/budgets.json)
// On GitHub Actions the table is also written to $GITHUB_STEP_SUMMARY.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, runAll } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Compares results with budgets. Returns one entry per budget row, and `ok`. */
export function compare(results, budgets) {
    const rows = Object.entries(budgets.rows).map(([id, budget]) => {
        const got = results.rows[id];
        const limit = budget.budget * (budget.allowance ?? budgets.allowance);
        if (!got) return { id, what: budget.what, unit: budget.unit, budget: budget.budget, limit, value: undefined, status: 'missing' };
        return {
            id,
            what: budget.what,
            unit: budget.unit,
            budget: budget.budget,
            limit,
            value: got.value,
            status: got.value > limit ? 'fail' : got.value > budget.budget ? 'warn' : 'ok'
        };
    });
    return { rows, ok: rows.every(row => row.status !== 'fail' && row.status !== 'missing') };
}

/** The comparison as a Markdown table (for the job summary). */
export function toMarkdown({ rows, ok }) {
    const lines = ['| Row | Measured | Budget | Fails above | Status |', '|---|---|---|---|---|'];
    for (const row of rows) {
        const got = row.value === undefined ? 'not measured' : format(row.value, row.unit);
        lines.push(`| ${row.what} | ${got} | ${format(row.budget, row.unit)} | ${format(row.limit, row.unit)} | ${row.status} |`);
    }
    lines.push('', ok ? 'All rows are within their limits.' : 'Some rows are above their limits.');
    return lines.join('\n');
}

function option(name) {
    const at = process.argv.indexOf(name);
    return at < 0 ? undefined : process.argv[at + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const budgets = JSON.parse(readFileSync(option('--budgets') ?? join(here, 'budgets.json'), 'utf8'));
    const resultsFile = option('--results');
    const results = resultsFile ? JSON.parse(readFileSync(resultsFile, 'utf8')) : runAll();
    if (!resultsFile) writeFileSync(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    const outcome = compare(results, budgets);
    const table = toMarkdown(outcome);
    console.log(table);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Performance budgets\n\n${table}\n`);
    if (!outcome.ok) process.exit(1);
}
