/**
 * Users and groups at run time (MN.2, proposal P1, P3, P9, P11).
 *
 * - `UserValue` is one member of the workspace. Its record is read from the directory port when a
 *   program asks for a column other than `id`, once for each user in a run.
 * - `UserGroupValue` is a set of users kept as a **tree** (`UserSet`): a group, explicit ids, the set
 *   operators, a filter. `u IN A + B` asks the port `isMember` for each side and never lists A or B.
 *   A full list is built only when a program needs one (`COUNT`, a loop, a result, `single`), and it
 *   stops at `limits.maxUsers`.
 * - `DirectoryRuntime` is the run's view of the directory port. It checks the abort signal and the wall
 *   time around every port call, and it keeps what it has read for the rest of the run.
 *
 * Nothing here touches Node or the DOM.
 */

import { PortError, type DirectoryContext, type DirectoryPort } from '../runtime/ports.js';
import type { Row } from './minab-executor.js';

/** One member of the workspace. `record` is filled when the record was read (a loop, a filter). */
export class UserValue {
    constructor(
        readonly id: string,
        public record?: Row
    ) {}

    /** What `LOG` and `JSON.stringify` show: the id only. */
    toJSON(): { id: string } {
        return { id: this.id };
    }
}

/** A set of users, as a tree. Nothing is listed until a program needs the list. */
export type UserSet =
    | { op: 'group'; id: string }
    | { op: 'ids'; ids: readonly string[] }
    | { op: 'union' | 'difference' | 'intersection' | 'symmetric'; left: UserSet; right: UserSet }
    | { op: 'complement'; of: UserSet }
    | UserFilterSet;

/** `of[test]`: the users of `of` for whom `test` is true. */
export interface UserFilterSet {
    op: 'filter';
    of: UserSet;
    /** Runs the filter on one user's record. */
    test: (user: Row) => Promise<boolean>;
    /** The text of the filter, for a port that answers it itself (`findUsers`). */
    source: string;
}

/** A `USERGROUP`: no order, no duplicates. */
export class UserGroupValue {
    constructor(readonly set: UserSet) {}

    /** What `LOG` and `JSON.stringify` show: a placeholder, never a list. */
    toJSON(): string {
        return '[a set of users]';
    }
}

/** A `GROUP` record (the answer of `groupsOf`). Its `members` is a set that is listed only when needed. */
export class GroupValue {
    constructor(readonly row: Row) {}

    /** The id of the group. */
    get id(): string {
        return String(this.row.id);
    }

    /** A column of the group. `members` is a set of users, listed only when needed. */
    read(column: string): unknown {
        if (column === 'members') return new UserGroupValue({ op: 'group', id: this.id });
        return this.row[column] ?? null;
    }

    /** What `LOG` and `JSON.stringify` show: the row. */
    toJSON(): Row {
        return this.row;
    }
}

/** The operand of a set operator: a set, one user (a set of one), or `null` (the empty set). `undefined`: not a user value. */
export function setOf(value: unknown): UserSet | undefined {
    if (value instanceof UserGroupValue) return value.set;
    if (value instanceof UserValue) return { op: 'ids', ids: [value.id] };
    if (value === null || value === undefined) return { op: 'ids', ids: [] };
    return undefined;
}

/** The union of the members of some groups: `.members` on a list of groups (P7). */
export function membersOf(groups: readonly GroupValue[]): UserGroupValue {
    return new UserGroupValue(
        groups.reduce<UserSet>((set, group) => ({ op: 'union', left: set, right: { op: 'group', id: group.id } }), { op: 'ids', ids: [] })
    );
}

/** What the directory needs from the budget of a run: the abort signal, the user limit, and a way to stop waiting for a slow port. */
export interface DirectoryBudget {
    readonly signal: AbortSignal;
    readonly limits: { readonly maxUsers: number };
    /** Throws when the host aborted or the wall time is up. */
    check(): void;
    /** Waits for a port call, and stops waiting when the run is aborted. */
    race<T>(call: Promise<T>): Promise<T>;
}

/** The run errors of the directory (P13). */
export type DirectoryErrorCode = 'eval.userNotFound' | 'eval.groupNotFound' | 'eval.notExactlyOne' | 'eval.tooManyUsers' | 'eval.routeCycle';

