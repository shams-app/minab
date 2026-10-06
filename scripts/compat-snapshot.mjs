#!/usr/bin/env node
/**
 * `npm run compat:snapshot <version>`: writes `test/compat/corpus/<version>/` from the current code (Q5).
 * Release phases V2, V3 and V5 run it. It never overwrites a folder. Build first: `npm run build`.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(argv) {
    const version = argv[0];
    if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
        console.error('Usage: npm run compat:snapshot <version>   (for example 0.3.0)');
        return 2;
    }
    const built = resolve(ROOT, 'out/test/compat/corpus.js');
    if (!existsSync(built)) {
        console.error('Build first: npm run build');
        return 2;
    }
    const { writeCorpus } = await import(pathToFileURL(built).href);
    try {
        const count = await writeCorpus(ROOT, resolve(ROOT, 'test/compat/corpus'), version);
        console.log(`Wrote test/compat/corpus/${version}/ with ${count} programs.`);
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

process.exitCode = await main(process.argv.slice(2));
