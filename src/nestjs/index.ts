/**
 * The entry `@shamsine/minab/nestjs` (phase H2): the NestJS module, service, exception filter,
 * logger adapter and the optional run endpoint. It needs `@nestjs/common`, `@nestjs/core`,
 * `rxjs` and `reflect-metadata` from the host.
 */

export { MinabModule } from './module.js';
export type { MinabModuleAsyncOptions } from './module.js';
export { MinabService } from './service.js';
export type { LoadedProgram, MinabLoadOptions, MinabRunOptions } from './service.js';
export { MinabException, minabHttpStatus } from './exception.js';
export { MinabExceptionFilter, minabErrorBody } from './filter.js';
export { MinabLogger, logsEnabled, oneLine } from './logger.js';
export type { MinabLoggerTags } from './logger.js';
export { MinabRunController } from './controller.js';
export { MINAB_OPTIONS } from './options.js';
export type { MinabContext, MinabEndpointOptions, MinabLogOptions, MinabModuleOptions, ProgramStore, StoredProgram, VersionedSchema } from './options.js';
