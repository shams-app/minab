/**
 * The policy compiler (MN.3, proposal P4 and P12): a program written in the policy profile becomes the policy IR v1 that
 * the Shamsine engine evaluates (`schemas/policy-ir.v1.json`; Shamsine's `packages/authz/contract` owns the schema).
 *
 * One walk does two jobs. `checkPolicyProfile` (used by `prepare`) walks with no directory and reports every part the
 * profile does not allow. `compilePolicy` walks again with the directory port, resolves `@@Name`, `findGroup('…')` and
 * `findUser('…')` to ids, and builds the IR. A node the walk does not know is refused, never guessed.
 */

import type { AstNode } from 'langium';
import type { MinabDiagnostic, SourceRange } from '../runtime/types.js';
import { coded, type DiagnosticCode } from '../language/diagnostics/codes.js';
import { parseDate } from '../language/dates.js';
import {
    isBinaryExpression,
    isBooleanLiteral,
    isCallExpression,
    isCastExpr,
    isCurrentRecord,
    isFilterAccess,
    isGroupRef,
    isListLiteral,
    isMemberAccess,
    isNameRef,
    isNullLiteral,
    isNumberLiteral,
    isSpecialUserRef,
    isStringLiteral,
    isTypeTestExpression,
    isUnaryExpression,
    type CallExpression,
    type Expression,
    type MemberAccess
} from '../language/generated/ast.js';
import { isUser, type MinabType } from '../language/minab-types.js';
import type { PolicyOptions } from './profile.js';
import { POLICY_FUNCTIONS, POLICY_REQUEST_KEYS, POLICY_SYSTEM_GROUPS, ROUTE_USER, MAX_ROUTE_NESTING, closestKeys } from './profile.js';

// ---- the IR (a copy of the types of `packages/authz/contract/src/ir.ts`) ----------------------------------------------

/** The type of a literal in the IR. */
export type IrType = 'TEXT' | 'CITEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'TIME' | 'DATETIME' | 'UUID' | 'USER' | 'JSON';
/** A JSON value (a literal of the IR). */
export type IrJson = string | number | boolean | null | IrJson[] | { [key: string]: IrJson };
/** The comparisons of a `cmp` node. */
export type IrComparison = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'like' | 'in';
/** The built-in functions of a `fn` node (`DATE` is `CAST(… AS DATE)`). */
export type IrFunction = 'NOW' | 'LOWER' | 'UPPER' | 'YEAR' | 'MONTH' | 'DAY' | 'DATE';

/** A set of users: who a statement is for, or what a filter or `member` reads. */
export type IrSet =
    | { k: 'everyone' }
    | { k: 'user'; id: string }
    | { k: 'group'; id: string }
    | { k: 'system'; name: 'owners' | 'admins' | 'members' | 'operators' | 'viewers' | 'applications' }
    | { k: 'union' | 'inter'; of: IrSet[] }
    | { k: 'diff' | 'xor'; a: IrSet; b: IrSet }
    | { k: 'filter'; set: IrSet; where: IrBool }
    | { k: 'groupsOf'; user: IrUser; where?: IrBool }
    | { k: 'route'; name: string; arg: IrUser }
    | { k: 'one'; user: IrUser };

/** One user (or none): a special user, an id, a field of the record, an attribute, a route, or the one user of a set. */
export type IrUser =
    | { special: 'currentUser' | 'appUser' }
    | { id: string }
    | { res: string[] }
    | { attr: string; of: IrUser }
    | { k: 'route'; name: string; arg: IrUser }
    | { k: 'single'; set: IrSet; orNull: boolean };

/** A condition. */
export type IrBool =
    | { op: 'and' | 'or'; of: IrBool[] }
    | { op: 'not'; x: IrBool }
    | { op: 'const'; value: boolean }
    | { op: 'cmp'; cmp: IrComparison; l: IrVal; r: IrVal }
    | { op: 'member'; user: IrUser; set: IrSet }
    | { op: 'isNull'; x: IrVal };

/** A value in a condition: a typed literal, a field, a request value, a tag, or a function of values. */
export type IrVal =
    | { lit: IrJson; t: IrType }
    | { res: string[] }
    | { new: string[] }
    | { prin: string[] }
    | { req: 'time' | 'ip' | 'mfa' | 'clientId' | 'tagKey' }
    | { tag: string }
    | { fn: IrFunction; args: IrVal[] };

