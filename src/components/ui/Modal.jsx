'use client';

import { useCallback, useEffect, useId, useRef } from 'react';

/**
 * Everything focusable, in document order.
 *
 * `:not([disabled])` matters — a disabled control is not in the tab order, and
 * treating it as the last stop sends focus into a dead end. The negative-tabindex
 * exclusion is what keeps programmatically-focusable-but-not-tabbable elements
 * (the dialog itself, for one) out of the cycle.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showClose = true,
}) {
  const dialogRef = useRef(null);
  // Where focus was before the dialog opened, so it can go back there.
  const returnFocusRef = useRef(null);
  const titleId = useId();

  const focusable = useCallback(
    () => Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) ?? [])
      // A control inside a collapsed section has no box and cannot be focused.
      .filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement),
    []
  );

  // Body scroll lock. Separate from the focus work because it has a different
  // lifetime: it must survive a re-render that focus management does not care
  // about.
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isOpen]);

  /**
   * Take focus on open, put it back on close.
   *
   * Without the restore, closing a dialog drops focus onto <body> and the next
   * Tab starts from the top of the document — so a keyboard user who opens Trip
   * Settings from the toolbar, closes it, and presses Tab is back at the skip
   * link rather than where they were.
   */
  useEffect(() => {
    if (!isOpen) return undefined;

    returnFocusRef.current = document.activeElement;

    // The first real control, not the close button: a screen reader announces
    // the dialog's label from the container, and landing on "Close" first
    // suggests closing is the expected action. Falls back to the dialog itself,
    // which is focusable via tabIndex={-1} for exactly this case.
    const first = focusable().find((el) => !el.hasAttribute('data-modal-close'));
    (first ?? dialogRef.current)?.focus();

    return () => {
      const target = returnFocusRef.current;
      // isConnected: the element that opened the dialog may itself have been
      // removed by whatever the dialog did — deleting the activity whose button
      // opened it, for instance. Focusing a detached node silently does nothing
      // and leaves focus on <body>.
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [isOpen, focusable]);

  /**
   * Escape to close, Tab to cycle within.
   *
   * The trap is the point: without it, Tab walks straight out of the dialog and
   * into the page behind it, which is still there and still clickable but hidden
   * from view behind the backdrop. A keyboard user ends up interacting with a
   * form they cannot see.
   */
  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }

      if (e.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) {
        // Nothing to move to; keep focus on the dialog rather than losing it.
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, and catch the case where focus has somehow escaped
      // the dialog entirely — pull it back rather than letting Tab continue
      // into the page behind.
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Captured on the document so a keystroke inside a child that stops
    // propagation cannot bypass the trap.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose, focusable]);

  if (!isOpen) return null;

  return (
    <>
      {/* Click-to-dismiss on the backdrop is a mouse affordance. Escape is the
          keyboard equivalent and is handled above, so this needs no role and no
          tabindex — giving it one would put an unlabelled stop in the tab
          order. aria-hidden is deliberately NOT set: it would hide the dialog
          inside it from screen readers. */}
      <div className="wf-modal-backdrop" onClick={onClose}>
        <div
          ref={dialogRef}
          className={`wf-modal wf-modal--${size}`}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          // Labelled by the visible heading where there is one, so a screen
          // reader announces the same words a sighted user reads.
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : 'Dialog'}
          // Focusable but not tabbable: somewhere for focus to rest when the
          // dialog has no controls of its own.
          tabIndex={-1}
        >
          {(title || showClose) && (
            <div className="wf-modal__header">
              {title && <h3 className="wf-modal__title" id={titleId}>{title}</h3>}
              {showClose && (
                <button
                  className="wf-modal__close"
                  onClick={onClose}
                  aria-label="Close dialog"
                  // Marks this as the fallback rather than the opening focus
                  // target; see the focus effect above.
                  data-modal-close=""
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          )}
          <div className="wf-modal__body">{children}</div>
        </div>
      </div>

      <style jsx>{`
        .wf-modal-backdrop {
          position: fixed;
          inset: 0;
          background: var(--color-overlay);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: var(--z-modal-backdrop);
          padding: var(--space-4);
          animation: fadeIn 0.2s ease-out;
        }

        .wf-modal {
          background: var(--color-surface);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-xl);
          max-height: 90vh;
          overflow-y: auto;
          animation: scaleIn 0.3s ease-out;
          border: 1px solid var(--color-border-light);
        }

        .wf-modal--sm { width: 100%; max-width: 420px; }
        .wf-modal--md { width: 100%; max-width: 560px; }
        .wf-modal--lg { width: 100%; max-width: 720px; }
        .wf-modal--xl { width: 100%; max-width: 960px; }

        .wf-modal__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-6) var(--space-6) 0;
        }

        .wf-modal__title {
          font-size: var(--text-xl);
          font-family: var(--font-heading);
          font-weight: 700;
        }

        .wf-modal__close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          border: none;
          background: var(--color-bg-secondary);
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .wf-modal__close:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text);
        }

        .wf-modal__body {
          padding: var(--space-6);
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}
