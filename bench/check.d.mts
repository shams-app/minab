import type { BenchResults } from './run.mjs';

export interface Budgets {
    allowance: number;
    rows: Record<string, { what: string; budget: number; unit: string; allowance?: number }>;
}
export interface RowOutcome {
    id: string;
    what: string;
    unit: string;
    budget: number;
    limit: number;
    value: number | undefined;
    status: 'ok' | 'warn' | 'fail' | 'missing';
}
export function compare(results: BenchResults, budgets: Budgets): { rows: RowOutcome[]; ok: boolean };
export function toMarkdown(outcome: { rows: RowOutcome[]; ok: boolean }): string;
