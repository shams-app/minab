/**
 * The host functions of the directory (MN.2, proposal P4, P5, P7, P8): `findUser`, `findGroup`, `single`,
 * `singleOrNull`, `specialUser` and `groupsOf`, and the routes. Minab's core registers none of them: it
 * knows the types and the operators, and the host knows its directory. A host calls
 * `directoryHostFunctions(port)`, gives `declarations` to `createMinab({ functions })` and `functions` to
 * the run (`RunPorts.hostFunctions`).
 *
 * Every function reads and lists through the run's `DirectoryRuntime` (`context.directory`), so the
 * abort signal, the wall time and `limits.maxUsers` apply. No Node or DOM types.
 */

import { GroupValue, setOf, UserGroupValue, UserValue, type DirectoryRuntime } from '../language/directory-values.js';
import type { HostFunctionDeclaration } from '../language/host-declarations.js';
import { PortError, type DirectoryPort, type HostCallContext, type HostFunctions } from '../runtime/ports.js';

/** How many route calls may be open around one call (P7). The fourth nested one is `eval.routeCycle`. */
export const MAX_ROUTE_DEPTH = 3;

/** What a route returns: a set of users, or one user or nobody (P7). */
export type RouteReturns = 'USERGROUP' | 'USER?';

/** A host function: its declaration for the checker and its code for the run. */
export interface DirectoryHostFunction {
    declaration: HostFunctionDeclaration;
    run(args: unknown[], context: HostCallContext): unknown | Promise<unknown>;
}

/** What `directoryHostFunctions` gives: declarations for `createMinab` and the implementation for each run. */
export interface DirectoryHostFunctions {
    declarations: HostFunctionDeclaration[];
    functions: HostFunctions;
}

export interface DirectoryFunctionOptions {
    /** `true`: the port answers with no round trip, so a program that uses these functions can run in the browser. */
    local?: boolean;
    /** Routes the workspace defines (P7). Each one becomes a host function that calls `port.callRoute`. */
    routes?: ReadonlyArray<{ name: string; returns: RouteReturns }>;
    /** How many route calls are open around the functions of this set (a host that runs a route body passes `context.depth + 1`). */
    routeDepth?: number;
}

function runtimeOf(context: HostCallContext): DirectoryRuntime {
    if (!context.directory) throw new PortError('eval.failed', 'a directory host function needs the directory of a run');
    return context.directory;
}

/** Combines functions into the one implementation a run takes. A name nobody knows is a failure of the host function. */
export function hostFunctionsOf(entries: readonly DirectoryHostFunction[]): HostFunctions {
    const byName = new Map(entries.map(entry => [entry.declaration.name, entry]));
    return {
        call: (name, args, context) => {
            const entry = byName.get(name);
            if (!entry) throw new PortError('eval.hostFunctionMissing', `the host function "${name}" has no implementation`);
            return entry.run(args, context);
        }
    };
}

/**
 * A route: `teamLeader(u: USER): USERGROUP` or `manager(u: USER): USER?`. It calls `port.callRoute`, which runs the
 * route's body. A route called more than 3 deep in one evaluation is `eval.routeCycle`: a host that runs a body
 * makes the routes inside it with `depth: context.depth + 1`.
 */
export function routeHostFunction(
    port: DirectoryPort,
    name: string,
    returns: RouteReturns,
    options: { depth?: number; local?: boolean } = {}
): DirectoryHostFunction {
    const depth = options.depth ?? 0;
    return {
        declaration: { name, params: [{ name: 'u', type: 'USER' }], returns, ...(options.local ? { local: true } : {}) },
        async run([user], context) {
            const directory = runtimeOf(context);
            if (depth >= MAX_ROUTE_DEPTH) directory.raise('eval.routeCycle', { name, limit: MAX_ROUTE_DEPTH });
            if (!(user instanceof UserValue)) throw new PortError('eval.failed', `the route "${name}" needs a user`);
            const answer = await directory.ask(c => port.callRoute(name, user.id, { ...c, depth }));
            const ids = Array.isArray(answer) ? answer : [];
            if (returns === 'USERGROUP') return directory.idsSet(ids);
            if (ids.length > 1) directory.raise('eval.notExactlyOne', { count: ids.length });
            return ids.length === 1 ? new UserValue(ids[0]) : null;
        }
    };
}

/** `findUser`, `findGroup`, `single`, `singleOrNull`, `specialUser`, `groupsOf`, and the routes of `options.routes`. */
export function directoryHostFunctions(port: DirectoryPort, options: DirectoryFunctionOptions = {}): DirectoryHostFunctions {
    const local = options.local ? { local: true } : {};
    const entries: DirectoryHostFunction[] = [
        {
            declaration: { name: 'findUser', params: [{ name: 'key', type: 'TEXT' }], returns: 'USER', ...local },
            async run([key], context) {
                const directory = runtimeOf(context);
                const id = typeof key === 'string' ? await directory.ask(c => port.findUser(key, c)) : null;
                if (typeof id !== 'string') return directory.raise('eval.userNotFound');
                return new UserValue(id);
            }
        },
        {
            declaration: { name: 'findGroup', params: [{ name: 'name', type: 'TEXT' }], returns: 'USERGROUP', ...local },
            async run([name], context) {
                const directory = runtimeOf(context);
                const group = typeof name === 'string' ? await directory.ask(c => port.findGroup(name, c)) : null;
                if (!group || typeof group.id !== 'string') return directory.raise('eval.groupNotFound', { name: String(name) });
                return new UserGroupValue({ op: 'group', id: group.id });
            }
        },
        {
            declaration: { name: 'single', params: [{ name: 'users', type: 'USERGROUP' }], returns: 'USER', ...local },
            async run([users], context) {
                const set = setOf(users);
                if (!set) throw new PortError('eval.failed', 'single needs a set of users');
                return await runtimeOf(context).single(set, false);
            }
        },
        {
            declaration: { name: 'singleOrNull', params: [{ name: 'users', type: 'USERGROUP' }], returns: 'USER?', ...local },
            async run([users], context) {
                const set = setOf(users);
                if (!set) throw new PortError('eval.failed', 'singleOrNull needs a set of users');
                return await runtimeOf(context).single(set, true);
            }
        },
        {
            declaration: { name: 'specialUser', params: [{ name: 'name', type: 'TEXT' }], returns: 'USER?', ...local },
            run([name], context) {
                const directory = runtimeOf(context);
                const user = typeof name === 'string' ? directory.specialUser(name) : undefined;
                return user === undefined ? directory.raise('eval.userNotFound') : user;
            }
        },
        {
            declaration: { name: 'groupsOf', params: [{ name: 'user', type: 'USER' }], returns: 'GROUP[]', ...local },
            async run([user], context) {
                if (!(user instanceof UserValue)) return [];
                const rows = await runtimeOf(context).ask(c => port.groupsOf(user.id, c));
                return (Array.isArray(rows) ? rows : []).filter(row => row && typeof row.id === 'string').map(row => new GroupValue(row));
            }
        },
        ...(options.routes ?? []).map(route => routeHostFunction(port, route.name, route.returns, { depth: options.routeDepth, local: options.local }))
    ];
    return { declarations: entries.map(entry => entry.declaration), functions: hostFunctionsOf(entries) };
}
