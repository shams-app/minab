// Bundle guard for the browser entries (phase H5).
//
// It builds a tiny app that imports `src/browser` and its worker for the browser platform, and writes
// the sizes (raw and gzip) to `bench/bundle.json`. It fails when a Node-only module is in a bundle:
// `pg`, `node:*` (and the bare names of Node built-ins), `langium/node`, `vscode-languageserver/node`.
// Q4 sets the size budget from these numbers.
//
// Run: `node scripts/browser-bundle.mjs` (after `npm run langium:generate`, because the parser is built in).
// Add `--check` to leave `bench/bundle.json` as it is.
//
// `@electric-sql/pglite` stays outside the bundles: it is an optional peer, and an app brings it.

import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Modules that must never be in a browser bundle. */
export const NODE_ONLY = ['pg', 'langium/node', 'vscode-languageserver/node', ...builtinModules.filter(name => !name.startsWith('_'))];

/** What an app that uses the browser client pulls in. */
export const APP_ENTRY = `
import * as browser from ${JSON.stringify(join(root, 'src/browser/index.ts'))};
import * as pglite from ${JSON.stringify(join(root, 'src/browser/pglite.ts'))};
import * as worker from ${JSON.stringify(join(root, 'src/browser/worker.ts'))};
import * as monaco from ${JSON.stringify(join(root, 'src/monaco/index.ts'))};
export { browser, monaco, pglite, worker };
`;

export const ENTRIES = {
    browser: 'src/browser/index.ts',
    monaco: 'src/monaco/index.ts',
    worker: 'src/browser/worker.ts',
    pglite: 'src/browser/pglite.ts'
};

function isNodeOnly(name) {
    if (name.startsWith('node:')) return true;
    return NODE_ONLY.some(banned => name === banned || name.startsWith(`${banned}/`));
}

/** The Node-only imports in one esbuild metafile, as readable lines. */
export function findOffenders(metafile) {
    const found = new Set();
    for (const [file, input] of Object.entries(metafile.inputs)) {
        for (const imported of input.imports) {
            if (imported.external && isNodeOnly(imported.path)) found.add(`${file} imports "${imported.path}"`);
        }
    }
    return [...found].sort();
}

async function bundle(entryPoints, outdir, extra = {}) {
    return build({
        absWorkingDir: root,
        entryPoints,
        outdir,
        write: false,
        metafile: true,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        minify: true,
        // Node modules stay outside, so a forbidden import shows up in the metafile and not as a resolve error.
        external: ['@electric-sql/pglite', '@electric-sql/pglite/*', ...NODE_ONLY, 'node:*', 'langium/node', 'vscode-languageserver/node'],
        legalComments: 'none',
        logLevel: 'silent',
        ...extra
    });
}

function sizes(result) {
    const out = {};
    for (const file of result.outputFiles) {
        out[relative(join(root, 'dist-bundle'), file.path).replace(/\\/g, '/')] = {
            bytes: file.contents.length,
            gzip: gzipSync(file.contents, { level: 9 }).length
        };
    }
    return out;
}

/**
 * Builds the entries and the tiny app. Returns `{ sizes, offenders }`.
 * `entries` and `appEntry` can be replaced (the tests do, to try a Node import).
 */
export async function measure({ entries = ENTRIES, appEntry = APP_ENTRY } = {}) {
    const outdir = join(root, 'dist-bundle');
    const parts = await bundle(entries, outdir);
    const scratch = mkdtempSync(join(tmpdir(), 'minab-bundle-'));
    try {
        const appFile = join(scratch, 'app.ts');
        writeFileSync(appFile, appEntry);
        const app = await bundle({ app: appFile }, outdir);
        const offenders = [...new Set([...findOffenders(parts.metafile), ...findOffenders(app.metafile)])].sort();
        const all = { ...sizes(parts), ...sizes(app) };
        const byName = Object.fromEntries(
            Object.entries(all)
                .map(([file, size]) => [file.replace(/\.js$/, ''), size])
                .sort(([a], [b]) => a.localeCompare(b))
        );
        return { sizes: byName, offenders };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { sizes: bundleSizes, offenders } = await measure();
    for (const [name, size] of Object.entries(bundleSizes))
        console.log(`${name.padEnd(10)} ${String(size.bytes).padStart(9)} bytes  ${String(size.gzip).padStart(8)} gzip`);
    if (offenders.length > 0) {
        console.error('Node-only modules are in the browser bundle:');
        for (const line of offenders) console.error(`  ${line}`);
        process.exit(1);
    }
    if (!process.argv.includes('--check')) {
        mkdirSync(join(root, 'bench'), { recursive: true });
        writeFileSync(join(root, 'bench/bundle.json'), `${JSON.stringify({ unit: 'bytes', minified: true, entries: bundleSizes }, null, 2)}\n`);
        console.log('wrote bench/bundle.json');
    }
}
