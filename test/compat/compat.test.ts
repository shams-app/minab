import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_VERSION, MIGRATIONS, createMinab, migrate, type Migration } from '../../src/runtime/index.js';
import { compareCorpus, corpusVersions, writeCorpus } from './corpus.js';

/**
 * Q5 (D38). The golden corpus: programs from every release must give the same codes and results.
 * Before 1.0 a phase may change an expectation on purpose (and marks its changelog fragment
 * `breaking: true`). From 1.0 on, a 1.x folder never changes.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS = join(ROOT, 'test/compat/corpus');

describe('golden corpus', () => {
    test('there is a corpus folder for 0.2.0', () => {
        expect(corpusVersions(CORPUS)).toContain('0.2.0');
    });

    for (const version of corpusVersions(CORPUS)) {
        test(`${version}: every program gives the same codes and results`, async () => {
            expect(await compareCorpus(join(CORPUS, version))).toEqual([]);
        });
    }

    test('a program changed on purpose fails the test and names the program', async () => {
        const copy = join(mkdtempSync(join(tmpdir(), 'minab-compat-')), '0.2.0');
        cpSync(join(CORPUS, '0.2.0'), copy, { recursive: true });
        // `+ 1` becomes a wrong type: the codes change.
        writeFileSync(join(copy, 'example-discounted-total.minab'), '1 + "a"\n');
        const problems = await compareCorpus(copy);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('example-discounted-total.minab');
    });

    test('the snapshot writes a new folder and never overwrites one', async () => {
        const target = mkdtempSync(join(tmpdir(), 'minab-snapshot-'));
        const count = await writeCorpus(ROOT, target, '9.9.9');
        expect(count).toBeGreaterThan(50);
        expect(existsSync(join(target, '9.9.9/expected.json'))).toBe(true);
        expect(await compareCorpus(join(target, '9.9.9'))).toEqual([]);
        await expect(writeCorpus(ROOT, target, '9.9.9')).rejects.toThrow('never changed');
    });

    test('the corpus has programs from the spec, the showcase and the examples', () => {
        const expected = JSON.parse(readFileSync(join(CORPUS, '0.2.0/expected.json'), 'utf8')) as Record<string, unknown>;
        const names = Object.keys(expected);
        for (const prefix of ['spec-', 'showcase-', 'example-']) expect(names.some(n => n.startsWith(prefix))).toBe(true);
    });
});

describe('language version', () => {
    test('the language of 0.2.0 is version 1, and no migration exists yet', () => {
        expect(LANGUAGE_VERSION).toBe(1);
        expect(MIGRATIONS).toEqual([]);
    });

    test('a program for a newer language is refused with compat.newerLanguage', async () => {
        const minab = createMinab({ schema: { tables: [] } });
        const program = await minab.prepare('1 + 1', { languageVersion: 99 });
        expect(program.ok).toBe(false);
        expect(program.diagnostics.map(d => d.code)).toEqual(['compat.newerLanguage']);
        expect(program.diagnostics[0].params).toEqual({ requested: 99, supported: LANGUAGE_VERSION });
        expect((await program.run()).ok).toBe(false);
        minab.dispose();
    });

    test('a missing version and the current version mean the same', async () => {
        const minab = createMinab({ schema: { tables: [] } });
        const missing = await minab.prepare('1 + 1');
        const current = await minab.prepare('1 + 1', { languageVersion: LANGUAGE_VERSION });
        expect(missing.ok && current.ok).toBe(true);
        minab.dispose();
    });

    test('a version that is not a whole number of 1 or more is a bad call', async () => {
        const minab = createMinab({ schema: { tables: [] } });
        for (const bad of [0, -1, 1.5, Number.NaN]) await expect(minab.prepare('1', { languageVersion: bad })).rejects.toThrow(TypeError);
        minab.dispose();
    });
});

describe('migrations', () => {
    // A fake migration: version 0 wrote `plus(a, b)`, version 1 writes `a + b`.
    const fake: Migration = { from: 0, to: 1, describe: 'plus(a, b) becomes a + b', transform: source => source.replace(/plus\((\d+), (\d+)\)/g, '$1 + $2') };

    test('the fake migration rewrites a program from version 0 to 1, and the result checks clean', async () => {
        const result = migrate('plus(1, 2)', 0, 1, [fake]);
        expect(result).toEqual({ ok: true, source: '1 + 2', applied: [fake] });
        const minab = createMinab({ schema: { tables: [] } });
        const program = await minab.prepare(result.ok ? result.source : '');
        expect(program.ok).toBe(true);
        minab.dispose();
    });

    test('steps run in order, and the same version needs none', () => {
        const next: Migration = { from: 1, to: 2, describe: 'doubles', transform: source => `${source} * 2` };
        expect(migrate('1', 0, 2, [fake, next])).toMatchObject({ ok: true, source: '1 * 2' });
        expect(migrate('x', 1, 1, [fake])).toEqual({ ok: true, source: 'x', applied: [] });
    });

    test('a missing step fails', () => {
        expect(migrate('1', 0, 2, [fake])).toEqual({ ok: false, from: 0, to: 2 });
    });

    test('compat.noMigration is reported when no path exists', async () => {
        // The real list is empty and the version is 1, so only a hand-made call reaches this code.
        const { coded } = await import('../../src/language/diagnostics/codes.js');
        expect(coded('compat.noMigration', { from: 0, to: 1 }).reason).toContain('no migration path');
    });
});
