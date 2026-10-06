/**
 * Language versions and migrations (Q5, decision D38).
 *
 * A host stores `languageVersion` next to each program. `LANGUAGE_VERSION` goes up only when
 * the meaning of valid programs changes or a form is removed. A migration rewrites the source of
 * a program from one version to the next, so an old stored program keeps working.
 * The list is empty today: version 1 is the language of 0.2.0.
 */

/** The language version of this runtime. An integer, 1 for the language of 0.2.0. */
export const LANGUAGE_VERSION = 1;

/** One step of a migration: rewrites the source of a program from one language version to the next. */
export interface Migration {
    from: number;
    /** Always `from + 1`: a migration moves one step. */
    to: number;
    /** One sentence for the host developer: what changes in a program. */
    describe: string;
    /** Gives the source of the program for version `to`. */
    transform(source: string): string;
}

/** The real migrations, in order. Empty today. */
export const MIGRATIONS: readonly Migration[] = [];

/** The result of `migrate`: the new source and the steps used, or the versions that have no path. */
export type MigrateResult = { ok: true; source: string; applied: readonly Migration[] } | { ok: false; from: number; to: number };

/** Runs the migrations from `fromVersion` up to `toVersion`. Fails when a step is missing. */
export function migrate(source: string, fromVersion: number, toVersion: number, migrations: readonly Migration[] = MIGRATIONS): MigrateResult {
    const applied: Migration[] = [];
    let current = source;
    for (let version = fromVersion; version < toVersion; version++) {
        const step = migrations.find(m => m.from === version && m.to === version + 1);
        if (!step) return { ok: false, from: fromVersion, to: toVersion };
        current = step.transform(current);
        applied.push(step);
    }
    return { ok: true, source: current, applied };
}
