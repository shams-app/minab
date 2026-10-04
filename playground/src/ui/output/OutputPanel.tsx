import type { ReactNode } from 'react';
import type { OutputTab } from '../../state/store.js';
import { Tabs, type TabItem } from '../primitives/primitives.js';

export interface OutputPanelProps {
    tab: OutputTab;
    onTabChange: (tab: OutputTab) => void;
    counts: { problems: number; statements?: number; rows?: number; logs?: number };
    /** Tabs to offer; the embed shows fewer. */
    tabs?: OutputTab[];
    children: ReactNode;
}

const ALL: OutputTab[] = ['result', 'sql', 'execution', 'console', 'problems', 'ast'];

export function OutputPanel({ tab, onTabChange, counts, tabs = ALL, children }: OutputPanelProps) {
    const items: Record<OutputTab, TabItem<OutputTab>> = {
        result: { id: 'result', label: 'Result', icon: 'table', badge: counts.rows },
        sql: { id: 'sql', label: 'SQL', icon: 'code' },
        execution: { id: 'execution', label: 'Execution', icon: 'layers', badge: counts.statements, badgeTone: 'pushdown' },
        console: { id: 'console', label: 'Console', icon: 'terminal', badge: counts.logs || undefined },
        problems: { id: 'problems', label: 'Problems', icon: 'alert', badge: counts.problems || undefined, badgeTone: 'danger' },
        ast: { id: 'ast', label: 'AST', icon: 'tree' }
    };
    return (
        <section className="mb-output" aria-label="Output">
            <header className="mb-panel-head">
                <Tabs idPrefix="output" ariaLabel="Output" active={tab} onChange={onTabChange} tabs={tabs.map(t => items[t])} />
            </header>
            <div className="mb-panel-body" id="output-panel" role="tabpanel" aria-labelledby={`output-tab-${tab}`}>
                {children}
            </div>
        </section>
    );
}
