/**
 * The playground imports the language from `../src/language`, whose
 * `generated/` folder is Langium output and gitignored. Regenerate it when
 * it's missing or older than the grammar, so `npm run dev` works on a fresh
 * clone without remembering to build the root package first.
 */
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const grammar = resolve(root, 'src/language/minab.langium');
const generated = resolve(root, 'src/language/generated/ast.ts');

const stale = !existsSync(generated) || statSync(generated).mtimeMs < statSync(grammar).mtimeMs;
if (!stale) process.exit(0);

if (!existsSync(resolve(root, 'node_modules/langium-cli'))) {
    console.error('minab-playground: the root package has no node_modules — run `npm install` in the repository root first.');
    process.exit(1);
}
console.log('minab-playground: generating the Minab parser (langium generate)…');
execSync('npm run langium:generate', { cwd: root, stdio: 'inherit' });
