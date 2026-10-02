export const TYPES: string[];
export const SCOPES: string[];
export const EXTENSION_SCOPES: string[];
export interface Fragment {
    name: string;
    type: string;
    scope: string;
    breaking: boolean;
    text: string;
}
export function parseFragment(source: string, name: string): Fragment;
export function readFragments(root: string): { fragments: Fragment[]; errors: string[] };
export function renderSection(fragments: Fragment[], version: string, date: string): string;
export function renderExtensionSection(fragments: Fragment[], version: string): string;
export function insertSection(changelog: string, section: string, version: string): string;
export function extractNotes(changelog: string, version: string): string;
export function main(args: string[]): number;
