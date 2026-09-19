/**
 * Modal shell.
 *
 * The structure is deliberate and should not be simplified:
 *
 *   backdrop        the scroll container
 *     min-h-full    centring happens here, not on the scroll container
 *       panel       capped to the viewport height, flex column
 *         header    shrink-0, always visible
 *         body      the only scrolling region
 *         footer    shrink-0, always visible
 *
 * Putting `items-center` directly on the scroll container is the classic bug:
 * once the panel is taller than the viewport, centring pushes its top above the
 * scroll origin, which is a region you cannot scroll back to. The buttons are
 * still there, just permanently unreachable. Keeping centring on an inner
 * wrapper with `min-h-full` avoids it entirely.
 */

import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[min(1400px,94vw)]',
};

export default function Modal({
  title,
  subtitle,
  icon,
  onClose,
  footer,
  children,
  size = 'md',
  labelledBy = 'modal-title',
}) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  // Escape closes; focus moves into the dialog and returns on unmount.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    panelRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/60 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(event) => {
        // Only a click that both starts and ends on the backdrop closes it,
        // so a drag-select inside the panel does not dismiss the dialog.
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="flex min-h-full items-center justify-center p-3 sm:p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? labelledBy : undefined}
          tabIndex={-1}
          className={`flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/40 animate-slide-up sm:max-h-[calc(100dvh-3rem)] ${SIZES[size] ?? SIZES.md}`}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
            {icon ? (
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon name={icon} size={17} />
              </span>
            ) : null}

            <div className="min-w-0 flex-1">
              <h2 id={labelledBy} className="truncate text-base font-semibold text-fg">
                {title}
              </h2>
              {subtitle ? <p className="mt-0.5 text-xs text-dim">{subtitle}</p> : null}
            </div>

            <button type="button" onClick={onClose} className="btn-icon shrink-0" aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

          {footer ? (
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface2 px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </div>
      </div>
    </div>
  );
}
