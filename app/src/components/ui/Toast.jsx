/**
 * Toasts.
 *
 * Used for things that happened and do not need a decision: a file imported,
 * an export written, an autosave failure. Anything requiring a choice belongs
 * in a dialog instead.
 */

import { useCallback, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const TONES = {
  info: { icon: 'info', className: 'border-line text-fg' },
  success: { icon: 'checkCircle', className: 'border-ok text-ok' },
  warning: { icon: 'warning', className: 'border-warn text-warn' },
  error: { icon: 'error', className: 'border-err text-err' },
};

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message, options = {}) => {
      const id = (nextId.current += 1);
      const tone = options.tone ?? 'info';
      const ttl = options.ttl ?? (tone === 'error' ? 9000 : 4200);

      setToasts((current) => [...current.slice(-3), { id, message, tone, detail: options.detail }]);

      if (ttl > 0) {
        setTimeout(() => {
          setToasts((current) => current.filter((toast) => toast.id !== id));
        }, ttl);
      }

      return id;
    },
    [],
  );

  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const tone = TONES[toast.tone] ?? TONES.info;
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 shadow-lg shadow-black/30 animate-slide-up ${tone.className}`}
          >
            <Icon name={tone.icon} size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">{toast.message}</p>
              {toast.detail ? <p className="mt-0.5 text-xs text-dim">{toast.detail}</p> : null}
            </div>
            <button type="button" onClick={() => onDismiss(toast.id)} className="btn-icon -mr-1 -mt-0.5 shrink-0" aria-label="Dismiss">
              <Icon name="x" size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
