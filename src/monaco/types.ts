/**
 * The shapes of the Monaco integration. Monaco types come from `monaco-editor`
 * (an optional peer): they are only imported as types, so Minab never loads Monaco.
 */

import type * as Monaco from 'monaco-editor';
import type { CompletionResult, DirectoryName, EditorHints, HoverResult, PinnedUser, SignatureHelpResult, UserLabel } from '../editor/types.js';
import type { MinabRuleContext } from '../language/schema.js';
import type { PrepareOptions, PreparedProgram } from '../runtime/types.js';

/**
 * What `registerMinab` needs from the runtime: a `WorkerMinab` from `createWorkerMinab` (`@shamsine/minab/browser`).
 * Only the diagnostics of the prepared program are read, and it is released after each check.
 */
export interface MinabEditorClient {
    /** Checks a program. Only the diagnostics are read. */
    prepare(
        source: string,
        options?: PrepareOptions
    ): Promise<
        Pick<PreparedProgram, 'diagnostics'> & {
            /** Frees the program in the worker. */
            release?(): void;
        }
    >;
    /** Completion items at `offset`. */
    complete(source: string, offset: number, options?: { ruleContext?: MinabRuleContext; hints?: EditorHints }): Promise<CompletionResult>;
    /** Hover text at `offset`, or `undefined`. */
    hover(source: string, offset: number, options?: { ruleContext?: MinabRuleContext; hints?: EditorHints }): Promise<HoverResult | undefined>;
    /** The `findUser('usr_…')` calls of a program. Needed only for `userLabels` (inlay hints and hover of a pinned person). */
    pinnedUsers?(source: string, options?: { ruleContext?: MinabRuleContext }): Promise<PinnedUser[]>;
    /** Signature help at `offset`, or `undefined`. */
    signatureHelp(source: string, offset: number, options?: { ruleContext?: MinabRuleContext }): Promise<SignatureHelpResult | undefined>;
}

/** Options of `registerMinab`. */
export interface RegisterMinabOptions {
    /** The runtime in the worker. */
    client: MinabEditorClient;
    /** The language id to register. Default `minab`. */
    languageId?: string;
    /** The rule context for every check and every editor question. Default: the one of the client's runtime. */
    ruleContext?: MinabRuleContext;
    /** Wait this long after the last edit before the check (milliseconds). Default 150. */
    debounceMs?: number;
    /** The owner of the markers. Default `minab`. */
    markerOwner?: string;
    /**
     * The groups of the workspace for `@@` completion and hover: names, titles and kinds. Read when completion or hover asks,
     * so keep it cheap (cache it). Without it the editor offers the names of `ruleContext.groupNames`.
     */
    directoryNames?: () => readonly DirectoryName[] | Promise<readonly DirectoryName[]>;
    /**
     * Who these user ids are. A rule that names a person is saved as `findUser('usr_…')`; with this callback the editor shows
     * "Sara Ahmadi · sara@example.com" after the call (an inlay hint) and on hover. One call for all the ids of a program.
     * An id the host does not know, or a person with no name, is left out of the answer. Needs `client.pinnedUsers`.
     */
    userLabels?: (ids: string[]) => Readonly<Record<string, UserLabel>> | Promise<Readonly<Record<string, UserLabel>>>;
    /** Markdown for a hovered keyword (the editor gives only the word). Without it a keyword has no hover. */
    keywordDocs?: (keyword: string) => string | undefined;
    /** Called when the worker fails (it stopped, or a request failed). The editor itself keeps working. */
    onError?: (error: unknown) => void;
}

/** What `registerMinab` gives back: a way to stop it, and a way to check a model now. */
export interface MinabRegistration {
    /** Removes the providers and the markers and stops the checks. The language id stays registered (Monaco cannot unregister it). */
    dispose(): void;
    /** Checks one model now, without waiting for the debounce. */
    check(model: Monaco.editor.ITextModel): Promise<void>;
}
