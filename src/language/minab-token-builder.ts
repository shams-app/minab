import { DefaultTokenBuilder, GrammarUtils, type GrammarAST } from 'langium';
import type { TokenType } from 'chevrotain';

/**
 * Langium turns a terminal with the `u` flag into a custom pattern
 * function, and it only looks at the `source` of a plain pattern when it
 * decides which terminal can match a longer text than a keyword. `ID` uses
 * `\p{L}` and so has the `u` flag. Without this class, no keyword would
 * list `ID` as its longer alternative, and `FROMا` would be lexed as the
 * keyword `FROM` followed by a name.
 *
 * Here we remember the regular expression of each such terminal, and tell
 * a keyword that a terminal is a longer alternative when the whole keyword
 * matches it. So a longer name always wins over a keyword (spec §2.4).
 */
export class MinabTokenBuilder extends DefaultTokenBuilder {
    private readonly unicodeTerminals = new Map<string, RegExp>();

    protected override buildTerminalToken(terminal: GrammarAST.TerminalRule): TokenType {
        const regex = GrammarUtils.terminalRegex(terminal);
        if (regex.unicode) this.unicodeTerminals.set(terminal.name, new RegExp(`^(?:${regex.source})$`, regex.flags));
        return super.buildTerminalToken(terminal);
    }

    protected override findLongerAlt(keyword: GrammarAST.Keyword, terminalTokens: TokenType[]): TokenType[] {
        const found = super.findLongerAlt(keyword, terminalTokens);
        for (const token of terminalTokens) {
            if (!found.includes(token) && this.unicodeTerminals.get(token.name)?.test(keyword.value)) found.push(token);
        }
        return found;
    }
}
