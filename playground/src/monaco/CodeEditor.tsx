/**
 * The Monaco editor as a controlled React component.
 *
 * It is deliberately not part of `src/ui/`: its look comes entirely from
 * design tokens (`theme.ts`), so a redesign never needs to touch it. What it
 * does take as props is everything the engine knows about the program —
 * diagnostics become squiggles, pushed-down statements become underlined
 * spans, and a hovered trace entry or AST node lights up its source.
 */

import { useEffect, useRef } from 'react';
import type { CheckOnlyConstruct, EngineDiagnostic, Range, TraceEntry } from '../engine/protocol.js';
import type { Highlight } from '../state/store.js';
import { LANGUAGE_ID, registerMinab, toMonacoRange } from './language.js';
import { jsonDefaults, monaco } from './monaco.js';
import { applyEditorTheme, editorFont, watchTheme } from './theme.js';

export interface CodeEditorProps {
    value: string;
    onChange?: (value: string) => void;
    /** `inmemory://minab/<path>` — one model per path, so undo history survives remounts. */
    path: string;
    language?: 'minab' | 'json';
    readOnly?: boolean;
    /** A tighter layout for embeds and small panels: no line numbers or folding. */
    compact?: boolean;
    ariaLabel: string;
    diagnostics?: EngineDiagnostic[];
    /** Statements that reached the database; their source spans are marked. */
    pushdowns?: TraceEntry[];
    checkOnly?: CheckOnlyConstruct[];
    highlight?: Highlight;
    reveal?: { range: Range; nonce: number };
    onRun?: () => void;
    /** JSON Schema for `language: 'json'` models. */
    jsonSchema?: object;
    className?: string;
}

const SEVERITY: Record<number, monaco.MarkerSeverity> = {
    1: monaco.MarkerSeverity.Error,
    2: monaco.MarkerSeverity.Warning,
    3: monaco.MarkerSeverity.Info,
    4: monaco.MarkerSeverity.Hint
};

const schemas = new Map<string, object>();

function registerJsonSchema(path: string, schema: object): void {
    schemas.set(path, schema);
    jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        schemas: [...schemas.entries()].map(([file, s]) => ({
            uri: `inmemory://schema/${file}.json`,
            fileMatch: [`inmemory://minab/${file}`],
            schema: s
        }))
    });
}

