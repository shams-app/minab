// `npm run bench`: runs every row in its own Node process and writes `bench/results.json` (phase Q4).
// Build first (`npm run build`): the rows import the built code from `out/`.
//
// Usage: node bench/run.mjs [row ...]    (no names runs every row)

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Runs one row script in a fresh process and returns the object it reported. */
export function runRow(file) {
    // --expose-gc lets the memory row collect garbage before it reads the memory.
    const child = spawnSync(process.execPath, ['--expose-gc', join(here, 'rows', file)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (child.status !== 0) throw new Error(`bench row ${file} failed:\n${child.stderr || child.stdout}`);
    const last = child.stdout.trim().split('\n').pop();
    return JSON.parse(last);
}

export function runAll(only = []) {
    const files = readdirSync(join(here, 'rows')).filter(f => f.endsWith('.mjs') && (only.length === 0 || only.includes(f.replace(/\.mjs$/, ''))));
    const rows = {};
    for (const file of files.sort()) {
        const { id, ...row } = runRow(file);
        rows[id] = row;
    }
    return { node: process.version, platform: `${process.platform}-${process.arch}`, rows };
}

export function format(value, unit) {
    if (unit === 'bytes') return `${Math.round(value).toLocaleString('en-US')} bytes`;
    return `${value < 1 ? value.toFixed(3) : value.toFixed(1)} ${unit}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const results = runAll(process.argv.slice(2));
    for (const [id, row] of Object.entries(results.rows)) console.log(`${id.padEnd(15)} ${format(row.value, row.unit)}`);
    mkdirSync(here, { recursive: true });
    writeFileSync(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log('wrote bench/results.json');
}
