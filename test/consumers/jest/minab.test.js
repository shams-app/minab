// A Jest test in a CommonJS project, with the default Jest config (no ESM flags, no transform).
const { createMinab } = require('@shamsine/minab');
const { queryFunctionDataPort } = require('@shamsine/minab/node');

const scalar = base => ({ kind: 'scalar', type: { kind: 'scalar', base, nullable: false, array: false, arrayNullable: false } });
const schema = {
    version: 'v1',
    tables: [
        {
            name: 'Order',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID') },
                { name: 'total', type: scalar('DECIMAL') }
            ]
        }
    ]
};

test('prepares and runs a rule', async () => {
    const minab = createMinab({ schema, ruleContext: { recordTable: 'Order', isFieldRule: false } });
    const rule = await minab.prepare('.total > 10');
    expect(rule.ok).toBe(true);
    expect(await rule.run({ record: { total: 25 } })).toMatchObject({ ok: true, value: true });
    expect(await rule.run({ record: { total: 5 } })).toMatchObject({ ok: true, value: false });
});

test('runs a rule that reads data through the node adapter', async () => {
    const minab = createMinab({ schema, ruleContext: { recordTable: 'Order', isFieldRule: false } });
    const rule = await minab.prepare('EXISTS(#Order[.id == ^.id])');
    const data = queryFunctionDataPort(async () => [{ value: true }]);
    expect(await rule.run({ record: { id: 'o-1' } }, { data })).toMatchObject({ ok: true, value: true });
});
