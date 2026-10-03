import { MinabGrammar } from '../../src/language/generated/grammar.js';
import type { Grammar } from 'langium';

/**
 * Every alphabetic keyword the grammar defines (taken from the generated
 * grammar, so a new keyword is covered without an edit here).
 */
function collect(node: unknown, found: Set<string>, seen = new Set<unknown>()): void {
    if (Array.isArray(node)) {
        for (const item of node) collect(item, found, seen);
        return;
    }
    if (typeof node !== 'object' || node === null || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.$type === 'Keyword' && typeof record.value === 'string' && /^[A-Za-z_]+$/.test(record.value)) found.add(record.value);
    for (const [key, value] of Object.entries(record)) if (!key.startsWith('$') || key === '$type') collect(value, found, seen);
}

const found = new Set<string>();
collect(MinabGrammar() as Grammar, found);
/** `_` is a keyword (the default case of `switch`) but also the start of names, so it is not tested as a name. */
export const ALL_KEYWORDS: string[] = [...found].filter(k => k !== '_').sort();