/** Throws the run error with this code, and the values its message is built from (`{ limit }`, `{ name }`, `{ count }`). */
export type DirectoryRaise = (code: DirectoryErrorCode, params?: Record<string, string | number>) => never;

/** How many users one `resolveUsers` call asks for. */
const CHUNK = 200;

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** The directory in one run. */
export class DirectoryRuntime {
    private readonly records = new Map<string, Row>();
    private readonly groups = new Map<string, GroupValue>();

    constructor(
        readonly port: DirectoryPort,
        private readonly budget: DirectoryBudget,
        /** Throws the run error with this code. The interpreter gives its own, so the error carries a range. */
        readonly raise: DirectoryRaise,
        /** Reads the columns of a user row by their types (decimals, dates, user columns). */
        private readonly normalize: (row: Row) => Row,
        private readonly specialUsers: Readonly<Record<string, string | null>> = {}
    ) {}

    /** The `limits.maxUsers` of this run. */
    get maxUsers(): number {
        return this.budget.limits.maxUsers;
    }

    /**
     * One call of the port. The run stops waiting at its wall time or when the host aborts. A port that throws
     * gives only a code: its text may hold personal data. A `PortError` keeps its own code.
     */
    ask<T>(call: (context: DirectoryContext) => Promise<T>): Promise<T> {
        this.budget.check();
        const guarded = Promise.resolve()
            .then(() => call({ signal: this.budget.signal }))
            .catch((e: unknown) => {
                throw e instanceof PortError ? e : new PortError('eval.failed', 'the directory port failed');
            });
        return this.budget.race(guarded);
    }

    // ---- users --------------------------------------------------------------

    /** Reads the records of these users (one call for every 200 not read yet). A user the port does not answer is `name: null`. */
    async load(ids: readonly string[]): Promise<void> {
        const missing = unique(ids).filter(id => !this.records.has(id));
        for (let start = 0; start < missing.length; start += CHUNK) {
            const chunk = missing.slice(start, start + CHUNK);
            const rows = await this.ask(context => this.port.resolveUsers(chunk, context));
            const asked = new Set(chunk);
            for (const row of Array.isArray(rows) ? rows : []) {
                if (row && typeof row.id === 'string' && asked.has(row.id) && !this.records.has(row.id)) this.records.set(row.id, this.normalize(row));
            }
            for (const id of chunk) if (!this.records.has(id)) this.records.set(id, this.normalize({ id, name: null }));
        }
    }

    /** The record of one user, read once for each run. */
    async record(id: string): Promise<Row> {
        await this.load([id]);
        return this.records.get(id)!;
    }

    /** The value of a special user (`@currentUser`): `undefined` when the run gave no such name. */
    specialUser(name: string): UserValue | null | undefined {
        if (!Object.hasOwn(this.specialUsers, name)) return undefined;
        const id = this.specialUsers[name];
        if (id === null) return null;
        return typeof id === 'string' ? new UserValue(id) : undefined;
    }

    // ---- groups -------------------------------------------------------------

    /** A group by name (`@@Sales`, `findGroup`). */
    async group(name: string): Promise<GroupValue> {
        let group = this.groups.get(name);
        if (!group) {
            const row = await this.ask(context => this.port.findGroup(name, context));
            if (!row || typeof row.id !== 'string') this.raise('eval.groupNotFound', { name });
            group = new GroupValue(row);
            this.groups.set(name, group);
        }
        return group;
    }

    private async everyoneId(): Promise<string> {
        return (await this.group('everyone')).id;
    }

    // ---- sets ---------------------------------------------------------------

    /** A set of the ids a route answered. */
    idsSet(ids: readonly string[]): UserGroupValue {
        if (ids.length > this.maxUsers) this.raise('eval.tooManyUsers', { limit: this.maxUsers });
        return new UserGroupValue({ op: 'ids', ids: ids.filter(id => typeof id === 'string') });
    }

