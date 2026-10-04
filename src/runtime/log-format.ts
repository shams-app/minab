/**
 * How a logged value looks as one line (`LOG`, decisions D19 and D37).
 *
 * A log line is always one line. Text is quoted and its newlines are written as `\n`,
 * so a value can never fake a second log line. Nothing here touches Node or the DOM.
 */

const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;

/** The value on one line: a `DECIMAL` plainly, anything else as compact JSON. */
export function formatLogValue(value: unknown): string {
    // A `DECIMAL` is a string such as "24.9" (D17). Show it as the number it is.
    if (typeof value === 'string' && DECIMAL_TEXT.test(value)) return value;
    return oneLine(JSON.stringify(value ?? null) ?? 'null');
}

/** `label: value`, or only the value when there is no label. A label with a newline is escaped too. */
export function formatLogMessage(value: unknown, label: string | undefined): string {
    return label === undefined ? formatLogValue(value) : `${oneLine(label)}: ${formatLogValue(value)}`;
}

/** Writes every line break as an escape. JSON already escapes `\n` and `\r` inside text; this covers the rest. */
const LINE_BREAKS: Record<string, string> = { '\n': '\\n', '\r': '\\r', [String.fromCharCode(0x2028)]: '\\u2028', [String.fromCharCode(0x2029)]: '\\u2029' };
const LINE_BREAK = new RegExp(`[${Object.keys(LINE_BREAKS).join('')}]`, 'g');

function oneLine(text: string): string {
    return text.replace(LINE_BREAK, c => LINE_BREAKS[c]);
}
