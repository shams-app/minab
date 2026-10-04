// Installs Minab from the packed tarball, the way a user gets it (phase H3).
//   npm run setup          packs the repository root, then installs the tarball here
// Run it after `npm ci`: it adds the package without changing package.json or the lockfile.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(here, '../..');
const out = join(here, '.minab');

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
    return result.stdout;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const packed = run('npm', ['pack', '--pack-destination', out, '--json'], root);
const tarball = join(out, JSON.parse(packed.slice(packed.lastIndexOf('\n[\n') + 1))[0].filename);
run('npm', ['install', '--no-save', '--no-audit', '--no-fund', tarball], here);
console.log(`installed ${tarball}`);
