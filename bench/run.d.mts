export interface BenchRow {
    [extra: string]: unknown;
    value: number;
    unit: string;
}
export interface BenchResults {
    node: string;
    platform: string;
    rows: Record<string, BenchRow>;
}
export function runRow(file: string): { id: string; value: number; unit: string };
export function runAll(only?: string[]): BenchResults;
export function format(value: number, unit: string): string;
