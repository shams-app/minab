/**
 * The host panel: everything a real application would hand Minab that the
 * source never says — the schema, the data, and (for rules) the record or
 * value under validation. The playground plays the host; this panel is
 * how a visitor plays it too.
 */

import type { ReactNode } from 'react';
import type { HostTab } from '../../state/store.js';
import { Callout, IconButton, Tabs } from '../primitives/primitives.js';

export interface HostPanelProps {
    tab: HostTab;
    onTabChange: (tab: HostTab) => void;
    ruleKind: 'none' | 'record' | 'field';
    error?: string;
    onCollapse?: () => void;
    children: ReactNode;
}

export function HostPanel({ tab, onTabChange, ruleKind, error, onCollapse, children }: HostPanelProps) {
    return (
        <section className="mb-host" aria-label="Host: schema, data and record">
            <header className="mb-panel-head">
                <Tabs
                    idPrefix="host"
                    ariaLabel="Host"
                    size="sm"
                    active={tab}
                    onChange={onTabChange}
                    tabs={[
                        { id: 'schema', label: 'Schema', icon: 'layers' },
                        { id: 'data', label: 'Data', icon: 'database' },
                        { id: 'record', label: 'Record', icon: 'table', badge: ruleKind === 'record' ? '.' : undefined, badgeTone: 'accent' },
                        { id: 'field', label: 'Field', icon: 'dot', badge: ruleKind === 'field' ? '$' : undefined, badgeTone: 'accent' }
                    ]}
                />
                {onCollapse && <IconButton icon="chevron-down" label="Hide host panel" size="sm" onClick={onCollapse} />}
            </header>
            {error && <Callout tone="danger" icon="alert" title="Host config error">{error}</Callout>}
            <div className="mb-panel-body" id="host-panel" role="tabpanel" aria-labelledby={`host-tab-${tab}`}>
                {children}
            </div>
        </section>
    );
}
