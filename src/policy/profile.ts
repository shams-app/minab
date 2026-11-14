/**
 * The policy profile (MN.3, proposal P12): the small part of Minab that policies, dynamic and computed groups and
 * named routes are written in. The engine never runs Minab source (Shamsine spec Z31): `compilePolicy()` turns a
 * program of this profile into the policy IR when the rule is saved.
 *
 * This file holds what a host and `prepare` need to know about the profile: its names, its limits, and the rule
 * context and host inputs it expects. The walk that checks and compiles a program is in `compile-ir.ts`.
 */

import type { HostInputType } from '../language/host-declarations.js';
import type { MinabRuleContext } from '../language/schema.js';

/** `request.<key>` in a condition (Shamsine security spec §9.1). */
export const POLICY_REQUEST_KEYS = ['time', 'ip', 'mfa', 'clientId', 'tagKey'] as const;

/** The built-in functions the IR has (`CAST(… AS DATE)` is the seventh, `DATE`). */
export const POLICY_FUNCTIONS = ['NOW', 'LOWER', 'UPPER', 'YEAR', 'MONTH', 'DAY'] as const;

/** The system groups other than `everyone`, which has a node of its own (Shamsine spec §6.1). */
export const POLICY_SYSTEM_GROUPS = ['owners', 'admins', 'members', 'operators', 'viewers', 'applications'] as const;

/** Route calls may sit at most this deep inside each other (P7, P12). */
export const MAX_ROUTE_NESTING = 3;

/** The name of the one parameter of a route (P7). */
export const ROUTE_USER = 'u';

/** What the runtime puts in front of a route body, so `u` is a `USER` (the special user `routeUser` is the route's argument). */
export const ROUTE_PREFIX = `let ${ROUTE_USER}: USER = @routeUser;\n`;

/** A route the workspace defines (P7): a host function with one `USER` parameter. */
export interface PolicyRoute {
    name: string;
    returns: 'USERGROUP' | 'USER?';
}

/** What `prepare` needs besides the source when `profile` is `'policy'`. */
export interface PolicyOptions {
    /** The host declares `@appUser` only for the rules of an installed application (P8). Default `false`. */
    appUser?: boolean;
    /** The workspace's group names, so an unknown `@@Name` is `scope.unknownGroup`. */
    groupNames?: readonly string[];
    /** The tag keys the workspace uses. A `resource.tags.<key>` outside the list is the warning `policy.unknownTagKey` (P12). */
    tagKeys?: readonly string[];
    /** The routes the workspace has. The host also declares them as functions (`directoryHostFunctions`). */
    routes?: readonly PolicyRoute[];
    /** For `expect: 'route'`: what the route returns. Default `USERGROUP`. */
    route?: { returns: 'USERGROUP' | 'USER?' };
}

/**
 * The host inputs of the policy context: `request`, `resource` (only `resource.tags.<key>` is allowed, P12) and, for rules
 * on writes, `new`, the record after the change. Give them to `createMinab({ inputs })`; `record` lists the fields of `new`.
 */
export function policyInputs(record?: Record<string, string>): Record<string, HostInputType> {
    return {
        request: { time: 'DATETIME', ip: 'TEXT', mfa: 'BOOLEAN', clientId: 'TEXT', tagKey: 'TEXT?' },
        resource: { tags: 'JSON' },
        ...(record ? { new: record } : {})
    };
}

/** The rule context of a policy program: the special users of the policy context, the group names and the tag read. */
export function policyRuleContext(base: MinabRuleContext, kind: 'boolean' | 'principal' | 'route', options: PolicyOptions): MinabRuleContext {
    const specialUsers =
        kind === 'route'
            ? [{ name: 'routeUser', type: 'USER' as const }]
            : [{ name: 'currentUser', type: 'USER' as const }, ...(options.appUser ? [{ name: 'appUser', type: 'USER' as const }] : [])];
    return { ...base, isFieldRule: false, specialUsers, ...(options.groupNames ? { groupNames: options.groupNames } : {}), resourceTags: true };
}

/** The keys closest to `key` (at most 3, edit distance at most 3), for the warning `policy.unknownTagKey`. */
export function closestKeys(key: string, known: readonly string[]): string[] {
    const distance = (a: string, b: string): number => {
        const row = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            let diagonal = row[0];
            row[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const above = row[j];
                row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
                diagonal = above;
            }
        }
        return row[b.length];
    };
    return known
        .map(candidate => ({ candidate, d: distance(key.toLowerCase(), candidate.toLowerCase()) }))
        .filter(item => item.d <= 3)
        .sort((a, b) => a.d - b.d || a.candidate.localeCompare(b.candidate))
        .slice(0, 3)
        .map(item => item.candidate);
}
