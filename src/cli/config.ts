/**
 * The CLI's configuration file (roadmap Phase 6).
 *
 * On a command line there is no host application, so `minab.config.json`
 * stands in for one. What the file *means* — the column shorthand, the
 * rule context, the canned responses — lives in `src/host/config.ts`, which
 * the web playground shares; this module is only the part that touches the
 * file system: reading the file, resolving the paths it names relative to
 * itself, and finding it by walking up from a program.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Row } from '../runtime/index.js';
import { ConfigError, parseConfig, parseJsonObject, type HostConfig } from '../host/config.js';

export { ConfigError, emptyConfig, matchResponse, type FixtureResponse } from '../host/config.js';

/** A loaded, validated config — the CLI's whole view of the host. */
export interface LoadedConfig extends HostConfig {
    /** Where it came from, for error messages. `undefined` when no config file was used. */
    path?: string;
}

export const DEFAULT_CONFIG_NAME = 'minab.config.json';

function readJson(path: string, at: string): Record<string, unknown> {
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        throw new ConfigError(`${at}: cannot read ${path}`);
    }
    return parseJsonObject(text, path);
}

export function loadConfigFile(path: string): LoadedConfig {
    const raw = readJson(path, path);
    const baseDir = dirname(path);
    // `"record": "booking.json"` reads that file relative to the config.
    const config = parseConfig(raw, {
        readJson: (file, at) => readJson(resolve(baseDir, file), at)
    });
    return { path, ...config };
}

/** Reads a `--record`/`--data` file given on the command line, which overrides whatever the config said. */
export function loadRecordFile(path: string): Row {
    return readJson(path, path) as Row;
}

/**
 * Walks up from a `.minab` file's own directory, not from the working
 * directory: a config belongs with the programs it describes. Shared by the
 * CLI (from the file given on the command line) and the language server
 * (from a workspace root), so both resolve the same config for the same
 * file.
 */
export function discoverConfig(startDir: string): string | undefined {
    let dir = startDir;
    for (;;) {
        const candidate = join(dir, DEFAULT_CONFIG_NAME);
        if (existsSync(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}
