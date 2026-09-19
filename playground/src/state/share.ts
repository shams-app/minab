/**
 * Share links: the whole workspace, compressed into the URL fragment.
 *
 * The fragment (`#s=…`) never reaches a server, so a shared program stays
 * between the people who pass the link around. The host travels as its
 * parts — dataset id, rule, record, `$` — not as the dataset's rows, which
 * keeps a typical link to a few hundred characters. A hand-edited schema
 * travels whole, since there's nothing to point at instead.
 */

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Workspace, WorkspaceHost } from './workspace.js';

const VERSION = 1;

interface SharePayload {
    v: number;
    /** source */
    s: string;
    /** host */
    h: WorkspaceHost;
    /** example the workspace started from */
    e?: string;
}

export function encodeShare(workspace: Workspace): string {
    const payload: SharePayload = { v: VERSION, s: workspace.source, h: workspace.host };
    if (workspace.exampleId) payload.e = workspace.exampleId;
    return compressToEncodedURIComponent(JSON.stringify(payload));
}

export type DecodeResult = { ok: true; workspace: Workspace } | { ok: false; error: string };

export function decodeShare(encoded: string): DecodeResult {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return { ok: false, error: 'This share link is incomplete or damaged — it may have been cut off when it was copied.' };
    let payload: SharePayload;
    try {
        payload = JSON.parse(json) as SharePayload;
    } catch {
        return { ok: false, error: 'This share link is damaged.' };
    }
    if (payload.v !== VERSION) {
        return { ok: false, error: `This link was made by a newer playground (format ${payload.v}).` };
    }
    if (typeof payload.s !== 'string' || typeof payload.h !== 'object' || payload.h === null) {
        return { ok: false, error: 'This share link is damaged.' };
    }
    const host = payload.h;
    return {
        ok: true,
        workspace: {
            source: payload.s,
            exampleId: payload.e,
            host: {
                dataset: host.dataset ?? null,
                schema: host.schema,
                seed: host.seed,
                rule: host.rule ?? {},
                record: host.record,
                fieldValue: host.fieldValue,
                dataSource: host.dataSource === 'fixtures' ? 'fixtures' : 'postgres',
                responses: host.responses
            }
        }
    };
}

/** Reads `#s=…` from a location hash, if present. */
export function shareFromHash(hash: string): string | undefined {
    const match = /(?:^#|&)s=([^&]+)/.exec(hash);
    return match?.[1];
}

/** A full link to a workspace, on the given page (`/play` or `/embed`). */
export function shareUrl(workspace: Workspace, page: '/play' | '/embed', origin: string, base: string): string {
    const root = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${origin}${root}${page}#s=${encodeShare(workspace)}`;
}
