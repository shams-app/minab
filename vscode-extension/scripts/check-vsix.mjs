// Checks what goes into the built .vsix. Run it after `npm run package`.
// A .vsix is a zip file. We list its entries with `unzip -Z1`.
// vsce lowercases the readme name and adds .txt to the licence name.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vsixName = process.argv[2] ?? readdirSync(root).find(name => name.endsWith('.vsix'));
if (!vsixName) {
    console.error('check-vsix: no .vsix file found. Run "npm run package" first.');
    process.exit(1);
}

const entries = execFileSync('unzip', ['-Z1', join(root, vsixName)], { encoding: 'utf8' })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

const required = [
    'extension/package.json',
    'extension/server/main.mjs',
    'extension/syntaxes/minab.tmLanguage.json',
    'extension/language-configuration.json',
    'extension/readme.md',
    'extension/LICENSE.txt'
];
const forbidden = [
    { test: entry => entry.startsWith('extension/src/'), why: 'source files' },
    { test: entry => entry.endsWith('.map'), why: 'source maps' },
    { test: entry => entry.includes('node_modules/'), why: 'node_modules (the bundle has what it needs)' }
];

const problems = [];
for (const file of required) {
    if (!entries.includes(file)) problems.push(`missing: ${file}`);
}
for (const rule of forbidden) {
    for (const entry of entries.filter(rule.test)) problems.push(`not allowed (${rule.why}): ${entry}`);
}

if (problems.length > 0) {
    console.error(`check-vsix: ${vsixName} has problems:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}
console.log(`check-vsix: ${vsixName} is ok (${entries.length} entries).`);
