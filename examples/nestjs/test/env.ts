import { DEFAULT_DATABASE_URL } from '../src/data-source';

// Set before the app module is loaded: the module reads DATABASE_URL when it is imported.
process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
