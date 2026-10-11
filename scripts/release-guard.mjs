#!/usr/bin/env node
/**
 * Decides if a run of `.github/workflows/release.yml` may go on (Q6).
 *
 * Usage (from the repository root, Node 18+):
 *   node scripts/release-guard.mjs --ref-type <tag|branch> --ref-name <name> --dry-run <true|false>
 *
 * Missing flags come from `$GITHUB_REF_TYPE`, `$GITHUB_REF_NAME` and `$DRY_RUN`.
 * The version comes from `package.json` (`--root <dir>` reads another folder;
 * the tests use it). The rules:
 *   - a dry run is allowed on any ref;
 *   - a real run is allowed only on the tag `v<version>`. This covers a tag push
 *     and a hand-started run on that tag (to run a failed release again).
 * It prints what the run will do. If the run is refused, it prints the reason
 * as a GitHub error and exits 1, before anything is built or published.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Returns what the run will do, or throws with the reason it is refused. Pure. */
export function releaseGuard({ refType, refName, version, dryRun }) {
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
        throw new Error(`"${version}" in package.json is not a version like 0.4.0`);
    }
    const tag = `v${version}`;
    if (dryRun) {
        return `Dry run on the ${refType} ${refName}: build and test version ${version}, publish nothing.`;
    }
    if (refType !== 'tag') {
        throw new Error(
            `A real release runs only from a version tag. This run is on the ${refType} ${refName} with dry-run off. ` +
                `Push the tag ${tag}, or start Release on the tag ${tag} with dry-run off. ` +
                'On a branch, start it with dry-run on.'
        );
    }
    if (refName !== tag) {
        throw new Error(`The tag ${refName} does not match the package.json version ${version} (expected ${tag}).`);
    }
    return `Real release of version ${version} from the tag ${tag}.`;
}

/** Reads `true` or `false`. Anything else is an error, so a typo never means "publish". */
function parseFlag(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`--dry-run must be "true" or "false", not "${value ?? ''}"`);
}

/** Runs the command line. Returns the message to print, or throws. */
export function main(args, env = process.env) {
    const get = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    const root = resolve(get('--root') ?? DEFAULT_ROOT);
    const refType = get('--ref-type') ?? env.GITHUB_REF_TYPE;
    const refName = get('--ref-name') ?? env.GITHUB_REF_NAME;
    if (!refType || !refName) throw new Error('give --ref-type and --ref-name, or set GITHUB_REF_TYPE and GITHUB_REF_NAME');
    const dryRun = parseFlag(get('--dry-run') ?? env.DRY_RUN);
    const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    return releaseGuard({ refType, refName, version, dryRun });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    try {
        console.log(main(process.argv.slice(2)));
    } catch (error) {
        console.error(`::error::${error.message}`);
        process.exitCode = 1;
    }
}
