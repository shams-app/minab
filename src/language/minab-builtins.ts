/**
 * The eight built-in aggregate/predicate functions (spec §5.3.1) — called
 * by name (`NAME(...)`), like user functions. Each is polymorphic over its
 * collection's element type, so a signature here is a small type-checking
 * function rather than a single fixed `MinabType`.
 *
 * Built-in names are ALL UPPERCASE; a user `fn` name must have a lowercase
 * letter (D10, spec §5.3) — see `minab-validator.ts`'s `checkFunctionDeclName`.
 */

import { formatType, isNumeric, isOrderable, scalarType, type MinabType } from './minab-types.js';
import { coded, type CodedMessage } from './diagnostics/codes.js';

export type BuiltinCheckResult = { ok: true; type: MinabType } | ({ ok: false } & CodedMessage);

export interface BuiltinSignature {
    name: string;
    check(argType: MinabType): BuiltinCheckResult;
}

function elementType(argType: MinabType): MinabType | undefined {
    if (argType.kind === 'collection') {
        // The element of a relational collection is itself a record, not
        // a scalar — callers that need a scalar element type (SUM/AVG/
        // MIN/MAX) look past this at the broadcast scalar case instead.
        return undefined;
    }
    if (argType.kind === 'scalar' && argType.array) {
        return scalarType(argType.base, { nullable: argType.nullable });
    }
    return undefined;
}

const BUILTINS: BuiltinSignature[] = [
    {
        name: 'COUNT',
        check: argType => {
            if (argType.kind !== 'collection' && !(argType.kind === 'scalar' && argType.array)) {
                return { ok: false, ...coded('call.builtinNeedsCollection', { name: 'COUNT', actual: formatType(argType) }) };
            }
            return { ok: true, type: scalarType('INTEGER') };
        }
    },
    {
        name: 'SUM',
        check: argType => {
            const el = elementType(argType);
            if (!el || !isNumeric(el)) {
                return { ok: false, ...coded('call.builtinNeedsNumericCollection', { name: 'SUM', actual: formatType(argType) }) };
            }
            return { ok: true, type: el };
        }
    },
    {
        name: 'AVG',
        check: argType => {
            const el = elementType(argType);
            if (!el || !isNumeric(el)) {
                return { ok: false, ...coded('call.builtinNeedsNumericCollection', { name: 'AVG', actual: formatType(argType) }) };
            }
            return { ok: true, type: scalarType('DECIMAL') };
        }
    },
    {
        name: 'MIN',
        check: argType => {
            const el = elementType(argType);
            if (!el || !isOrderable(el)) {
                return { ok: false, ...coded('call.builtinNeedsOrderableCollection', { name: 'MIN', actual: formatType(argType) }) };
            }
            return { ok: true, type: el };
        }
    },
    {
        name: 'MAX',
        check: argType => {
            const el = elementType(argType);
            if (!el || !isOrderable(el)) {
                return { ok: false, ...coded('call.builtinNeedsOrderableCollection', { name: 'MAX', actual: formatType(argType) }) };
            }
            return { ok: true, type: el };
        }
    },
    {
        name: 'EXISTS',
        check: argType => {
            if (argType.kind !== 'collection' && !(argType.kind === 'scalar' && argType.array)) {
                return { ok: false, ...coded('call.builtinNeedsCollection', { name: 'EXISTS', actual: formatType(argType) }) };
            }
            return { ok: true, type: scalarType('BOOLEAN') };
        }
    },
    {
        name: 'ALL',
        check: argType => {
            const el = elementType(argType);
            if (!el || el.kind !== 'scalar' || el.base !== 'BOOLEAN') {
                return { ok: false, ...coded('call.builtinNeedsBooleanCollection', { name: 'ALL', actual: formatType(argType) }) };
            }
            return { ok: true, type: scalarType('BOOLEAN') };
        }
    },
    {
        name: 'ANY',
        check: argType => {
            const el = elementType(argType);
            if (!el || el.kind !== 'scalar' || el.base !== 'BOOLEAN') {
                return { ok: false, ...coded('call.builtinNeedsBooleanCollection', { name: 'ANY', actual: formatType(argType) }) };
            }
            return { ok: true, type: scalarType('BOOLEAN') };
        }
    }
];

const BUILTINS_BY_NAME = new Map(BUILTINS.map(b => [b.name, b]));

export function getBuiltin(name: string): BuiltinSignature | undefined {
    return BUILTINS_BY_NAME.get(name);
}

export function isBuiltinName(name: string): boolean {
    return BUILTINS_BY_NAME.has(name);
}

export function builtinNames(): string[] {
    return BUILTINS.map(b => b.name);
}
