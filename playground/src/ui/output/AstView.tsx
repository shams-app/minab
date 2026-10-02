/**
 * The AST tab: the parsed program as Langium sees it, with the type the
 * checker infers for each expression. Hovering a node highlights its span.
 */

import { useState } from 'react';
import type { AstNodeView, Range } from '../../engine/protocol.js';
import { Badge, EmptyState } from '../primitives/primitives.js';
import { Icon } from '../primitives/Icon.js';

export interface AstViewProps {
    tree?: AstNodeView;
    loading: boolean;
    onHighlight: (range: Range | undefined) => void;
    onReveal: (range: Range) => void;
}

function Node({ node, depth, onHighlight, onReveal }: { node: AstNodeView; depth: number } & Pick<AstViewProps, 'onHighlight' | 'onReveal'>) {
    const [open, setOpen] = useState(depth < 3);
    const attributes = Object.entries(node.attributes);
    return (
        <li className="mb-ast-node" role="treeitem" aria-expanded={node.children.length ? open : undefined}>
            <div className="mb-ast-row" onMouseEnter={() => node.range && onHighlight(node.range)} onMouseLeave={() => onHighlight(undefined)}>
                {node.children.length > 0 ? (
                    <button type="button" className="mb-ast-toggle" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
                        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
                    </button>
                ) : (
                    <span className="mb-ast-toggle" />
                )}
                {node.feature && <span className="mb-ast-feature">{node.feature}:</span>}
                <button type="button" className="mb-ast-type" onClick={() => node.range && onReveal(node.range)}>
                    {node.type}
                </button>
                {attributes.map(([k, v]) => (
                    <span key={k} className="mb-ast-attr">
                        {k}=<code>{JSON.stringify(v)}</code>
                    </span>
                ))}
                {node.inferredType && <Badge tone="accent">{node.inferredType}</Badge>}
            </div>
            {open && node.children.length > 0 && (
                <ul role="group">
                    {node.children.map((child, i) => (
                        <Node key={i} node={child} depth={depth + 1} onHighlight={onHighlight} onReveal={onReveal} />
                    ))}
                </ul>
            )}
        </li>
    );
}

export function AstView({ tree, loading, onHighlight, onReveal }: AstViewProps) {
    if (!tree) return <EmptyState icon="tree" title={loading ? 'Parsing…' : 'Nothing parsed yet'} />;
    return (
        <div className="mb-ast">
            <p className="mb-muted">The parse tree, with the type the checker infers for each expression. Hover a node to see its source.</p>
            <ul className="mb-ast-tree" role="tree" aria-label="Syntax tree">
                <Node node={tree} depth={0} onHighlight={onHighlight} onReveal={onReveal} />
            </ul>
        </div>
    );
}
