#!/usr/bin/env node
/**
 * Prints the version of a `next` prerelease build.
 *
 * Usage (from the repository root, Node 18+, npm on the path):
 *   node scripts/next-version.mjs --run <run number>
 *
 * The run number is `$GITHUB_RUN_NUMBER` when `--run` is missing.
 * If the version in `package.json` is already on npm, the build is for the
 * next minor version: `0.2.0` gives `0.3.0-next.42`. If not, the build is
 * for that version: `0.2.0-next.42`. The result is never committed.
 * `--root <dir>` runs it on another folder (the tests use it).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The prerelease version. Pure: the npm lookup has already happened. */
export function nextVersion(version, published, run) {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-.*)?$/);
    if (!match) throw new Error(`"${version}" is not a version like 0.2.0`);
    if (!/^\d+$/.test(String(run))) throw new Error('the run number must be a whole number');
    const [, major, minor, patch] = match;
    const base = published ? `${major}.${Number(minor) + 1}.0` : `${major}.${minor}.${patch}`;
    return `${base}-next.${run}`;
}

/** Asks npm if `name@version` exists. A 404 means "no"; any other error is thrown. */
export function isPublished(name, version) {
    try {
        execFileSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return true;
    } catch (error) {
        const output = `${error.stderr ?? ''}${error.stdout ?? ''}`;
        if (/E404|404 Not Found/.test(output)) return false;
        throw new Error(`cannot ask npm about ${name}@${version}: ${output.trim() || error.message}`);
    }
}

/** Runs the command line. `lookup` can be replaced (the tests do). Returns the version. */
export function main(args, lookup = isPublished) {
    const get = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    const root = resolve(get('--root') ?? DEFAULT_ROOT);
    const run = get('--run') ?? process.env.GITHUB_RUN_NUMBER;
    if (!run) throw new Error('give the run number with --run, or set GITHUB_RUN_NUMBER');
    const { name, version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    return nextVersion(version, lookup(name, version), run);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    try {
        console.log(main(process.argv.slice(2)));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
