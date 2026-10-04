import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import { registerMinab } from '@shamsine/minab/monaco';
import { local } from './minab';
import { ruleContext } from './schema';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: () => new editorWorker() };

let started = false;

export function startEditor(): void {
    if (started) return;
    started = true;
    // One call: the language, colours, brackets, error markers, completion, hover and signature help.
    registerMinab(monaco, { client: local, ruleContext });
    const model = monaco.editor.createModel('', 'minab');
    monaco.editor.create(document.getElementById('editor')!, { model, automaticLayout: true, minimap: { enabled: false }, autoClosingBrackets: 'never', autoClosingQuotes: 'never' });

    // The markers are also listed under the editor.
    const list = document.getElementById('problems')!;
    monaco.editor.onDidChangeMarkers(() => {
        list.replaceChildren(
            ...monaco.editor.getModelMarkers({ resource: model.uri }).map(marker => {
                const item = document.createElement('li');
                item.textContent = `${String(typeof marker.code === 'object' ? marker.code.value : marker.code)}: ${marker.message}`;
                return item;
            })
        );
    });
}
