/**
 * The eight built-in aggregate/predicate functions (spec §5.3.1) — called
 * bare (`Name(...)`), never `&`-prefixed. Each is polymorphic over its
 * collection's element type, so a signature here is a small type-checking
 * function rather than a single fixed `MinabType`.
 *
 * These names are reserved: a user `fn` may not declare one of them (spec
 * §5.3) — see `minab-validator.ts`'s `checkFunctionDeclNotReservedName`.
 */

import { formatType, isNumeric, isOrderable, scalarType, type MinabType } from './minab-types.js';

export type BuiltinCheckResult = { ok: true; type: MinabType } | { ok: false; reason: string };

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
                return { ok: false, reason: `COUNT expects a collection, got ${formatType(argType)}` };
            }
            return { ok: true, type: scalarType('INTEGER') };
        }
    },
    {
        name: 'SUM',
        check: argType => {
            const el = elementType(argType);
            if (!el || !isNumeric(el)) {
                return { ok: false, reason: `SUM expects a collection of INTEGER or DECIMAL, got ${formatType(argType)}` };
            }
            return { ok: true, type: el };
        }
    },
    {
        name: 'AVG',
        check: argType => {
            const el = elementType(argType);
            if (!el || !isNumeric(el)) {
                return { ok: false, reason: `AVG expects a collection of INTEGER or DECIMAL, got ${formatType(argType)}` };
            }
            return { ok: true, type: scalarType('DECIMAL') };
        }
    },
    {
        name: 'MIN',
        check: argType => {
            const el = elementType(argType);
            if (!el || !isOrderable(el)) {
                return { ok: false, reason: `MIN expects a collection of an orderable type, got ${formatType(argType)}` };
            }
            return { ok: true, type: el };
        }
    },
    {
        name: 'MAX',
        check: argType => {
            const el = elementType(argType);
            if (!el || !isOrderable(el)) {
                return { ok: false, reason: `MAX expects a collection of an orderable type, got ${formatType(argType)}` };
            }
            return { ok: true, type: el };
        }
    },
    {
        name: 'EXISTS',
        check: argType => {
            if (argType.kind !== 'collection' && !(argType.kind === 'scalar' && argType.array)) {
                return { ok: false, reason: `EXISTS expects a collection, got ${formatType(argType)}` };
            }
            return { ok: true, type: scalarType('BOOLEAN') };
        }
    },
    {
        name: 'ALL',
        check: argType => {
            const el = elementType(argType);
            if (!el || el.kind !== 'scalar' || el.base !== 'BOOLEAN') {
                return { ok: false, reason: `ALL expects a collection of BOOLEAN, got ${formatType(argType)}` };
            }
            return { ok: true, type: scalarType('BOOLEAN') };
        }
    },
    {
        name: 'ANY',
        check: argType => {
            const el = elementType(argType);
            if (!el || el.kind !== 'scalar' || el.base !== 'BOOLEAN') {
                return { ok: false, reason: `ANY expects a collection of BOOLEAN, got ${formatType(argType)}` };
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
