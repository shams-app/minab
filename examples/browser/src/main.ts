import './style.css';
import { startForm } from './form';

const pages = { form: document.getElementById('page-form')!, editor: document.getElementById('page-editor')! };
let editorLoaded = false;

function route(): void {
    const page = location.hash === '#editor' ? 'editor' : 'form';
    pages.form.hidden = page !== 'form';
    pages.editor.hidden = page !== 'editor';
    // Monaco is large: load it only when the editor page is opened.
    if (page === 'editor' && !editorLoaded) {
        editorLoaded = true;
        void import('./editor').then(module => module.startEditor());
    }
}

window.addEventListener('hashchange', route);
route();
void startForm();
