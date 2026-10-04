// Type-checked with `moduleResolution: node` (the old style many NestJS projects use).
// That style ignores `exports`: it finds `@shamsine/minab/node` only through `typesVersions`.
// `skipLibCheck` is on, as in `nest new`: the `.d.ts` files of this package import `langium`,
// whose subpath types old resolution cannot find.
import { createMinab } from '@shamsine/minab';
import { pgDataPort, queryFunctionDataPort, systemClock } from '@shamsine/minab/node';
import type { DataPort, ClockPort } from '@shamsine/minab';

const data: DataPort = queryFunctionDataPort(async () => []);
const pg: DataPort = pgDataPort({ query: async () => ({ rows: [] }) });
const clock: ClockPort = systemClock('Asia/Tehran');
export const minab = createMinab({ schema: { tables: [] } });
export { data, pg, clock };
