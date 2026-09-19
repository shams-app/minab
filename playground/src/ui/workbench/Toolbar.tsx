import type { Example } from '../../content/types.js';
import type { EngineView } from '../../hooks/useEngine.js';
import { Icon } from '../primitives/Icon.js';
import { Badge, Button, IconButton, Kbd, Toggle } from '../primitives/primitives.js';

export function EngineStatusPill({ engine }: { engine: EngineView }) {
    return (
        <span className="mb-status-pill" data-state={engine.indicator} title={engine.detail} role="status">
            <span className="mb-status-dot" aria-hidden="true" />
            {engine.label}
            {engine.indicator === 'failed' && <button type="button" className="mb-link-button" onClick={engine.restart}>Restart</button>}
        </span>
    );
}

export function RunButton({ onRun, running }: { onRun: () => void; running: boolean }) {
    return (
        <Button variant="primary" icon="play" busy={running} onClick={onRun} title="Run (⌘/Ctrl + Enter)" className="mb-run-button">
            Run <Kbd keys={['⌘', '↵']} />
        </Button>
    );
}

export interface ExamplePickerProps {
    examples: Example[];
    currentId?: string;
    onPick: (id: string) => void;
}

export function ExamplePicker({ examples, currentId, onPick }: ExamplePickerProps) {
    return (
        <label className="mb-example-picker">
            <span className="mb-visually-hidden">Example</span>
            <select className="mb-select" value={currentId ?? ''} onChange={e => e.target.value && onPick(e.target.value)}>
                <option value="">{currentId ? 'Examples…' : 'Scratch — pick an example…'}</option>
                {examples.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
        </label>
    );
}

export interface ToolbarProps {
    title?: string;
    example?: Example;
    examples: Example[];
    onPickExample: (id: string) => void;
    onResetExample?: () => void;
    engine: EngineView;
    running: boolean;
    onRun: () => void;
    autoRun: boolean;
    onAutoRunChange: (on: boolean) => void;
    onShare: () => void;
    onEmbed: () => void;
    onExport: () => void;
    onOpenReference: () => void;
}

export function Toolbar(props: ToolbarProps) {
    return (
        <div className="mb-toolbar" role="toolbar" aria-label="Program">
            <div className="mb-toolbar-start">
                <ExamplePicker examples={props.examples} currentId={props.example?.id} onPick={props.onPickExample} />
                {props.example && (
                    <>
                        <Badge tone="neutral" title="Spec section">{props.example.specRef}</Badge>
                        {props.onResetExample && <IconButton icon="reset" size="sm" label="Reset to the original example" onClick={props.onResetExample} />}
                    </>
                )}
            </div>
            <div className="mb-toolbar-end">
                <EngineStatusPill engine={props.engine} />
                <Toggle checked={props.autoRun} onChange={props.onAutoRunChange} label="Auto-run" hint="Run as you type" />
                <IconButton icon="book" label="Cheat sheet" onClick={props.onOpenReference} />
                <IconButton icon="download" label="Download for the CLI (.zip)" onClick={props.onExport} />
                <IconButton icon="code" label="Copy embed code" onClick={props.onEmbed} />
                <Button icon="share" onClick={props.onShare}>Share</Button>
                <RunButton onRun={props.onRun} running={props.running} />
            </div>
        </div>
    );
}

export interface EditorStatusBarProps {
    kind?: string;
    resultType?: string;
    errors: number;
    warnings: number;
    checkOnly: boolean;
    onShowProblems: () => void;
}

const KIND_LABELS: Record<string, string> = {
    query: 'Pipeline query',
    'record-rule': 'Record rule',
    'field-rule': 'Field rule',
    value: 'Expression',
    empty: 'Empty program'
};

export function EditorStatusBar({ kind, resultType, errors, warnings, checkOnly, onShowProblems }: EditorStatusBarProps) {
    return (
        <div className="mb-statusbar">
            <span className="mb-statusbar-kind">{kind ? KIND_LABELS[kind] ?? kind : '…'}{resultType && <> → <code>{resultType}</code></>}</span>
            {checkOnly && <Badge tone="check-only" title="Uses constructs that type-check but don’t execute yet">check-only</Badge>}
            <button type="button" className="mb-statusbar-problems" onClick={onShowProblems} data-state={errors ? 'error' : warnings ? 'warning' : 'ok'}>
                <Icon name={errors ? 'alert' : 'check'} size={12} />
                {errors ? `${errors} error${errors === 1 ? '' : 's'}` : warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : 'No problems'}
            </button>
        </div>
    );
}
