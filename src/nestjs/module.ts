/**
 * `MinabModule` (phase H2): `forRoot(options)` and `forRootAsync({ useFactory, inject })`.
 * It provides `MinabService` and the exception filter. It mounts the run endpoint only when
 * `endpoint` is set (`forRoot`) or `endpointPath` is given (`forRootAsync`: a route is fixed before the factory runs).
 */

import { Module, type DynamicModule, type InjectionToken, type ModuleMetadata, type Provider } from '@nestjs/common';
import { createRunController } from './controller.js';
import { MinabExceptionFilter } from './filter.js';
import { MINAB_OPTIONS, type MinabEndpointOptions, type MinabModuleOptions } from './options.js';
import { MinabService } from './service.js';

const DEFAULT_PATH = 'minab/run';

/** Options of `MinabModule.forRootAsync`. The factory makes the module options, for example from the config service or a data source. */
export interface MinabModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
    /** Makes the module options. Its arguments are the providers named in `inject`. */
    useFactory: (...args: never[]) => MinabModuleOptions | Promise<MinabModuleOptions>;
    inject?: InjectionToken[];
    /** Mounts the run endpoint at this route. Its other settings (`allowSource`, `ports`, ...) are the `endpoint` of the factory's options. */
    endpointPath?: string;
}

@Module({})
export class MinabModule {
    /** Sets Minab up with options that are known now. */
    static forRoot(options: MinabModuleOptions): DynamicModule {
        return build(
            [{ provide: MINAB_OPTIONS, useValue: options }],
            [],
            options.endpoint ? (options.endpoint.path ?? DEFAULT_PATH) : undefined,
            options.endpoint?.guards
        );
    }

    /** Sets Minab up with options made by a factory. The run endpoint needs `endpointPath` here, because a route is fixed before the factory runs. */
    static forRootAsync(options: MinabModuleAsyncOptions): DynamicModule {
        const provider: Provider = { provide: MINAB_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] };
        return build([provider], options.imports ?? [], options.endpointPath);
    }
}

function build(
    providers: Provider[],
    imports: NonNullable<ModuleMetadata['imports']>,
    path: string | undefined,
    guards?: MinabEndpointOptions['guards']
): DynamicModule {
    return {
        module: MinabModule,
        global: true,
        imports,
        providers: [...providers, MinabService, MinabExceptionFilter],
        controllers: path === undefined ? [] : [createRunController(path, guards)],
        exports: [MinabService, MinabExceptionFilter, MINAB_OPTIONS]
    };
}
