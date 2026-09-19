import type { Toast as ToastData } from '../../state/store.js';
import { Icon } from './Icon.js';
import { IconButton } from './primitives.js';

export function Toast({ toast, onDismiss }: { toast?: ToastData; onDismiss: () => void }) {
    return (
        <div className="mb-toast-region" aria-live="polite">
            {toast && (
                <div className="mb-toast" data-tone={toast.tone} key={toast.id}>
                    <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'info'} />
                    <span>{toast.message}</span>
                    <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} />
                </div>
            )}
        </div>
    );
}