/** One statement's compiled principal or condition. */
export interface PolicyIr {
    v: 1;
    principal?: IrSet;
    notPrincipal?: IrSet;
    condition?: IrBool;
}

/** What the program names: the ids of its groups, the user attributes it reads, its routes and its tag keys. Each list is sorted. */
export interface PolicyReads {
    groups: string[];
    attributes: string[];
    routes: string[];
    tags: string[];
}

// ---- the walk --------------------------------------------------------------------------------------------------------

/** Answers the walk needs from the directory. The check walk gives placeholders, the compile walk asks the port. */
export interface PolicyResolver {
    user(key: string): Promise<string | null>;
    group(name: string): Promise<string | null>;
}

/** The type of a node, from the checker. */
export type TypeOf = (node: Expression) => MinabType | undefined;

/** A refusal that was already reported: the walk stops this branch and goes on with the next one. */
class Refused extends Error {}

/** A failure the host must see as an error of `compilePolicy`: a user or a group that does not exist. */
export class ResolveFailure extends Error {
    constructor(
        readonly code: DiagnosticCode,
        readonly range: SourceRange | undefined,
        readonly params: Record<string, string | number> = {}
    ) {
        super(code);
    }
}

type Scope = 'record' | 'user' | 'group';

/** A source span of a `findUser` key that the host stores as the user's id. */
export interface Pin {
    start: number;
    end: number;
    text: string;
}

export interface WalkResult {
    ir: PolicyIr | undefined;
    diagnostics: MinabDiagnostic[];
    reads: PolicyReads;
    pins: Pin[];
}

const SYSTEM_NAMES: ReadonlySet<string> = new Set(POLICY_SYSTEM_GROUPS);

