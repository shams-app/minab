/**
 * Data sources any host can use without a database driver.
 *
 * `QueryExecutor` (see `minab-executor.ts`) is the whole contract: take
 * SQL text plus positional parameters, give back rows. `FixtureExecutor`
 * answers from canned responses, so a rule or a query can be run — and its
 * *strategy* inspected — with no database anywhere. The CLI uses it for a
 * config's `data.responses`; `test/evaluation.test.ts` uses the same trick.
 */

import { matchResponse, type DirectoryConfig, type FixtureGroup, type FixtureResponse, type FixtureUser } from './config.js';
import { directoryHostFunctions, type DirectoryHostFunctions } from './directory-functions.js';
import type { QueryExecutor, Row, SqlQuery } from '../language/minab-executor.js';
import { scalarType, DEFAULT_DIRECTORY, type DirectorySchema, type MinabColumnSchema } from '../language/schema.js';
import { createMinab } from '../runtime/minab.js';
import { PortError, type DirectoryGroup, type DirectoryPort, type DirectoryUser, type RouteContext } from '../runtime/ports.js';
import type { Minab, PreparedProgram } from '../runtime/types.js';

/** Thrown for a data-source problem (no fixture answer, a driver that isn't installed, a database that rejects the SQL). Reported as a message, never a stack trace. */
export class DataSourceError extends Error {}

/**
 * Answers from the config's `data.responses`, in order: the first response
 * whose `match` appears in the generated SQL wins, and a response with no
 * `match` answers anything.
 *
 * Running out of answers is an error rather than an empty result. A silent
 * `[]` would look exactly like "the database says no rows", which is the
 * wrong answer to the question the fixture was asked; the message prints
 * the SQL that went unanswered so the missing response can be written.
 */
export class FixtureExecutor implements QueryExecutor {
    readonly statements: SqlQuery[] = [];

    constructor(private readonly responses: FixtureResponse[]) {}

    async execute(query: SqlQuery): Promise<Row[]> {
        this.statements.push(query);
        const response = matchResponse(this.responses, query);
        if (!response) {
            throw new DataSourceError(
                this.responses.length === 0
                    ? `this program needs data, and no data source was configured.\n` +
                          `Add a "data" section to the config, or pass --database <url>.\n` +
                          `Unanswered statement:\n  ${query.text}`
                    : `no configured response matches this statement:\n  ${query.text}\n` +
                          `Add a response with a "match" substring of it, or one with no "match" at all.`
            );
        }
        return response.rows;
    }
}

/** Wraps an executor so every statement it runs is reported (`--trace`) as it happens, rather than only after the program finishes. */
export function traced(executor: QueryExecutor, onStatement: (query: SqlQuery) => void): QueryExecutor {
    return {
        async execute(query: SqlQuery): Promise<Row[]> {
            onStatement(query);
            return await executor.execute(query);
        }
    };
}

// ---- the fixture directory (MN.2) -----------------------------------------------

const ROLE_GROUPS: Record<string, string> = { owner: 'owners', admin: 'admins', member: 'members', operator: 'operators', viewer: 'viewers' };
const FIXED_COLUMNS = new Set(['id', 'name', 'email', 'phone', 'language', 'timeZone', 'role', 'kind', 'joinedAt', 'left']);
const PAGE = 500;

/** Persian and Arabic digits become ASCII; `0912…` and `0098…` become `+98…`. Like sign-in (P4). */
function normalizePhone(text: string): string {
    const digits = text.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660));
    const plain = digits.replace(/[\s\-()]/g, '');
    if (plain.startsWith('00')) return `+${plain.slice(2)}`;
    if (/^0\d{10}$/.test(plain)) return `+98${plain.slice(1)}`;
    return plain;
}

/**
 * A small directory made from a config's `directory` section (users, groups with tags, routes in Minab). The CLI and
 * the playground run users and groups against it with no server. The system groups are made from the users: `everyone`
 * (people), `applications`, and one group for each role (`owners`, `admins`, `members`, `operators`, `viewers`).
 * A route body is a Minab program run by `createMinab` over this same directory (`callRoute`).
 */
export class FixtureDirectory implements DirectoryPort {
    private readonly users = new Map<string, FixtureUser>();
    private readonly groups = new Map<string, FixtureGroup>();
    private routeMinab: Minab | undefined;
    private readonly routePrograms = new Map<string, Promise<PreparedProgram>>();

    constructor(readonly config: DirectoryConfig) {
        for (const user of config.users) this.users.set(user.id, user);
        for (const group of config.groups) this.groups.set(group.name, group);
        const present = (user: FixtureUser) => !user.left && user.kind !== 'application';
        const system = (name: string, test: (user: FixtureUser) => boolean) =>
            this.groups.set(name, { name, members: config.users.filter(user => !user.left && test(user)).map(user => user.id), includes: [], tags: [] });
        system('everyone', present);
        system('applications', user => user.kind === 'application');
        for (const [role, name] of Object.entries(ROLE_GROUPS)) system(name, user => present(user) && user.role === role);
    }

    /** The names for `ruleContext.groupNames`. */
    get groupNames(): string[] {
        return [...this.groups.keys()];
    }

    /** The special users for `ruleContext.specialUsers`. */
    get specialUserDeclarations(): { name: string; type: 'USER' | 'USER?' }[] {
        return Object.entries(this.config.specialUsers).map(([name, id]) => ({ name, type: id === null ? 'USER?' : 'USER' }));
    }

