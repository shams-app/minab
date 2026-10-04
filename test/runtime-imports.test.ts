/**
 * Production plan phase R2 — the runtime must not depend on the environment.
 * The entry `@shamsine/minab` runs in Node, in a browser and in a Worker. This
 * test walks the import graph from `src/runtime/index.ts` through every
 * relative import in `src/` and fails on a Node module, a Node entry of a
 * library, a database driver, or a use of `window` or `document`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const entry = resolve(root, 'src/runtime/index.ts');

const FORBIDDEN_MODULE = /^(node:|langium\/node$|vscode-languageserver\/node$|pg$|pg\/)/;
const FORBIDDEN_BUILTIN = /^(fs|path|os|url|child_process|crypto|http|https|net|stream|util|worker_threads|module|process)(\/.*)?$/;

/**
 * Does the file use the browser globals `window` or `document`? A name the file
 * declares itself (a variable, a parameter) is not the global, so it is skipped.
 */
export function usesBrowserGlobal(source: string): boolean {
    const tree = ts.createSourceFile('file.ts', source, ts.ScriptTarget.ES2022, true);
    const declared = new Set<string>();
    const used: ts.Identifier[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && (node.text === 'window' || node.text === 'document')) {
            const parent = node.parent;
            const isName =
                (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isFunctionDeclaration(parent)) &&
                parent.name === node;
            const isProperty =
                (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
                (ts.isPropertyAssignment(parent) && parent.name === node) ||
                ts.isPropertySignature(parent);
            if (isName) declared.add(node.text);
            else if (!isProperty && !ts.isImportSpecifier(parent) && !ts.isTypeReferenceNode(parent)) used.push(node);
        }
        ts.forEachChild(node, visit);
    };
    visit(tree);
    return used.some(id => !declared.has(id.text));
}

/** The module specifiers of a source file: `import ... from 'x'`, `export ... from 'x'`, `import('x')`. */
export function specifiers(source: string): string[] {
    const found: string[] = [];
    for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) found.push(match[1]);
    return found;
}

export function walk(start: string, read: (file: string) => string | undefined): { files: string[]; problems: string[] } {
    const files: string[] = [];
    const problems: string[] = [];
    const queue = [start];
    const seen = new Set<string>();
    while (queue.length > 0) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        const source = read(file);
        if (source === undefined) {
            problems.push(`${relative(root, file)}: file not found`);
            continue;
        }
        files.push(relative(root, file));
        if (usesBrowserGlobal(source)) problems.push(`${relative(root, file)}: uses window or document`);
        for (const specifier of specifiers(source)) {
            if (FORBIDDEN_MODULE.test(specifier) || FORBIDDEN_BUILTIN.test(specifier)) {
                problems.push(`${relative(root, file)}: imports "${specifier}"`);
            } else if (specifier.startsWith('.')) {
                // The sources import `./x.js`; the file is `./x.ts`.
                queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
            }
        }
    }
    return { files, problems };
}

const readFromDisk = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

describe('src/runtime does not depend on the environment', () => {
    test('the import graph has no Node module, no database driver, no window or document', () => {
        const { files, problems } = walk(entry, readFromDisk);
        expect(files.length).toBeGreaterThan(10); // the walk really reaches the language
        expect(problems).toEqual([]);
    });

    test('the guard fails when a runtime file imports node:fs', () => {
        const poisoned = (file: string) => {
            const source = readFromDisk(file);
            return file === resolve(root, 'src/runtime/minab.ts') ? `import 'node:fs';\n${source}` : source;
        };
        expect(walk(entry, poisoned).problems).toEqual([`src/runtime/minab.ts: imports "node:fs"`]);
    });

    test('the guard fails on langium/node, pg, and a use of window', () => {
        const poisoned = (file: string) => {
            const source = readFromDisk(file);
            if (file !== resolve(root, 'src/runtime/prepare.ts')) return source;
            return `import { NodeFileSystem } from 'langium/node';\nimport pg from 'pg';\nconst w = window.location;\n${source}`;
        };
        expect(walk(entry, poisoned).problems.sort()).toEqual([
            'src/runtime/prepare.ts: imports "langium/node"',
            'src/runtime/prepare.ts: imports "pg"',
            'src/runtime/prepare.ts: uses window or document'
        ]);
    });
});

describe('the browser entries do not depend on Node either (H4)', () => {
    for (const file of ['src/browser/index.ts', 'src/browser/worker.ts']) {
        test(`${file} has no Node module, no database driver, no window or document`, () => {
            const { files, problems } = walk(resolve(root, file), readFromDisk);
            expect(files).toContain(file);
            expect(problems).toEqual([]);
        });
    }

    test('the guard fails when the worker entry imports node:worker_threads', () => {
        const poisoned = (file: string) => {
            const source = readFromDisk(file);
            return file === resolve(root, 'src/browser/worker.ts') ? `import 'node:worker_threads';\n${source}` : source;
        };
        expect(walk(resolve(root, 'src/browser/worker.ts'), poisoned).problems).toEqual([`src/browser/worker.ts: imports "node:worker_threads"`]);
    });
});