function rangeOf(node: AstNode): SourceRange {
    return node.$cstNode?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

/** What a node is called in a message. Never the program's own values. */
function describe(node: AstNode): string {
    if (isCallExpression(node) && isNameRef(node.callee)) return `the function "${node.callee.name}"`;
    if (isNameRef(node)) return `the name "${node.name}"`;
    switch (node.$type) {
        case 'Query':
            return 'a FROM query';
        case 'Subquery':
            return 'a subquery';
        case 'NamedScope':
            return 'a #Table name';
        case 'LoopStatement':
            return 'a loop';
        case 'FunctionDecl':
            return 'a function declaration';
        case 'VariableDecl':
            return 'a "let" declaration';
        case 'InsertStatement':
        case 'UpdateStatement':
        case 'DeleteStatement':
            return 'a write';
        case 'AssignmentStatement':
            return 'an assignment';
        case 'CallStatement':
            return 'a call statement';
        case 'IfExpr':
        case 'IfStatement':
            return 'an "if"';
        case 'SwitchExpr':
            return 'a "switch"';
        case 'JsonObjectLiteral':
            return 'a JSON object';
        case 'ParentRecord':
            return 'the parent record "^"';
        case 'FieldValue':
            return 'the field value "$"';
        case 'TupleLiteral':
        case 'TupleAccess':
            return 'a tuple';
        case 'GroupKeyRef':
        case 'IndexRef':
            return 'a group key or index';
        case 'CastExpr':
            return 'a CAST other than CAST(… AS DATE)';
        case 'BinaryExpression':
            return `the operator "${(node as { operator?: string }).operator ?? ''}" here`;
        case 'UnaryExpression':
            return `the operator "${(node as { operator?: string }).operator ?? 'NOT'}" here`;
        default:
            return `a ${node.$type}`;
    }
}

export class PolicyWalker {
    readonly diagnostics: MinabDiagnostic[] = [];
    readonly pins: Pin[] = [];
    private readonly groups = new Set<string>();
    private readonly attributes = new Set<string>();
    private readonly routes = new Set<string>();
    private readonly tags = new Set<string>();

    constructor(
        private readonly typeOf: TypeOf,
        private readonly options: PolicyOptions,
        private readonly resolver: PolicyResolver,
        /** `true` for a route body: `u` is the one user, and the special users are not there. */
        private readonly route: boolean,
        /** The number of characters the runtime put in front of the source (the `let u` line of a route). */
        private readonly prefixLength: number
    ) {}

    get reads(): PolicyReads {
        const sorted = (items: Set<string>) => [...items].sort();
        return { groups: sorted(this.groups), attributes: sorted(this.attributes), routes: sorted(this.routes), tags: sorted(this.tags) };
    }

    // ---- reports -----------------------------------------------------------------------------------------------

    private report(code: DiagnosticCode, node: AstNode, params: Record<string, string | number>): void {
        const message = (
            coded as (code: DiagnosticCode, params: Record<string, string | number>) => { reason: string; params: Record<string, string | number> }
        )(code, params);
        const severity = code === 'policy.unknownTagKey' ? 'warning' : 'error';
        this.diagnostics.push({ severity, code, message: message.reason, range: rangeOf(node), params: message.params });
    }

    /** Reports a part the profile does not allow and stops this branch. */
    private refuse(node: AstNode, what: string = describe(node)): never {
        this.report('policy.constructNotAllowed', node, { construct: what });
        throw new Refused();
    }

    /** Runs each part, so that one refusal does not hide the next. */
    private all<T>(nodes: readonly AstNode[], work: (node: AstNode) => Promise<T>): Promise<T[]> {
        return (async () => {
            const done: T[] = [];
            let refused = false;
            for (const node of nodes) {
                try {
                    done.push(await work(node));
                } catch (e) {
                    if (!(e instanceof Refused)) throw e;
                    refused = true;
                }
            }
            if (refused) throw new Refused();
            return done;
        })();
    }

    private type(node: Expression): MinabType | undefined {
        return this.typeOf(node);
    }

    // ---- entry -------------------------------------------------------------------------------------------------

    /** Walks the whole program: `kind` says what it must become. The walk never throws for a refused part. */
    async walk(declarations: readonly AstNode[], tail: AstNode | undefined, kind: 'condition' | 'principal'): Promise<PolicyIr | undefined> {
        let first = true;
        for (const declaration of declarations) {
            // The one declaration the runtime adds to a route body: `let u: USER = @routeUser;`.
            if (this.route && first && declaration.$type === 'VariableDecl') {
                first = false;
                continue;
            }
            first = false;
            this.report('policy.constructNotAllowed', declaration, { construct: describe(declaration) });
        }
        if (!tail) {
            if (declarations.length === 0) this.report('policy.constructNotAllowed', { $type: 'Model' } as AstNode, { construct: 'an empty program' });
            return undefined;
        }
        if (tail.$type === 'Query') {
            this.report('policy.constructNotAllowed', tail, { construct: describe(tail) });
            return undefined;
        }
        try {
            const expression = tail as Expression;
            if (kind === 'condition') return { v: 1, condition: await this.bool(expression, 'record', 0) };
            return { v: 1, principal: await this.set(expression, 'record', 0) };
        } catch (e) {
            if (e instanceof Refused) return undefined;
            throw e;
        }
    }

    // ---- booleans ----------------------------------------------------------------------------------------------

    private async bool(node: Expression, scope: Scope, depth: number): Promise<IrBool> {
        if (isBooleanLiteral(node)) return { op: 'const', value: node.value === 'true' || (node.value as unknown) === true };
        if (isUnaryExpression(node) && node.negated) {
            const x = await this.bool(node.operand, scope, depth);
            return x.op === 'const' ? { op: 'const', value: !x.value } : { op: 'not', x };
        }
        if (isBinaryExpression(node)) {
            const { operator } = node;
            if (operator === 'AND' || operator === 'OR') {
                const parts = await this.all([node.left, node.right], part => this.bool(part as Expression, scope, depth));
                return this.logic(operator === 'AND' ? 'and' : 'or', parts);
            }
            if (operator === 'IN') return await this.membership(node.left, node.right, scope, depth);
            if (operator === 'LIKE') return await this.compare('like', node.left, node.right, scope, depth);
            const cmp = { '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' }[operator];
            if (cmp) {
                const left = this.type(node.left);
                const right = this.type(node.right);
                if ((left && isUser(left)) || (right && isUser(right))) return await this.userEquality(node, cmp === 'ne', scope, depth);
                return await this.compare(cmp as IrComparison, node.left, node.right, scope, depth);
            }
            return this.refuse(node);
        }
        if (isTypeTestExpression(node)) {
            if (!isNullLiteral(node.test)) return this.refuse(node, 'a type test other than "is null"');
            const x = await this.val(node.value, scope, depth);
            return node.operator === 'isnot' ? { op: 'not', x: { op: 'isNull', x } } : { op: 'isNull', x };
        }
        // A value that is a boolean (`request.mfa`, a boolean field): it is true.
        const value = await this.val(node, scope, depth);
        return { op: 'cmp', cmp: 'eq', l: value, r: { lit: true, t: 'BOOLEAN' } };
    }

    private logic(op: 'and' | 'or', parts: IrBool[]): IrBool {
        const neutral = op === 'and';
        const kept: IrBool[] = [];
        for (const part of parts) {
            if (part.op === 'const') {
                if (part.value !== neutral) return part;
                continue;
            }
            // `a AND (b AND c)` is one list.
            if (part.op === op) kept.push(...part.of);
            else kept.push(part);
        }
        if (kept.length === 0) return { op: 'const', value: neutral };
        return kept.length === 1 ? kept[0] : { op, of: kept };
    }

    private async compare(cmp: IrComparison, left: Expression, right: Expression, scope: Scope, depth: number): Promise<IrBool> {
        const [l, r] = await this.all([left, right], side => this.val(side as Expression, scope, depth));
        // A text literal that meets a case-insensitive text (CITEXT) is typed CITEXT, so the engine compares it like Minab does.
        const insensitive = (node: Expression) => {
            const type = this.type(node);
            return type?.kind === 'scalar' && type.base === 'CITEXT';
        };
        const tag = (value: IrVal, other: Expression): IrVal =>
            insensitive(other) && 'lit' in value && value.t === 'TEXT' ? { ...value, t: 'CITEXT' } : value;
        return { op: 'cmp', cmp, l: tag(l, right), r: tag(r, left) };
    }

    /** `==` and `!=` with a user on one side (P1: a user is compared only with a user). */
    private async userEquality(node: Expression & { left: Expression; right: Expression }, negate: boolean, scope: Scope, depth: number): Promise<IrBool> {
        const lv = this.userVal(node.left, scope);
        const rv = this.userVal(node.right, scope);
        let result: IrBool;
        if (lv && rv) {
            const [l, r] = await this.all([node.left, node.right], side => this.val(side as Expression, scope, depth));
            result = { op: 'cmp', cmp: 'eq', l, r };
        } else {
            // One side has no value form (`@appUser`, a route, `single(…)`): the left user is a member of the set of the right one.
            const [user, set] = await this.all([node.left, node.right], async side =>
                side === node.left ? await this.user(side as Expression, scope, depth) : await this.set(side as Expression, scope, depth)
            );
            result = { op: 'member', user: user as IrUser, set: set as IrSet };
        }
        return negate ? { op: 'not', x: result } : result;
    }

    private async membership(left: Expression, right: Expression, scope: Scope, depth: number): Promise<IrBool> {
        const type = this.type(left);
        if (type && isUser(type)) {
            const [user, set] = await this.all([left, right], async side =>
                side === left ? await this.user(side as Expression, scope, depth) : await this.set(side as Expression, scope, depth)
            );
            return { op: 'member', user: user as IrUser, set: set as IrSet };
        }
        return await this.compare('in', left, right, scope, depth);
    }

    // ---- values ------------------------------------------------------------------------------------------------

    /** The value form of a user (an id), or `undefined` when the user can only be written as a user. */
    private userVal(node: Expression, scope: Scope): boolean {
        if (isSpecialUserRef(node)) return node.name === 'currentUser' && !this.route;
        if (isNameRef(node)) return this.route && node.name === ROUTE_USER;
        if (isCurrentRecord(node)) return node.field !== undefined;
        if (isMemberAccess(node)) {
            if (node.member === 'id') return this.userVal(node.receiver, scope);
            return this.isRecordPath(node) || this.isNewPath(node);
        }
        return isCallExpression(node) && isNameRef(node.callee) && node.callee.name === 'findUser';
    }

    private isRecordPath(node: Expression): boolean {
        return (isCurrentRecord(node) && node.field !== undefined) || (isMemberAccess(node) && this.isRecordPath(node.receiver));
    }

    private isNewPath(node: Expression): boolean {
        return isMemberAccess(node) && (isNameRef(node.receiver) ? node.receiver.name === 'new' : this.isNewPath(node.receiver));
    }

    private pathOf(node: Expression): string[] | undefined {
        if (isCurrentRecord(node)) return node.field !== undefined && !node.vivify ? [node.field] : undefined;
        if (isMemberAccess(node) && !node.vivify) {
            const head = this.pathOf(node.receiver);
            return head && [...head, node.member];
        }
        return undefined;
    }

    private recordPath(node: Expression, scope: Scope): IrVal {
        const path = this.pathOf(node);
        if (!path) return this.refuse(node, 'the whole record "."');
        if (path.length > 8) return this.refuse(node, 'a field path longer than 8 names');
        if (scope === 'user') this.attributes.add(path[0]);
        return scope === 'user' ? { prin: path } : { res: path };
    }

    private async val(node: Expression, scope: Scope, depth: number): Promise<IrVal> {
        if (isStringLiteral(node)) return { lit: node.value, t: 'TEXT' };
        if (isBooleanLiteral(node)) return { lit: node.value === 'true' || (node.value as unknown) === true, t: 'BOOLEAN' };
        if (isNumberLiteral(node)) return this.number(node, false);
        if (isUnaryExpression(node) && node.operator === '-' && isNumberLiteral(node.operand)) return this.number(node.operand, true);
        if (isNullLiteral(node)) return this.refuse(node, 'null outside "is null"');
        if (isListLiteral(node)) {
            const items = await this.all(node.items, async item => await this.val(item as Expression, scope, depth));
            const literals = items.map(item => ('lit' in item ? item.lit : undefined));
            if (literals.some(item => item === undefined)) return this.refuse(node, 'a list that is not made of literals');
            return { lit: literals as IrJson[], t: 'JSON' };
        }
        if (isCurrentRecord(node)) return this.recordPath(node, scope);
        if (isNameRef(node)) {
            if (this.route && node.name === ROUTE_USER) return { prin: ['id'] };
            return this.refuse(node);
        }
        if (isSpecialUserRef(node)) {
            if (this.route || node.name !== 'currentUser')
                return this.refuse(node, `the special user "@${node.name}" as a value (use it in a set or after IN)`);
            return { prin: ['id'] };
        }
        if (isMemberAccess(node)) return await this.memberVal(node, scope, depth);
        if (isCastExpr(node)) {
            if (node.targetType.base !== 'DATE' || node.targetType.array) return this.refuse(node);
            if (isStringLiteral(node.value)) {
                try {
                    parseDate(node.value.value);
                } catch {
                    return this.refuse(node, 'a CAST to DATE of a text that is not a date');
                }
                return { lit: node.value.value, t: 'DATE' };
            }
            return { fn: 'DATE', args: [await this.val(node.value, scope, depth)] };
        }
        if (isCallExpression(node)) return await this.callVal(node, scope, depth);
        return this.refuse(node);
    }

    private number(node: { value: number; $cstNode?: { text: string } }, negative: boolean): IrVal {
        const text = node.$cstNode?.text ?? String(node.value);
        if (/^[0-9]+$/.test(text) && Number.isSafeInteger(Number(text))) return { lit: negative ? -Number(text) : Number(text), t: 'INTEGER' };
        // A decimal is kept as its own text, so no digit is lost (the engine reads it exactly).
        return { lit: negative ? `-${text}` : text, t: 'DECIMAL' };
    }

    private async memberVal(node: MemberAccess, scope: Scope, depth: number): Promise<IrVal> {
        const receiver = node.receiver;
        if (node.vivify) return this.refuse(node, 'the vivify mark "!"');
        if (isNameRef(receiver) && receiver.name === 'request') {
            if (!(POLICY_REQUEST_KEYS as readonly string[]).includes(node.member)) return this.refuse(node, `request.${node.member}`);
            return { req: node.member as 'time' };
        }
        if (isMemberAccess(receiver) && receiver.member === 'tags' && isNameRef(receiver.receiver) && receiver.receiver.name === 'resource') {
            this.tags.add(node.member);
            const known = this.options.tagKeys;
            if (known && !known.includes(node.member)) {
                this.report('policy.unknownTagKey', node, {
                    key: node.member,
                    suggestions: closestKeys(node.member, known)
                        .map(key => `"${key}"`)
                        .join(', ')
                });
            }
            return { tag: node.member };
        }
        if (this.isNewPath(node)) {
            const path = this.newPath(node);
            return path ? { new: path } : this.refuse(node);
        }
        if (isSpecialUserRef(receiver)) {
            if (this.route || receiver.name !== 'currentUser') return this.refuse(node, `an attribute of "@${receiver.name}"`);
            this.attributes.add(node.member);
            return { prin: [node.member] };
        }
        // `.owner.id` is the id the column holds.
        const type = this.type(receiver);
        if (type && isUser(type)) {
            if (node.member === 'id') return await this.val(receiver, scope, depth);
            return this.refuse(node, 'an attribute of another user');
        }
        const path = this.pathOf(node);
        if (path && this.isRecordPath(node)) {
            return this.recordPath(node, scope);
        }
        return this.refuse(node);
    }

    private newPath(node: Expression): string[] | undefined {
        if (isMemberAccess(node)) {
            if (isNameRef(node.receiver)) return node.receiver.name === 'new' ? [node.member] : undefined;
            const head = this.newPath(node.receiver);
            return head && [...head, node.member];
        }
        return undefined;
    }

    private async callVal(node: CallExpression, scope: Scope, depth: number): Promise<IrVal> {
        const name = isNameRef(node.callee) ? node.callee.name : undefined;
        if (name === 'findUser') {
            const id = await this.findUser(node);
            return { lit: id, t: 'USER' };
        }
        if (name && (POLICY_FUNCTIONS as readonly string[]).includes(name)) {
            const args = await this.all(node.args, async arg => await this.val(arg as Expression, scope, depth));
            return { fn: name as 'NOW', args };
        }
        return this.refuse(node);
    }

    // ---- users -------------------------------------------------------------------------------------------------

    private async user(node: Expression, scope: Scope, depth: number): Promise<IrUser> {
        if (isSpecialUserRef(node)) {
            if (this.route || (node.name !== 'currentUser' && node.name !== 'appUser')) return this.refuse(node, `the special user "@${node.name}"`);
            return { special: node.name };
        }
        if (isNameRef(node) && this.route && node.name === ROUTE_USER) return { special: 'currentUser' };
        if (isCurrentRecord(node) || isMemberAccess(node)) {
            if (isMemberAccess(node)) {
                const receiverType = this.type(node.receiver);
                if (receiverType && isUser(receiverType)) {
                    if (node.member === 'id') return await this.user(node.receiver, scope, depth);
                    // A user-typed attribute of a user.
                    this.attributes.add(node.member);
                    return { attr: node.member, of: await this.user(node.receiver, scope, depth) };
                }
            }
            const path = this.pathOf(node);
            if (path && scope !== 'user') return { res: path };
            return this.refuse(node, 'a user read from a record here');
        }
        if (isCallExpression(node) && isNameRef(node.callee)) {
            const name = node.callee.name;
            if (name === 'findUser') return { id: await this.findUser(node) };
            if (name === 'single' || name === 'singleOrNull') {
                const [set] = node.args;
                if (node.args.length !== 1) return this.refuse(node);
                return { k: 'single', set: await this.set(set, scope, depth), orNull: name === 'singleOrNull' };
            }
            if (this.isRoute(name)) return { k: 'route', name, arg: await this.routeArg(node, scope, depth) };
        }
        return this.refuse(node);
    }

    private isRoute(name: string): boolean {
        return (this.options.routes ?? []).some(route => route.name === name);
    }

    /** The one argument of a route call. Route calls inside the argument count one level deeper (P7). */
    private async routeArg(node: CallExpression, scope: Scope, depth: number): Promise<IrUser> {
        const name = isNameRef(node.callee) ? node.callee.name : '';
        if (depth >= MAX_ROUTE_NESTING) {
            this.report('policy.tooManySteps', node, { name, limit: MAX_ROUTE_NESTING });
            throw new Refused();
        }
        if (node.args.length !== 1) return this.refuse(node, `the route "${name}" with ${node.args.length} arguments`);
        this.routes.add(name);
        return await this.user(node.args[0], scope, depth + 1);
    }

    /** `findUser('key')`: the key must be a literal. The user's id is asked of the directory. */
    private async findUser(node: CallExpression): Promise<string> {
        const [key] = node.args;
        if (node.args.length !== 1 || !isStringLiteral(key)) return this.refuse(node, 'findUser with a key that is not a literal');
        const id = await this.resolver.user(key.value);
        if (id === null) throw new ResolveFailure('eval.userNotFound', rangeOf(node));
        // The host stores the id, not the typed e-mail or phone (P4).
        const cst = key.$cstNode;
        if (cst && id !== key.value) {
            const quote = cst.text[0] === '"' ? '"' : "'";
            this.pins.push({ start: cst.offset - this.prefixLength, end: cst.end - this.prefixLength, text: `${quote}${id}${quote}` });
        }
        return id;
    }

    // ---- sets --------------------------------------------------------------------------------------------------

    private async set(node: Expression, scope: Scope, depth: number): Promise<IrSet> {
        const type = this.type(node);
        // A single user is a set of one.
        if (type && isUser(type) && !(isCallExpression(node) && isNameRef(node.callee) && node.callee.name === 'findUser')) {
            return { k: 'one', user: await this.user(node, scope, depth) };
        }
        if (isGroupRef(node)) return await this.groupByName(node, node.name);
        if (isUnaryExpression(node) && node.operator === '!') return { k: 'diff', a: { k: 'everyone' }, b: await this.set(node.operand, scope, depth) };
        if (isBinaryExpression(node)) {
            const op = { '+': 'union', '&': 'inter', '-': 'diff', '|': 'xor' }[node.operator];
            if (!op) return this.refuse(node);
            const [a, b] = await this.all([node.left, node.right], async side => await this.set(side as Expression, scope, depth));
            if (op === 'diff' || op === 'xor') return { k: op, a, b };
            const parts = (side: IrSet): IrSet[] => (side.k === 'union' || side.k === 'inter' ? (side.k === op ? side.of : [side]) : [side]);
            return { k: op as 'union' | 'inter', of: [...parts(a), ...parts(b)] };
        }
        if (isFilterAccess(node)) {
            const set = await this.set(node.receiver, scope, depth);
            return { k: 'filter', set, where: await this.bool(node.filter, 'user', depth) };
        }
        if (isMemberAccess(node) && node.member === 'members') return await this.groupsOf(node, scope, depth);
        if (isCallExpression(node) && isNameRef(node.callee)) {
            const name = node.callee.name;
            if (name === 'findUser') return { k: 'user', id: await this.findUser(node) };
            if (name === 'findGroup') {
                const [key] = node.args;
                if (node.args.length !== 1 || !isStringLiteral(key)) return this.refuse(node, 'findGroup with a name that is not a literal');
                return await this.groupByName(node, key.value);
            }
            if (this.isRoute(name)) return { k: 'route', name, arg: await this.routeArg(node, scope, depth) };
        }
        return this.refuse(node);
    }

    private async groupByName(node: AstNode, name: string): Promise<IrSet> {
        if (name === 'everyone') return { k: 'everyone' };
        if (SYSTEM_NAMES.has(name)) return { k: 'system', name: name as 'owners' };
        const id = await this.resolver.group(name);
        if (id === null) throw new ResolveFailure('eval.groupNotFound', rangeOf(node), { name });
        this.groups.add(id);
        return { k: 'group', id };
    }

    /** `groupsOf(user).members` and `groupsOf(user)[condition].members`: the members of the groups the user is in. */
    private async groupsOf(node: MemberAccess, scope: Scope, depth: number): Promise<IrSet> {
        const source = node.receiver;
        const call = isFilterAccess(source) ? source.receiver : source;
        if (!(isCallExpression(call) && isNameRef(call.callee) && call.callee.name === 'groupsOf' && call.args.length === 1)) return this.refuse(node);
        const user = await this.user(call.args[0], scope, depth);
        if (!isFilterAccess(source)) return { k: 'groupsOf', user };
        return { k: 'groupsOf', user, where: await this.bool(source.filter, 'group', depth) };
    }
}

// ---- entry points ----------------------------------------------------------------------------------------------------

/** What `prepare` keeps of a program written in the policy profile. */
export interface PolicyProgram {
    declarations: readonly AstNode[];
    tail: AstNode | undefined;
    typeOf: TypeOf;
    options: PolicyOptions;
    /** `boolean`: a condition. `principal`: a set of users. `route`: the body of a route (a set, or one user). */
    kind: 'boolean' | 'principal' | 'route';
    /** The source text the host gave (without the line the runtime adds to a route body). */
    source: string;
    /** The characters the runtime put in front of the source. */
    prefixLength: number;
    /** The lines the runtime put in front of the source. */
    prefixLines: number;
}

/** A range in the source the host gave: the runtime put `lines` lines in front of a route body. */
export function shifted(range: SourceRange, lines: number): SourceRange {
    const line = (value: number) => Math.max(0, value - lines);
    return { start: { line: line(range.start.line), character: range.start.character }, end: { line: line(range.end.line), character: range.end.character } };
}

function walker(program: PolicyProgram, resolver: PolicyResolver): PolicyWalker {
    return new PolicyWalker(program.typeOf, program.options, resolver, program.kind === 'route', program.prefixLength);
}

/** The diagnostics of the profile: every part it does not allow, too many nested routes, an unknown tag key. No directory is asked. */
export async function checkPolicyProfile(program: PolicyProgram): Promise<MinabDiagnostic[]> {
    const placeholder: PolicyResolver = { user: async () => 'usr_check', group: async () => 'grp_check' };
    const w = walker(program, placeholder);
    await w.walk(program.declarations, program.tail, program.kind === 'boolean' ? 'condition' : 'principal');
    return w.diagnostics;
}

export type CompilePolicyOutcome =
    | { ok: true; ir: PolicyIr; reads: PolicyReads; pinnedSource: string }
    | { ok: false; code: DiagnosticCode; message: string; range?: SourceRange; params: Record<string, string | number> };

/** The directory the compile walk asks. Without one, a program that names a group or a user by key cannot be compiled. */
export interface PolicyDirectory {
    findUser(key: string, signal: AbortSignal): Promise<string | null>;
    findGroup(name: string, signal: AbortSignal): Promise<string | null>;
}

class NoDirectory extends Error {}

/** Compiles the program to the IR. A user or group that does not exist is `eval.userNotFound` / `eval.groupNotFound`. */
export async function compilePolicyProgram(program: PolicyProgram, directory: PolicyDirectory | undefined, signal: AbortSignal): Promise<CompilePolicyOutcome> {
    const need = (): PolicyDirectory => {
        if (!directory) throw new NoDirectory();
        return directory;
    };
    const w = walker(program, { user: key => need().findUser(key, signal), group: name => need().findGroup(name, signal) });
    try {
        const ir = await w.walk(program.declarations, program.tail, program.kind === 'boolean' ? 'condition' : 'principal');
        const problem = w.diagnostics.find(d => d.severity === 'error');
        if (problem || !ir) {
            const d = problem ?? { code: 'policy.constructNotAllowed', message: 'the program has nothing to compile', range: undefined, params: {} };
            return {
                ok: false,
                code: d.code as DiagnosticCode,
                message: d.message,
                ...(d.range ? { range: shifted(d.range, program.prefixLines) } : {}),
                params: d.params
            };
        }
        let pinned = program.source;
        for (const pin of [...w.pins].sort((a, b) => b.start - a.start)) pinned = pinned.slice(0, pin.start) + pin.text + pinned.slice(pin.end);
        return { ok: true, ir, reads: w.reads, pinnedSource: pinned };
    } catch (e) {
        if (e instanceof ResolveFailure) {
            const message = (
                coded as (code: DiagnosticCode, params: Record<string, string | number>) => { reason: string; params: Record<string, string | number> }
            )(e.code, e.params);
            return {
                ok: false,
                code: e.code,
                message: message.reason,
                ...(e.range ? { range: shifted(e.range, program.prefixLines) } : {}),
                params: message.params
            };
        }
        if (e instanceof NoDirectory) {
            return {
                ok: false,
                code: 'eval.failed',
                message: 'this program names a group or a user by key, and compilePolicy got no directory port',
                params: { reason: 'no directory port' }
            };
        }
        throw e;
    }
}
