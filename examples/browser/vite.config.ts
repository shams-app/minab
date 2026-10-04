import { defineConfig } from 'vite';

/** The NestJS example (H3) listens here. The page calls it on its own origin, so there is no CORS. */
const SERVER = process.env.MINAB_SERVER ?? 'http://localhost:3000';
const proxy = { '/minab': SERVER };

export default defineConfig({
    // Minab is installed from the tarball and has its own copy of Langium; keep one copy in the bundle.
    resolve: { dedupe: ['langium', 'vscode-languageserver', 'vscode-languageserver-types', 'vscode-languageserver-protocol', 'vscode-jsonrpc', 'vscode-uri'] },
    server: { proxy },
    preview: { proxy },
    worker: { format: 'es' },
    build: { target: 'es2022', chunkSizeWarningLimit: 8192 }
});
