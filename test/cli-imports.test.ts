/**
 * Production plan phase R7 — the CLI is a host of the runtime API.
 * `src/cli/` may import only from `src/runtime/`, `src/host/`, `src/node/` and
 * its own files. It must not reach into `src/language/` or wire Langium itself.
 * (`src/language/main.ts`, the language server, is not part of the CLI.)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { specifiers } from './runtime-imports.test.js';

const root = resolve(import.meta.dirname, '..');
const cliDir = resolve(root, 'src/cli');
const ALLOWED = ['src/cli/', 'src/runtime/', 'src/host/', 'src/node/'];

/** The problems of one CLI file's imports. */
export function importProblems(file: string, source: string): string[] {
    const problems: string[] = [];
    for (const specifier of specifiers(source)) {
        if (specifier === 'langium' || specifier.startsWith('langium/')) {
            problems.push(`${file} imports "${specifier}": the CLI must not wire Langium itself`);
        } else if (specifier.startsWith('.')) {
            const target = relative(root, resolve(cliDir, specifier)).replaceAll('\\', '/');
            if (!ALLOWED.some(prefix => target.startsWith(prefix))) problems.push(`${file} imports "${specifier}", outside ${ALLOWED.join(', ')}`);
        }
    }
    return problems;
}

describe('src/cli imports (R7)', () => {
    test('every CLI file imports only the runtime, host and node folders and its own files', () => {
        const files = readdirSync(cliDir).filter(name => name.endsWith('.ts'));
        expect(files).toContain('main.ts');
        const problems = files.flatMap(name => importProblems(name, readFileSync(resolve(cliDir, name), 'utf8')));
        expect(problems).toEqual([]);
    });

    test('the guard fails on the interpreter, on language internals and on Langium', () => {
        const bad = "import { MinabInterpreter } from '../language/minab-interpreter.js';\nimport { URI } from 'langium';\n";
        expect(importProblems('main.ts', bad)).toHaveLength(2);
        expect(importProblems('main.ts', "import { createMinab } from '../runtime/index.js';\nimport { x } from './config.js';")).toEqual([]);
    });
});
