/**
 * Finds the `minab.config.json` of each document and keeps one set of
 * language services for each schema. A document uses the nearest config above
 * its own folder, like the CLI. A document with no config, or with a config
 * that cannot be read, uses an empty schema.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverConfig, emptyConfig, loadConfigFile, type LoadedConfig } from '../cli/config.js';
import { EMPTY_HOST } from '../language/host-declarations.js';
import { ServiceCache, type ServiceSet } from '../runtime/service-cache.js';

export interface ResolvedDocument {
    services: ServiceSet;
    /** The config file the document uses. `undefined` when there is none. */
    configPath?: string;
    /** Why the config could not be used. The document then has an empty schema. */
    configError?: string;
}

export class ConfigRegistry {
    // Services are built from the file's content, so a changed file gives new services.
    private readonly cache = new ServiceCache(16, 'production');
    private readonly loaded = new Map<string, LoadedConfig | string>();
    private override: string | undefined;

    /** Use this config file for every document (the `minab.configPath` setting). `undefined` goes back to discovery. */
    setOverride(configPath: string | undefined): void {
        this.override = configPath;
    }

    /** Forget a config file. The next `resolve` reads it again. */
    invalidate(configPath: string): void {
        this.loaded.delete(configPath);
    }

    invalidateAll(): void {
        this.loaded.clear();
    }

    resolve(documentUri: string): ResolvedDocument {
        const configPath = this.override ?? configPathOf(documentUri);
        if (configPath === undefined) return { services: this.build(emptyConfig()) };
        let entry = this.loaded.get(configPath);
        if (entry === undefined) {
            try {
                entry = loadConfigFile(configPath);
            } catch (e) {
                entry = e instanceof Error ? e.message : String(e);
            }
            this.loaded.set(configPath, entry);
        }
        if (typeof entry === 'string') return { services: this.build(emptyConfig()), configPath, configError: entry };
        return { services: this.build(entry), configPath };
    }

    private build(config: { schema: LoadedConfig['schema']; ruleContext: LoadedConfig['ruleContext'] }): ServiceSet {
        return this.cache.get(config.schema, config.ruleContext, EMPTY_HOST);
    }
}

/** The config a document uses. Only `file:` documents have one. */
export function configPathOf(documentUri: string): string | undefined {
    if (!documentUri.startsWith('file:')) return undefined;
    try {
        return discoverConfig(dirname(fileURLToPath(documentUri)));
    } catch {
        return undefined;
    }
}
