/** Text shared by hover and completion: types, columns, tables, signatures. */

import { formatType, type MinabType } from '../language/minab-types.js';
import type { ResolvedHostFunction } from '../language/host-declarations.js';
import type { MinabColumnSchema, MinabTableSchema } from '../language/schema.js';

/** `text` in Markdown code quotes. */
export function code(text: string): string {
    return '`' + text.replace(/`/g, '\\`') + '`';
}

/** A column's type as a short phrase: `DECIMAL`, `ref → Customer via customer_id`. */
export function describeColumn(column: MinabColumnSchema): string {
    const type = column.type;
    switch (type.kind) {
        case 'scalar':
            return formatType(type.type);
        case 'ref':
            return `ref → ${type.table}${type.nullable ? ' (nullable)' : ''}${type.foreignKey ? ` via ${type.foreignKey}` : ''}`;
        case 'collection':
            return `collection of ${type.table}${type.foreignKey ? ` via ${type.foreignKey}` : ''}`;
    }
}

/** The columns of a table as a Markdown table. */
export function tableSummary(table: MinabTableSchema): string {
    const lines = table.columns.map(c => `| ${code(c.name)}${table.primaryKey === c.name ? ' 🔑' : ''} | ${code(describeColumn(c))} |`);
    return `| column | type |\n|---|---|\n${lines.join('\n')}`;
}

/** The type line of a hover: `**type** \`DECIMAL\``. */
export function typeLine(type: MinabType | undefined): string {
    return type ? `\n\n**type** ${code(formatType(type))}` : '';
}

/** `fxRate(from: TEXT, to: TEXT) → DECIMAL` */
export function hostFunctionSignature(fn: ResolvedHostFunction): string {
    return `${fn.name}(${fn.params.map(p => `${p.name}: ${formatType(p.type)}`).join(', ')}) → ${formatType(fn.returns)}`;
}

export function hostFunctionDoc(fn: ResolvedHostFunction): string {
    return fn.local ? 'A function of the host. It runs in the browser too.' : 'A function of the host. A program that calls it needs the server.';
}

const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A name as a program must write it: with backticks when it is not a plain word (spec §2.4). */
export function nameText(name: string): string {
    return PLAIN_NAME.test(name) ? name : '`' + name.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}
