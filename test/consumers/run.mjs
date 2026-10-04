// Consumer smoke tests (phase H1): can each kind of project load the package?
//
// It packs the package once (`npm pack`, which builds the CommonJS bundle too), then for each
// consumer: copies the folder to a temporary directory, installs the tarball there and runs it.
//
//   npm run test:consumers                 all of them
//   npm run test:consumers -- esm cjs      only these
//   MINAB_TARBALL=/path/minab.tgz ...      skip the pack, use this tarball

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const CONSUMERS = {
    esm: { type: 'module', deps: [], command: ['node', 'check.mjs'] },
    cjs: { type: 'commonjs', deps: [], command: ['node', 'check.cjs'] },
    'nest-cjs': {
        type: 'commonjs',
        deps: ['@nestjs/common@^11', '@nestjs/core@^11', 'rxjs@^7', 'reflect-metadata@^0.2'],
        command: ['node', 'check.cjs']
    },
    jest: { type: 'commonjs', deps: ['jest@^29'], command: ['npx', 'jest'] },
    bun: { type: 'module', deps: [], command: ['bun', 'run', 'check.mjs'] },
    'ts-node-resolution': { type: 'commonjs', deps: ['typescript@~5.9', '@types/node@^22'], command: ['npx', 'tsc', '-p', 'tsconfig.old.json'] }
};

function run(command, args, cwd, label) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
    if (result.status !== 0) {
        throw new Error(
            `${label} failed (${command} ${args.join(' ')}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}${result.error ? '\n' + result.error.message : ''}`
        );
    }
    return result.stdout;
}

function pack(into) {
    const out = run('npm', ['pack', '--pack-destination', into, '--json'], root, 'npm pack');
    const name = JSON.parse(out.slice(out.lastIndexOf('\n[\n') + 1))[0].filename;
    return join(into, name);
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(CONSUMERS);
for (const name of names) if (!CONSUMERS[name]) throw new Error(`unknown consumer "${name}". Known: ${Object.keys(CONSUMERS).join(', ')}`);

const work = mkdtempSync(join(tmpdir(), 'minab-consumers-'));
const failures = [];
try {
    const tarball = process.env.MINAB_TARBALL ? resolve(process.env.MINAB_TARBALL) : pack(work);
    if (!existsSync(tarball)) throw new Error(`no tarball at ${tarball}`);
    for (const name of names) {
        const spec = CONSUMERS[name];
        const dir = join(work, name);
        mkdirSync(dir, { recursive: true });
        cpSync(join(here, name), dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `consumer-${name}`, private: true, type: spec.type }, null, 2));
        try {
            run('npm', ['install', '--no-audit', '--no-fund', tarball, ...spec.deps], dir, 'npm install');
            const out = run(spec.command[0], spec.command.slice(1), dir, name);
            console.log(`ok   ${name}${out.trim() ? ': ' + out.trim().split('\n').pop() : ''}`);
        } catch (e) {
            failures.push(name);
            console.error(`FAIL ${name}\n${e.message}`);
        }
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}
if (failures.length) {
    console.error(`consumers failed: ${failures.join(', ')}`);
    process.exit(1);
}
console.log(`all ${names.length} consumers passed`);
