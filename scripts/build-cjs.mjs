// Builds the CommonJS entries of the package (D32, phase H1).
//
// The package is an ES module. NestJS projects compile to CommonJS and Jest cannot load ES-only
// packages, so `require('@shamsine/minab')` needs a CommonJS file. This script bundles three
// entries into `out/cjs/*.cjs`, with Langium and the other dependencies inside.
// Left outside: `pg`, `@nestjs/*`, `rxjs`, `reflect-metadata`. The host brings those.
//
// Each bundle is self-contained, so a class (for example `PortError`) from `.` is not the same
// class as the one in `./node`. Match errors by their `code`, not with `instanceof`.
//
// Run it after `tsc` and `langium generate`: `npm run build:cjs`, or `build:release`.

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const ENTRIES = {
    index: 'src/runtime/index.ts',
    node: 'src/node/index.ts',
    nestjs: 'src/nestjs/index.ts'
};

export const EXTERNAL = ['pg', '@nestjs/*', 'rxjs', 'rxjs/*', 'reflect-metadata'];

export async function buildCjs(outdir = join(root, 'out/cjs')) {
    mkdirSync(outdir, { recursive: true });
    await build({
        absWorkingDir: root,
        entryPoints: ENTRIES,
        outdir,
        outExtension: { '.js': '.cjs' },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        external: EXTERNAL,
        sourcemap: false,
        // The NestJS entry uses parameter decorators. Every injection is explicit (`@Inject`), so esbuild needs no type metadata.
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
        legalComments: 'none',
        logLevel: 'warning'
    });
    return Object.keys(ENTRIES).map(name => join(outdir, `${name}.cjs`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const files = await buildCjs();
    console.log(`built ${files.length} CommonJS bundles in out/cjs`);
}
