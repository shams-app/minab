export function nextVersion(version: string, published: boolean, run: string | number): string;
export function isPublished(name: string, version: string): boolean;
export function main(args: string[], lookup?: (name: string, version: string) => boolean): string;