export function CodeEditor(props: CodeEditorProps) {
    const container = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
    const decorations = useRef<monaco.editor.IEditorDecorationsCollection | undefined>(undefined);
    const highlightDecorations = useRef<monaco.editor.IEditorDecorationsCollection | undefined>(undefined);
    const applyingExternal = useRef(false);
    const latest = useRef(props);
    latest.current = props;

    // Create the editor once.
    useEffect(() => {
        registerMinab();
        applyEditorTheme();
        watchTheme();
        const uri = monaco.Uri.parse(`inmemory://minab/${props.path}`);
        const model = monaco.editor.getModel(uri)
            ?? monaco.editor.createModel(props.value, props.language ?? LANGUAGE_ID, uri);
        if (model.getValue() !== props.value) model.setValue(props.value);
        if (props.jsonSchema) registerJsonSchema(props.path, props.jsonSchema);
        const font = editorFont();
        const editor = monaco.editor.create(container.current!, {
            model,
            readOnly: props.readOnly,
            ariaLabel: props.ariaLabel,
            automaticLayout: true,
            minimap: { enabled: false },
            fontFamily: font.family,
            fontSize: font.size,
            lineHeight: font.lineHeight,
            fontLigatures: true,
            lineNumbers: props.compact ? 'off' : 'on',
            lineDecorationsWidth: props.compact ? 8 : 10,
            folding: !props.compact,
            glyphMargin: false,
            renderLineHighlight: props.readOnly ? 'none' : 'line',
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            tabSize: 4,
            wordWrap: 'on',
            fixedOverflowWidgets: true,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            bracketPairColorization: { enabled: false },
            guides: { indentation: !props.compact },
            quickSuggestions: { other: true, comments: false, strings: false },
            suggest: { showWords: false },
            scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            stickyScroll: { enabled: false },
            placeholder: props.readOnly ? undefined : 'Write a query like FROM Order SELECT .id — or a rule like .total > 0'
        });
        editorRef.current = editor;
        decorations.current = editor.createDecorationsCollection();
        highlightDecorations.current = editor.createDecorationsCollection();

        const changes = editor.onDidChangeModelContent(() => {
            if (!applyingExternal.current) latest.current.onChange?.(editor.getValue());
        });
        editor.addAction({
            id: 'minab.run',
            label: 'Run program',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
            run: () => latest.current.onRun?.()
        });
        return () => {
            changes.dispose();
            editor.dispose();
            editorRef.current = undefined;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.path]);

    // External value changes (loading an example, a preset, a reset) — keep undo history.
    useEffect(() => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model || model.getValue() === props.value) return;
        applyingExternal.current = true;
        editor.pushUndoStop();
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: props.value }], () => null);
        editor.pushUndoStop();
        applyingExternal.current = false;
    }, [props.value]);

    useEffect(() => {
        editorRef.current?.updateOptions({ readOnly: props.readOnly });
    }, [props.readOnly]);

    // Diagnostics → markers.
    useEffect(() => {
        const model = editorRef.current?.getModel();
        if (!model || props.language === 'json') return;
        monaco.editor.setModelMarkers(model, 'minab', (props.diagnostics ?? []).map(d => ({
            ...toMonacoRange(d.range),
            severity: SEVERITY[d.severity] ?? monaco.MarkerSeverity.Error,
            message: d.message,
            source: d.source === 'syntax' ? 'syntax' : 'minab'
        })));
    }, [props.diagnostics, props.language]);

    // Pushed-down spans and check-only constructs → persistent decorations.
    useEffect(() => {
        const items: monaco.editor.IModelDeltaDecoration[] = [];
        for (const entry of props.pushdowns ?? []) {
            if (!entry.origin) continue;
            items.push({
                range: toMonacoRange(entry.origin.range),
                options: {
                    inlineClassName: 'minab-pushdown',
                    hoverMessage: { value: `**Statement ${entry.index}** reached the database — ${entry.rowCount} row${entry.rowCount === 1 ? '' : 's'} in ${entry.durationMs.toFixed(1)} ms. Everything else in this program was answered in memory.` },
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                }
            });
        }
        for (const construct of props.checkOnly ?? []) {
            items.push({
                range: toMonacoRange(construct.range),
                options: {
                    className: 'minab-check-only',
                    hoverMessage: { value: `**${construct.label}** (spec ${construct.specRef}) parse and type-check, but aren't executed yet.` },
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                }
            });
        }
        decorations.current?.set(items);
    }, [props.pushdowns, props.checkOnly]);

    // A transient highlight: hovering a trace entry, an AST node, a problem.
    useEffect(() => {
        const highlight = props.highlight;
        highlightDecorations.current?.set(highlight
            ? [{ range: toMonacoRange(highlight.range), options: { className: `minab-highlight minab-highlight-${highlight.kind}`, isWholeLine: false } }]
            : []);
        if (highlight) editorRef.current?.revealRangeInCenterIfOutsideViewport(toMonacoRange(highlight.range));
    }, [props.highlight]);

    // Reveal-and-select requests (clicking a problem).
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || !props.reveal) return;
        const range = toMonacoRange(props.reveal.range);
        editor.revealRangeInCenter(range);
        editor.setSelection(range);
        editor.focus();
    }, [props.reveal?.nonce]);

    return <div ref={container} className={props.className} data-slot="code-editor" style={{ width: '100%', height: '100%' }} />;
}

export default CodeEditor;