    /** Is this user in the set? Asks `isMember` for each group on the way, and never lists a group. */
    async contains(set: UserSet, id: string): Promise<boolean> {
        this.budget.check();
        switch (set.op) {
            case 'group':
                return (await this.ask(context => this.port.isMember(id, set.id, context))) === true;
            case 'ids':
                return set.ids.includes(id);
            case 'union':
                return (await this.contains(set.left, id)) || (await this.contains(set.right, id));
            case 'intersection':
                return (await this.contains(set.left, id)) && (await this.contains(set.right, id));
            case 'difference':
                return (await this.contains(set.left, id)) && !(await this.contains(set.right, id));
            case 'symmetric': {
                const inLeft = await this.contains(set.left, id);
                return inLeft !== (await this.contains(set.right, id));
            }
            case 'complement':
                // Everyone except A: not in A, and a member of the workspace.
                return !(await this.contains(set.of, id)) && (await this.contains({ op: 'group', id: await this.everyoneId() }, id));
            case 'filter':
                return (await this.contains(set.of, id)) && (await set.test(await this.record(id)));
        }
    }

    /** The ids of the set, at most `limits.maxUsers` (else `eval.tooManyUsers`). */
    async list(set: UserSet): Promise<string[]> {
        this.budget.check();
        const max = this.maxUsers;
        const within = (ids: string[]): string[] => {
            if (ids.length > max) this.raise('eval.tooManyUsers', { limit: max });
            return ids;
        };
        switch (set.op) {
            case 'group': {
                const found = new Set<string>();
                let cursor: string | undefined;
                do {
                    const page = await this.ask(context => this.port.members(set.id, cursor, context));
                    for (const id of page.ids) found.add(id);
                    within([...found]);
                    cursor = page.next;
                } while (cursor !== undefined);
                return [...found];
            }
            case 'ids':
                return within(unique(set.ids));
            case 'union':
                return within(unique([...(await this.list(set.left)), ...(await this.list(set.right))]));
            case 'intersection': {
                const right = new Set(await this.list(set.right));
                return (await this.list(set.left)).filter(id => right.has(id));
            }
            case 'difference': {
                const right = new Set(await this.list(set.right));
                return (await this.list(set.left)).filter(id => !right.has(id));
            }
            case 'symmetric': {
                const left = await this.list(set.left);
                const right = await this.list(set.right);
                const inLeft = new Set(left);
                const inRight = new Set(right);
                return within([...left.filter(id => !inRight.has(id)), ...right.filter(id => !inLeft.has(id))]);
            }
            case 'complement': {
                const except = new Set(await this.list(set.of));
                return (await this.list({ op: 'group', id: await this.everyoneId() })).filter(id => !except.has(id));
            }
            case 'filter':
                return await this.listFilter(set, max);
        }
    }

    private async listFilter(set: UserFilterSet, max: number): Promise<string[]> {
        // A port that can answer a filter over everyone does it itself (`findUsers`); `null` means it cannot.
        if (this.port.findUsers && set.of.op === 'group' && set.of.id === (await this.everyoneId())) {
            const rows = await this.ask(context => this.port.findUsers!({ source: set.source }, max + 1, context));
            if (Array.isArray(rows)) {
                const ids = unique(rows.filter(row => row && typeof row.id === 'string').map(row => row.id));
                if (ids.length > max) this.raise('eval.tooManyUsers', { limit: max });
                return ids;
            }
        }
        const ids = await this.list(set.of);
        await this.load(ids);
        const kept: string[] = [];
        for (const id of ids) {
            this.budget.check();
            if (await set.test(this.records.get(id)!)) kept.push(id);
        }
        return kept;
    }

    /** The users of a set, each with its record: for a loop, `COUNT` and a result. */
    async users(set: UserSet): Promise<UserValue[]> {
        const ids = await this.list(set);
        await this.load(ids);
        return ids.map(id => new UserValue(id, this.records.get(id)));
    }

    /** `single` (`orNull: false`) and `singleOrNull`. */
    async single(set: UserSet, orNull: boolean): Promise<UserValue | null> {
        const ids = await this.list(set);
        if (ids.length === 1) return new UserValue(ids[0]);
        if (ids.length === 0 && orNull) return null;
        return this.raise('eval.notExactlyOne', { count: ids.length });
    }
}
