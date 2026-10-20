// A CommonJS Node project: require the package and `./node`, prepare and run rules.
const assert = require('node:assert/strict');
const { createMinab, scalarType } = require('@shamsine/minab');
const { queryFunctionDataPort, systemClock } = require('@shamsine/minab/node');

(async () => {
    // `scalarType` builds the type of a scalar column, so a host does not write the object by hand.
    assert.deepEqual(scalarType('UUID'), { kind: 'scalar', base: 'UUID', nullable: false, array: false, arrayNullable: false });
    assert.deepEqual(scalarType('TEXT', { nullable: true, array: true }), { kind: 'scalar', base: 'TEXT', nullable: true, array: true, arrayNullable: false });
    const scalar = base => ({ kind: 'scalar', type: scalarType(base) });
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
    const minab = createMinab({ schema, ruleContext: { recordTable: 'Order', isFieldRule: false } });

    const rule = await minab.prepare('.total > 10');
    assert.equal(rule.ok, true);
    const pure = await rule.run({ record: { total: 25 } }, { clock: systemClock('Asia/Tehran') });
    assert.equal(pure.ok, true);
    assert.equal(pure.value, true);

    const calls = [];
    const data = queryFunctionDataPort(async (text, params) => {
        calls.push({ text, params });
        return [{ value: true }];
    });
    const exists = await minab.prepare('EXISTS(#Order[.id == ^.id])');
    const result = await exists.run({ record: { id: 'o-1' } }, { data });
    assert.equal(result.ok, true);
    assert.equal(result.value, true);
    assert.match(calls[0].text, /\$1/);
    console.log('cjs ok');
})().catch(e => {
    console.error(e);
    process.exit(1);
});
