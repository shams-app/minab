/**
 * `@shamsine/minab/monaco`: Minab in a Monaco editor (production plan E5).
 * `registerMinab(monaco, { client })` is the one call. Monaco is passed in, never imported.
 */

export { registerMinab, toMonacoRange, DEFAULT_LANGUAGE_ID } from './register.js';
export { languageConfiguration, tokensProvider, TOKEN_SCOPES } from './language.js';
export type { MinabEditorClient, MinabRegistration, RegisterMinabOptions } from './types.js';
