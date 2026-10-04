/**
 * The Minab events as Nest log lines (phase H2, decisions D37 and D36).
 *
 * - Off by default when `NODE_ENV` is `production`. Logs are for debugging.
 * - At most `maxEntries` lines for one run. The rest is dropped and counted.
 * - Every value is on one line: a newline, a control character or a line separator is escaped,
 *   so a logged value cannot forge another log line.
 * - Every line is tagged with the program id and the request id.
 * - Logged values may hold personal data. The statement line has the SQL text, never the parameter values.
 */

import { Logger, type LoggerService } from '@nestjs/common';
import { DEFAULT_LIMITS } from '../runtime/limits.js';
import type { EventSink, MinabEvent } from '../runtime/ports.js';
import type { MinabLogOptions } from './options.js';

const MAX_LINE = 2000;

/** One line: `\`, newlines and control characters are escaped. A long text is cut. */
export function oneLine(text: string): string {
    const escaped = text.replace(/[\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, char => {
        switch (char) {
            case '\\':
                return '\\\\';
            case '\n':
                return '\\n';
            case '\r':
                return '\\r';
            case '\t':
                return '\\t';
            default:
                return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
        }
    });
    return escaped.length > MAX_LINE ? `${escaped.slice(0, MAX_LINE)}...` : escaped;
}

/** Is logging on? `NODE_ENV=production` turns it off unless the host asks for it (D37). */
export function logsEnabled(options: boolean | MinabLogOptions | undefined): boolean {
    if (options === false) return false;
    if (options === true) return true;
    return options?.enabled ?? process.env.NODE_ENV !== 'production';
}

export interface MinabLoggerTags {
    programId?: string;
    requestId?: string;
}

export class MinabLogger implements EventSink {
    private written = 0;
    private dropped = 0;
    private readonly enabled: boolean;
    private readonly statements: boolean;
    private readonly maxEntries: number;
    private readonly prefix: string;

    constructor(
        options: boolean | MinabLogOptions | undefined,
        tags: MinabLoggerTags = {},
        private readonly logger: LoggerService = new Logger('Minab')
    ) {
        const object = typeof options === 'object' ? options : {};
        this.enabled = logsEnabled(options);
        this.statements = object.statements ?? false;
        this.maxEntries = object.maxEntries ?? DEFAULT_LIMITS.logEntries;
        this.prefix = `[program=${oneLine(tags.programId ?? '-')} request=${oneLine(tags.requestId ?? '-')}]`;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /** How many lines were dropped over the cap. */
    get droppedCount(): number {
        return this.dropped;
    }

    emit(event: MinabEvent): void {
        if (!this.enabled) return;
        if (event.kind === 'log') this.write(event.message, false);
        else if (event.kind === 'statement' && this.statements) this.write(`statement (${event.params.length} parameters): ${event.sql}`, true);
    }

    private write(message: string, debug: boolean): void {
        if (this.written >= this.maxEntries) {
            this.dropped++;
            return;
        }
        this.written++;
        const line = `${this.prefix} ${oneLine(message)}`;
        if (debug) this.logger.debug?.(line);
        else this.logger.log(line);
    }

    /** Call at the end of a run: one line says how many entries were dropped. */
    finish(): void {
        if (this.enabled && this.dropped > 0) this.logger.warn?.(`${this.prefix} ${this.dropped} log entries dropped (limit ${this.maxEntries})`);
    }
}
