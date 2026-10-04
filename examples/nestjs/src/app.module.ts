import { Module } from '@nestjs/common';
import { MinabModule } from '@shamsine/minab/nestjs';
import { queryFunctionDataPort } from '@shamsine/minab/node';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';
import { OrdersController } from './orders.controller';
import { DatabaseProgramStore } from './program-store';
import { ReportsController } from './reports.controller';
import { schema } from './schema';

/** The path of the run endpoint the browser example calls. */
export const RUN_PATH = 'minab/run';

@Module({
    imports: [
        TypeOrmModule.forRoot(dataSourceOptions()),
        MinabModule.forRootAsync({
            inject: [DataSource],
            endpointPath: RUN_PATH,
            useFactory: ((dataSource: DataSource) => ({
                schemaLoader: () => schema, // one schema for every request; with tenants, pick by the request
                ruleContext: { recordTable: 'Order', isFieldRule: false },
                // Statement lines have the SQL text, never the values. All logs are off when NODE_ENV is production (D37).
                logs: { statements: true },
                programStore: new DatabaseProgramStore(dataSource),
                // The server decides where the data comes from. The client never does.
                endpoint: { ports: () => ({ data: queryFunctionDataPort((text, params) => dataSource.query(text, params)) }) }
            })) as never
        })
    ],
    controllers: [OrdersController, ReportsController]
})
export class AppModule {}
