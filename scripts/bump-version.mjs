#!/usr/bin/env node
/**
 * Sets the version in `package.json` and `vscode-extension/package.json` and
 * in their lockfiles. The two packages always share one version.
 *
 * Usage (from the repository root, Node 18+, npm on the path):
 *   node scripts/bump-version.mjs X.Y.Z
 *
 * It runs `npm version X.Y.Z --no-git-tag-version` in both folders: no commit,
 * no tag. `--root <dir>` runs it on another folder (the tests use it).
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Folders that hold a package, relative to the root. */
export const PACKAGE_DIRS = ['.', 'vscode-extension'];

/** Bumps both packages. `run` runs one command in one folder (the tests can replace it). */
export function bumpVersion(root, version, run = defaultRun) {
    if (!VERSION.test(version)) throw new Error(`"${version}" is not a version like 0.2.1`);
    for (const dir of PACKAGE_DIRS) {
        run(resolve(root, dir), ['version', version, '--no-git-tag-version', '--allow-same-version']);
    }
}

function defaultRun(cwd, args) {
    // `shell` is needed for npm.cmd on Windows. The arguments are checked above.
    execFileSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const args = process.argv.slice(2);
    const rootIndex = args.indexOf('--root');
    const root = rootIndex === -1 ? DEFAULT_ROOT : resolve(args[rootIndex + 1]);
    const version = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--root');
    try {
        if (!version) throw new Error('usage: bump-version.mjs X.Y.Z');
        bumpVersion(root, version);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