    /** What to give a run: the directory host functions (with the routes). */
    functions(options: { routeDepth?: number } = {}): DirectoryHostFunctions {
        return directoryHostFunctions(this, { routes: this.config.routes, routeDepth: options.routeDepth, local: true });
    }

    schema(): DirectorySchema {
        const text = (name: string): MinabColumnSchema => ({ name, type: { kind: 'scalar', type: scalarType('TEXT', { nullable: true }) } });
        const attributes = new Set(this.config.users.flatMap(user => Object.keys(user)).filter(key => !FIXED_COLUMNS.has(key)));
        return { user: [...DEFAULT_DIRECTORY.user, ...[...attributes].map(text)], group: DEFAULT_DIRECTORY.group };
    }

    private row(user: FixtureUser): DirectoryUser {
        const row: Record<string, unknown> = { id: user.id, name: user.name };
        for (const column of this.schema().user ?? []) {
            if (column.name === 'id' || column.name === 'name') continue;
            if (user.left) row[column.name] = null;
            else
                row[column.name] =
                    user[column.name] ??
                    (column.name === 'joinedAt' ? '2026-01-01T00:00:00Z' : column.name === 'kind' ? 'person' : column.name === 'role' ? 'member' : null);
        }
        return row as DirectoryUser;
    }

    private flat(name: string, seen = new Set<string>()): Set<string> {
        const ids = new Set<string>();
        const group = this.groups.get(name);
        if (!group || seen.has(name)) return ids;
        seen.add(name);
        for (const id of group.members) if (!this.users.get(id)?.left) ids.add(id);
        for (const included of group.includes) for (const id of this.flat(included, seen)) ids.add(id);
        return ids;
    }

    private groupRow(group: FixtureGroup): DirectoryGroup {
        return { id: `grp_${group.name}`, name: group.name, tags: group.tags, kind: this.config.groups.includes(group) ? 'custom' : 'system' };
    }

    private byId(groupId: string): FixtureGroup | undefined {
        return [...this.groups.values()].find(group => `grp_${group.name}` === groupId);
    }

    async resolveUsers(ids: string[]): Promise<DirectoryUser[]> {
        return ids.map(id => (this.users.has(id) ? this.row(this.users.get(id)!) : ({ id, name: null } as DirectoryUser)));
    }

    async findUser(key: string): Promise<string | null> {
        const phone = normalizePhone(key);
        const found = this.config.users.find(
            user =>
                !user.left &&
                (user.id === key ||
                    (typeof user.email === 'string' && user.email.toLowerCase() === key.toLowerCase()) ||
                    (typeof user.phone === 'string' && normalizePhone(user.phone) === phone))
        );
        return found?.id ?? null;
    }

    async findGroup(name: string): Promise<DirectoryGroup | null> {
        const group = this.groups.get(name);
        return group ? this.groupRow(group) : null;
    }

    async members(groupId: string, cursor: string | undefined): Promise<{ ids: string[]; next?: string }> {
        const group = this.byId(groupId);
        const all = group ? [...this.flat(group.name)] : [];
        const start = cursor === undefined ? 0 : Number(cursor);
        const next = start + PAGE;
        return { ids: all.slice(start, next), ...(next < all.length ? { next: String(next) } : {}) };
    }

    async isMember(userId: string, groupId: string): Promise<boolean> {
        const group = this.byId(groupId);
        return group !== undefined && this.flat(group.name).has(userId);
    }

    async groupsOf(userId: string): Promise<DirectoryGroup[]> {
        return [...this.groups.values()].filter(group => this.flat(group.name).has(userId)).map(group => this.groupRow(group));
    }

    async callRoute(name: string, userId: string, context: RouteContext): Promise<string[]> {
        const route = this.config.routes.find(candidate => candidate.name === name);
        if (!route) throw new PortError('eval.hostFunctionMissing', `the route "${name}" is not in the directory`);
        let program = this.routePrograms.get(name);
        if (!program) {
            this.routeMinab ??= createMinab({
                schema: { tables: [], directory: this.schema() },
                functions: this.functions().declarations,
                ruleContext: { isFieldRule: false, specialUsers: [{ name: 'routeUser', type: 'USER' }], groupNames: this.groupNames },
                mode: 'production'
            });
            program = this.routeMinab.prepare(`let u: USER = @routeUser;\n${route.body}`);
            this.routePrograms.set(name, program);
        }
        const prepared = await program;
        if (!prepared.ok)
            throw new PortError(
                'eval.failed',
                `the route "${name}" has an error: ${prepared.diagnostics.find(d => d.severity === 'error')?.message ?? 'unknown'}`
            );
        // The routes inside this body are one level deeper (P7: at most 3 nested calls).
        const result = await prepared.run(
            { specialUsers: { routeUser: userId } },
            { directory: this, hostFunctions: this.functions({ routeDepth: context.depth + 1 }).functions },
            { signal: context.signal }
        );
        if (!result.ok) throw new PortError(result.error.code, result.error.message);
        const value = result.value;
        const rows = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
        return rows.map(row => String((row as { id: unknown }).id));
    }

    /** Frees the Minab runtime that runs route bodies. */
    close(): void {
        this.routeMinab?.dispose();
        this.routeMinab = undefined;
        this.routePrograms.clear();
    }
}
