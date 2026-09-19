import type { Row } from '../../engine/protocol.js';

/**
 * A world for programs to run against: the host schema (in the same JSON
 * shape as a `minab.config.json` `schema`) and the rows the in-browser
 * database starts with.
 */
export interface Dataset {
    id: string;
    title: string;
    /** One sentence: what the data is about. */
    description: string;
    schema: { tables: unknown[]; functions?: unknown[] };
    seed: Record<string, Row[]>;
}
