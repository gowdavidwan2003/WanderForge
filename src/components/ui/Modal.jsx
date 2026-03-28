'use client';

import { useEffect, useRef } from 'react';

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showClose = true,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="wf-modal-backdrop" onClick={onClose}>
        <div
          ref={dialogRef}
          className={`wf-modal wf-modal--${size}`}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {(title || showClose) && (
            <div className="wf-modal__header">
              {title && <h3 className="wf-modal__title">{title}</h3>}
              {showClose && (
                <button className="wf-modal__close" onClick={onClose} aria-label="Close modal">
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
