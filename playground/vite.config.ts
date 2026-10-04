import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The playground compiles the language straight from `../src` — there is no
 * published Minab package to depend on, and importing the source keeps the
 * two from drifting. `dedupe` makes those files and ours share one copy of
 * Langium (and the LSP types it re-exports) rather than each resolving its
 * own from the nearest `node_modules`.
 */

/** GitHub Pages serves 404.html for unknown paths, so a copy of the app makes client-side routes deep-linkable there. */
function spaFallback(): Plugin {
    return {
        name: 'minab-spa-fallback',
        apply: 'build',
        closeBundle() {
            const out = resolve(import.meta.dirname, 'dist');
            copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
        }
    };
}

/** The Minab version the site runs (D42): the root package's version, read at build time. */
const minabVersion = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }).version;

export default defineConfig({
    define: {
        __MINAB_VERSION__: JSON.stringify(minabVersion)
    },
    base: process.env.PLAYGROUND_BASE ?? '/',
    plugins: [react(), spaFallback()],
    resolve: {
        alias: {
            'monaco-esm': resolve(import.meta.dirname, 'node_modules/monaco-editor/esm/vs')
        },
        dedupe: ['langium', 'vscode-languageserver', 'vscode-languageserver-types', 'vscode-languageserver-protocol', 'vscode-jsonrpc', 'vscode-uri']
    },
    server: {
        fs: { allow: ['..'] }
    },
    optimizeDeps: {
        // PGlite loads its WASM and data bundle relative to its own module URL.
        exclude: ['@electric-sql/pglite']
    },
    worker: {
        format: 'es'
    },
    build: {
        target: 'es2022',
        chunkSizeWarningLimit: 4096
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 30_000,
        hookTimeout: 60_000
    }
});
