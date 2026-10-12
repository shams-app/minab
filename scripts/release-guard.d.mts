export interface ReleaseRun {
    refType: string;
    refName: string;
    version: string;
    dryRun: boolean;
}
export function releaseGuard(run: ReleaseRun): string;
export function main(args: string[], env?: Record<string, string | undefined>): string;
