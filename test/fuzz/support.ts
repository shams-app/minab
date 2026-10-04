/**
 * Settings shared by the fuzz tests (phase Q3, `fast-check`, decision D09).
 *
 * - The seed is fixed, so a failure on CI can be repeated. `MINAB_FUZZ_SEED` changes it.
 * - CI runs 2,000 cases for each property. A local run uses 200. `MINAB_FUZZ_RUNS` sets any number.
 * - When a property fails, `fast-check` prints the seed, the path and the smallest input it found.
 */

import type fc from 'fast-check';

export const FUZZ_SEED = Number(process.env.MINAB_FUZZ_SEED ?? 20_261_004);
export const FUZZ_RUNS = Number(process.env.MINAB_FUZZ_RUNS ?? (process.env.CI ? 2_000 : 200));

export function fuzzParams(extra: fc.Parameters<unknown> = {}): fc.Parameters<unknown> {
    return { seed: FUZZ_SEED, numRuns: FUZZ_RUNS, endOnFailure: false, ...extra };
}
