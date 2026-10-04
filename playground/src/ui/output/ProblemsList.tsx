import type { EngineDiagnostic, Range } from '../../engine/protocol.js';
import { EmptyState } from '../primitives/primitives.js';
import { Icon } from '../primitives/Icon.js';

export interface ProblemsListProps {
    diagnostics: EngineDiagnostic[];
    configError?: string;
    onSelect: (range: Range) => void;
}

const LABELS = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' } as const;

export function ProblemsList({ diagnostics, configError, onSelect }: ProblemsListProps) {
    if (diagnostics.length === 0 && !configError) {
        return (
            <EmptyState icon="check" tone="success" title="No problems">
                The program parses, resolves and type-checks against this host’s schema.
            </EmptyState>
        );
    }
    return (
        <ul className="mb-problems">
            {configError && (
                <li className="mb-problem" data-severity="error">
                    <Icon name="alert" />{' '}
                    <span>
                        <strong>Host config:</strong> {configError}
                    </span>
                </li>
            )}
            {diagnostics.map((d, i) => (
                <li key={i}>
                    <button type="button" className="mb-problem" data-severity={LABELS[d.severity]} onClick={() => onSelect(d.range)}>
                        <Icon name={d.severity === 1 ? 'alert' : 'info'} />
                        <span className="mb-problem-message">
                            <span>{d.message}</span>
                            {d.code && <span className="mb-problem-code">{d.code}</span>}
                        </span>
                        <span className="mb-problem-where">
                            {d.source === 'syntax' ? 'syntax' : 'minab'} · {d.range.start.line + 1}:{d.range.start.character + 1}
                        </span>
                    </button>
                </li>
            ))}
        </ul>
    );
}
