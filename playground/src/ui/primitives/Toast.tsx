import { useEffect, useState } from 'react';
import type { Toast as ToastData } from '../../state/store.js';
import { Icon } from './Icon.js';
import { IconButton } from './primitives.js';

/**
 * Info and success toasts close by themselves (the store clears them after a
 * few seconds). An error stays until the visitor closes it: this component
 * keeps the last error even after the store has cleared it.
 */
export function Toast({ toast, onDismiss }: { toast?: ToastData; onDismiss: () => void }) {
    const [heldError, setHeldError] = useState<ToastData>();
    useEffect(() => {
        if (toast?.tone === 'error') setHeldError(toast);
        else if (toast) setHeldError(undefined);
    }, [toast]);
    const shown = toast ?? heldError;
    return (
        <div className="mb-toast-region" role="status" aria-live={shown?.tone === 'error' ? 'assertive' : 'polite'}>
            {shown && (
                <div className="mb-toast" data-tone={shown.tone} key={shown.id}>
                    <Icon name={shown.tone === 'error' ? 'alert' : shown.tone === 'success' ? 'check' : 'info'} />
                    <span>{shown.message}</span>
                    <IconButton
                        icon="x"
                        label="Dismiss"
                        size="sm"
                        onClick={() => {
                            setHeldError(undefined);
                            onDismiss();
                        }}
                    />
                </div>
            )}
        </div>
    );
}
