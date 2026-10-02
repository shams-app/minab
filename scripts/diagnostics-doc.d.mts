export const DOC_PATH: string;
export function renderDiagnosticsDoc(diagnostics: Record<string, { severity: string; message: (params: never) => string; doc: string }>): string;
