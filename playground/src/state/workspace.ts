/**
 * A workspace: the program being edited, plus the host it runs against.
 *
 * The host is kept in parts — a dataset reference, the rule context, the
 * record, `$` — rather than as one JSON blob, because each part has its own
 * editor in the Host panel and because a share link only needs to carry
 * what differs from the dataset (a few hundred bytes, not the whole seed).
 * `hostSettings` assembles the parts into the `minab.config.json` shape the
 * engine takes.
 */

import type { Example } from '../content/types.js';
import { datasetById } from '../content/datasets/index.js';
import type { DataSourceMode, HostSettings, Row } from '../engine/protocol.js';

export interface WorkspaceHost {
    /** The dataset the schema and seed come from, or `null` for a schema written by hand. */
    dataset: string | null;
    /** A hand-written or edited schema; overrides the dataset's when set. */
    schema?: { tables: unknown[]; functions?: unknown[] };
    /** Rows for a hand-written schema; overrides the dataset's when set. */
    seed?: Record<string, Row[]>;
    rule: { recordTable?: string; fieldType?: string };
    record?: Row;
    fieldValue?: unknown;
    dataSource: DataSourceMode;
    /** Canned `data.responses`, used when `dataSource` is `fixtures`. */
    responses?: unknown[];
}

export interface Workspace {
    source: string;
    host: WorkspaceHost;
    /** The example this workspace started from, if any — for "reset to example" and the title bar. */
    exampleId?: string;
}

export const EMPTY_HOST: WorkspaceHost = { dataset: 'demo', rule: {}, dataSource: 'postgres' };

export function workspaceFromExample(example: Example): Workspace {
    const host = example.host;
    return {
        source: example.source,
        exampleId: example.id,
        host: {
            dataset: typeof host.dataset === 'string' ? host.dataset : null,
            schema: typeof host.dataset === 'string' ? undefined : host.dataset.schema,
            rule: { ...host.rule },
            record: host.record,
            fieldValue: host.fieldValue,
            dataSource: 'postgres'
        }
    };
}

/** The effective schema and seed: an override wins over the dataset. */
export function hostContents(host: WorkspaceHost): { schema: { tables: unknown[] }; seed: Record<string, Row[]> } {
    const dataset = host.dataset ? datasetById(host.dataset) : undefined;
    return {
        schema: host.schema ?? dataset?.schema ?? { tables: [] },
        seed: host.seed ?? (host.schema ? {} : dataset?.seed ?? {})
    };
}

/** The `minab.config.json`-shaped object the engine parses (plus `seed`). */
export function hostSettings(host: WorkspaceHost): HostSettings {
    const { schema, seed } = hostContents(host);
    const config: Record<string, unknown> = { schema, seed };
    const rule: Record<string, unknown> = {};
    if (host.rule.recordTable) rule.recordTable = host.rule.recordTable;
    if (host.rule.fieldType) rule.fieldType = host.rule.fieldType;
    if (Object.keys(rule).length > 0) config.rule = rule;
    if (host.record !== undefined) config.record = host.record;
    if (host.fieldValue !== undefined) config.fieldValue = host.fieldValue;
    if (host.responses) config.data = { responses: host.responses };
    return { config, dataSource: host.dataSource };
}

/** The config a user would save next to their program to run it with the CLI (no playground-only keys). */
export function cliConfig(host: WorkspaceHost): Record<string, unknown> {
    const { config } = hostSettings(host);
    const { seed: _seed, ...rest } = config;
    return rest;
}
