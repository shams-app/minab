/**
 * `MinabModule` (phase H2): `forRoot(options)` and `forRootAsync({ useFactory, inject })`.
 * It provides `MinabService` and the exception filter. It mounts the run endpoint only when
 * `endpoint` is set (`forRoot`) or `endpointPath` is given (`forRootAsync`: a route and its guards are fixed before the
 * factory runs, so `forRootAsync` takes them next to the factory, never from it).
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
    /** Guards of the run endpoint. Without one, anyone who can reach the route can run stored programs: use the app's guards. */
    guards?: MinabEndpointOptions['guards'];
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

    /**
     * Sets Minab up with options made by a factory. The run endpoint needs `endpointPath` and `guards` here, because a
     * route and its guards are fixed before the factory runs. `endpoint.path` or `endpoint.guards` in the factory's
     * options stop the app at startup: they would be ignored, and an ignored guard leaves the route open.
     */
    static forRootAsync(options: MinabModuleAsyncOptions): DynamicModule {
        if (options.guards !== undefined && options.endpointPath === undefined) {
            throw new Error(
                'MinabModule.forRootAsync: "guards" needs "endpointPath". Without a path there is no run endpoint, and the guards would guard nothing.'
            );
        }
        const provider: Provider = {
            provide: MINAB_OPTIONS,
            useFactory: async (...args: never[]) => checkAsyncOptions(await options.useFactory(...args)),
            inject: options.inject ?? []
        };
        return build([provider], options.imports ?? [], options.endpointPath, options.guards);
    }
}

/** Refuses the endpoint settings that `forRootAsync` cannot use from the factory. A guard is never ignored without a word. */
function checkAsyncOptions(options: MinabModuleOptions): MinabModuleOptions {
    const endpoint = options?.endpoint;
    if (endpoint?.guards !== undefined) {
        throw new Error(
            'MinabModule.forRootAsync: the factory returned "endpoint.guards". They would be ignored, because the guards of a route are fixed before the factory runs. Move them to "guards" in the forRootAsync options, next to "endpointPath".'
        );
    }
    if (endpoint?.path !== undefined) {
        throw new Error(
            'MinabModule.forRootAsync: the factory returned "endpoint.path". It would be ignored, because a route is fixed before the factory runs. Move it to "endpointPath" in the forRootAsync options, and put the guards next to it in "guards".'
        );
    }
    return options;
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
