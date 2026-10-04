// A NestJS CommonJS project: boot a module with MinabModule.forRoot, then run a stored program.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { MinabModule, MinabService, MinabException, minabHttpStatus } = require('@shamsine/minab/nestjs');

(async () => {
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
    const ruleContext = { recordTable: 'Order', isFieldRule: false };
    const programs = [{ id: 'big', version: '1', source: '.total > 10', languageVersion: '0.3', ruleContext }];

    class AppModule {}
    Module({
        imports: [
            MinabModule.forRoot({
                schemaLoader: () => schema,
                programStore: { get: async (id, version) => programs.find(p => p.id === id && p.version === version) },
                endpoint: { path: 'minab/run' }
            })
        ]
    })(AppModule);

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const service = app.get(MinabService);
    const result = await service.runStored('big', '1', { record: { total: 25 } });
    assert.equal(result.ok, true);
    assert.equal(result.value, true);

    const missing = await service.runStored('nope', '1').catch(e => e);
    assert.ok(missing instanceof MinabException);
    assert.equal(missing.error.code, 'wire.programNotFound');
    assert.equal(minabHttpStatus(missing.error.code), 404);

    await app.close();
    console.log('nest-cjs ok');
})().catch(e => {
    console.error(e);
    process.exit(1);
});
