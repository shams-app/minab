/**
 * Gives lexer and parser errors their stable codes (`syntax.lexer`,
 * `syntax.parser`). Langium makes these diagnostics itself, without a code,
 * so this is the one place that adds it. The English message stays as it is,
 * and it is also kept as the parameter `message`.
 */

import { DefaultDocumentValidator, type ParseResult, type ValidationOptions } from 'langium';
import type { Diagnostic } from 'vscode-languageserver-types';
import type { DiagnosticCode } from './codes.js';

export class MinabDocumentValidator extends DefaultDocumentValidator {
    protected override processLexingErrors(parseResult: ParseResult, diagnostics: Diagnostic[], options: ValidationOptions): void {
        const first = diagnostics.length;
        super.processLexingErrors(parseResult, diagnostics, options);
        this.addCodes(diagnostics, first, 'syntax.lexer');
    }

    protected override processParsingErrors(parseResult: ParseResult, diagnostics: Diagnostic[], options: ValidationOptions): void {
        const first = diagnostics.length;
        super.processParsingErrors(parseResult, diagnostics, options);
        this.addCodes(diagnostics, first, 'syntax.parser');
    }

    private addCodes(diagnostics: Diagnostic[], first: number, code: DiagnosticCode): void {
        for (const diagnostic of diagnostics.slice(first)) {
            diagnostic.code = code;
            diagnostic.data = { ...(diagnostic.data as object), params: { message: String(diagnostic.message) } };
        }
    }
}
