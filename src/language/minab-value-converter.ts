import { DefaultValueConverter, type CstNode, type GrammarAST, type ValueType } from 'langium';

/** One backtick name: `...` with `\` escapes inside. */
const QUOTED = /`((?:[^`\\]|\\[\s\S])*)`/g;

/** Removes the escapes from the inside of a backtick name: `\x` becomes `x` (so `\`` is a backtick and `\\` a backslash). */
function unescape(inner: string): string {
    return inner.replace(/\\([\s\S])/g, '$1');
}

/**
 * Turns the text of a name into the name itself.
 *
 * A plain name stays as it is. A backtick name loses its backticks and
 * its escapes (spec §2.4). The rule `Name` is a datatype rule, so the
 * parser hands us the whole text of the name; `QualifiedName` is a list of
 * names joined by dots.
 */
export class MinabValueConverter extends DefaultValueConverter {
    protected override runConverter(rule: GrammarAST.AbstractRule, input: string, cstNode: CstNode): ValueType {
        switch (rule.name) {
            case 'Name':
            case 'QualifiedName':
            case 'QUOTED_NAME':
                return input.replace(QUOTED, (_, inner: string) => unescape(inner));
            default:
                return super.runConverter(rule, input, cstNode);
        }
    }
}
