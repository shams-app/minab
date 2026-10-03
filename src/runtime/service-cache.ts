/**
 * Language services, cached (D29).
 *
 * A service set holds the schema and rule context it was built for, and its
 * first `prepare` is the slow one (the parser builds lazily). So one set is
 * kept for each schema version and rule context, with a least-recently-used
 * cap. A run that still uses an evicted set keeps it alive by reference.
 */

import { EmptyFileSystem } from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import { createMinabServices, type MinabServices } from '../language/minab-module.js';
import type { MinabRuleContext, MinabSchema } from '../language/schema.js';

export interface ServiceSet {
    services: MinabServices;
    shared: LangiumSharedServices;
}

export const DEFAULT_SERVICE_CACHE_SIZE = 16;

/** A 53-bit string hash (cyrb53). It needs no Node API. */
function hash(text: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function schemaKey(schema: MinabSchema): string {
    return schema.version !== undefined ? `v:${schema.version}` : `h:${hash(JSON.stringify(schema))}`;
}

function ruleContextKey(context: MinabRuleContext): string {
    const field = context.fieldType;
    const type = field ? `${field.base}${field.nullable ? '?' : ''}${field.array ? '[]' : ''}${field.arrayNullable ? '?' : ''}` : '';
    return JSON.stringify([context.isFieldRule, type, context.recordTable ?? null]);
}

export class ServiceCache {
    private readonly entries = new Map<string, ServiceSet>();
    created = 0;
    hits = 0;

    constructor(
        private readonly capacity: number,
        private readonly mode: 'development' | 'production'
    ) {}

    get size(): number {
        return this.entries.size;
    }

    get(schema: MinabSchema, ruleContext: MinabRuleContext): ServiceSet {
        const key = `${schemaKey(schema)}|${ruleContextKey(ruleContext)}`;
        const found = this.entries.get(key);
        if (found) {
            this.hits++;
            // Re-insert: a Map keeps insertion order, so the first key is the least recently used.
            this.entries.delete(key);
            this.entries.set(key, found);
            return found;
        }
        const { shared, Minab } = createMinabServices(EmptyFileSystem, schema, ruleContext, { mode: this.mode });
        const created: ServiceSet = { services: Minab, shared };
        this.created++;
        this.entries.set(key, created);
        while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
        return created;
    }

    openDocuments(): number {
        let count = 0;
        for (const set of this.entries.values()) count += set.shared.workspace.LangiumDocuments.all.count();
        return count;
    }

    clear(): void {
        this.entries.clear();
    }
}
