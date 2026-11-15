/**
 * MN.5 (security plan): a program that only compares user ids runs in the browser worker. `@currentUser` crosses the
 * bridge as `specialUsers`, and the analysis calls such a program tier `local`. Anything that reads the directory
 * (a user column, a group, a function) stays tier `data`.
 */

import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, test } from 'vitest';
import { createWorkerMinab, type WorkerMinab } from '../../src/browser/index.js';
import { serveMinab } from '../../src/browser/worker.js';
import { USER_TABLE } from '../../src/language/minab-types.js';
import { scalarType } from '../../src/language/schema.js';

const schema = {
    tables: [
        {
            name: 'Task',
            columns: [
                { name: 'id', type: { kind: 'scalar' as const, type: scalarType('TEXT', { nullable: false }) } },
                { name: 'owner', type: { kind: 'ref' as const, table: USER_TABLE, nullable: true } },
                { name: 'assignees', type: { kind: 'collection' as const, table: USER_TABLE } }
            ]
        }
    ]
};
const ruleContext = {
    isFieldRule: false,
    recordTable: 'Task',
    specialUsers: [{ name: 'currentUser', type: 'USER' as const }]
};

const opened: { minab: WorkerMinab; close(): void }[] = [];

/** A runtime whose "worker" is the other end of a message channel in this thread. */
function setup() {
    const { port1, port2 } = new MessageChannel();
    const server = serveMinab(port2 as never);
    const minab = createWorkerMinab({ worker: () => port1 as never, schema, ruleContext });
    const close = () => {
        minab.dispose();
        server.close();
        port1.close();
        port2.close();
    };
    opened.push({ minab, close });
    return minab;
}

afterEach(() => {
    for (const item of opened.splice(0)) item.close();
});

describe('tier of user programs', () => {
    test.each(['.owner == @currentUser', '.owner != @currentUser', '@currentUser IN .assignees'])('%s is local', async source => {
        const program = await setup().prepare(source);
        expect(program.analysis).toMatchObject({ usesDirectory: false, tier: 'local' });
    });

    test.each(['@currentUser IN @@Sales', '@currentUser.email == "a@b.c"', '.owner.name == "Sara"', '.assignees == @currentUser'])(
        '%s still needs the directory',
        async source => {
            const program = await setup().prepare(source);
            expect(program.analysis).toMatchObject({ usesDirectory: true, tier: 'data' });
        }
    );
});

describe('run in the worker', () => {
    const record = { id: 't1', owner: 'usr_sara', assignees: ['usr_ali', 'usr_neda'] };

    test('the user comes over the bridge', async () => {
        const program = await setup().prepare('.owner == @currentUser');
        expect(await program.run({ record, specialUsers: { currentUser: 'usr_sara' } })).toMatchObject({ ok: true, value: true });
        expect(await program.run({ record, specialUsers: { currentUser: 'usr_ali' } })).toMatchObject({ ok: true, value: false });
    });

    test('a user in a set of users', async () => {
        const program = await setup().prepare('@currentUser IN .assignees');
        expect(await program.run({ record, specialUsers: { currentUser: 'usr_neda' } })).toMatchObject({ ok: true, value: true });
        expect(await program.run({ record, specialUsers: { currentUser: 'usr_sara' } })).toMatchObject({ ok: true, value: false });
    });

    test('a run with no user is a missing input, not a wrong answer', async () => {
        const program = await setup().prepare('.owner == @currentUser');
        expect(await program.run({ record })).toMatchObject({ ok: false, error: { code: 'eval.missingInput' } });
    });

    test('a special user that is not an id is refused', async () => {
        const program = await setup().prepare('.owner == @currentUser');
        const result = await program.run({ record, specialUsers: { currentUser: 5 as never } });
        expect(result.ok).toBe(false);
    });
});
