/**
 * Pinned users (MN.4, P4). A rule that names a person by e-mail is saved with the user's id: `findUser('usr_5h2m')`.
 * An id says nothing to a reader, so an editor shows the member next to it, "Sara Ahmadi · sara@example.com", as an inlay
 * hint and on hover. The names come from the host (`userLabels(ids)`); this file finds the calls and writes the text.
 */

import { AstUtils } from 'langium';
import { isCallExpression, isNameRef, isStringLiteral } from '../language/generated/ast.js';
import type { EditorDocument } from './document.js';
import type { PinnedUser } from './types.js';

/** The ids of user keys in `findUser('usr_…')` calls, with where each call is. Other keys (an e-mail, a phone, a variable) are not pinned. */
export function pinnedUsers(doc: EditorDocument): PinnedUser[] {
    const found: PinnedUser[] = [];
    for (const node of AstUtils.streamAst(doc.document.parseResult.value)) {
        if (!isCallExpression(node) || !isNameRef(node.callee) || node.callee.name !== 'findUser' || node.args.length !== 1) continue;
        const key = node.args[0];
        const range = node.$cstNode?.range;
        if (isStringLiteral(key) && range && /^usr_[A-Za-z0-9_-]+$/.test(key.value)) found.push({ id: key.value, range });
    }
    return found;
}

// The text of a hint is written in `types.ts`, which has no imports: the Monaco side reads it on the main thread without the parser.
export { inlayHints, userLabelText } from './types.js';
