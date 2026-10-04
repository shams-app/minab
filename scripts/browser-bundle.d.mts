export const NODE_ONLY: string[];
export const APP_ENTRY: string;
export const ENTRIES: Record<string, string>;
export function findOffenders(metafile: { inputs: Record<string, { imports: { path: string; external?: boolean }[] }> }): string[];
export function measure(options?: {
    entries?: Record<string, string>;
    appEntry?: string;
}): Promise<{ sizes: Record<string, { bytes: number; gzip: number }>; offenders: string[] }>;
