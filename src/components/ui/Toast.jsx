'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback(({ type = 'info', title, message, duration = 4000 }) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, title, message, duration }]);
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (message, title) => addToast({ type: 'success', message, title }),
    error: (message, title) => addToast({ type: 'error', message, title }),
    warning: (message, title) => addToast({ type: 'warning', message, title }),
    info: (message, title) => addToast({ type: 'info', message, title }),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="wf-toast-container">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>

      <style jsx>{`
        .wf-toast-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: var(--z-toast);
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 420px;
          width: 100%;
          pointer-events: none;
        }

        @media (max-width: 480px) {
          .wf-toast-container {
            right: 12px;
            left: 12px;
            bottom: 12px;
            max-width: none;
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }) {
  const [exiting, setExiting] = useState(false);

  const handleClose = () => {
    setExiting(true);
    setTimeout(onClose, 200);
  };

  const icons = {
    success: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    error: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
    warning: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    info: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  };

  return (
    <>
      <div className={`wf-toast wf-toast--${toast.type} ${exiting ? 'wf-toast--exit' : ''}`}>
        <span className="wf-toast__icon">{icons[toast.type]}</span>
        <div className="wf-toast__content">
          {toast.title && <strong className="wf-toast__title">{toast.title}</strong>}
          {toast.message && <p className="wf-toast__message">{toast.message}</p>}
        </div>
        <button className="wf-toast__close" onClick={handleClose} aria-label="Dismiss">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <style jsx>{`
        .wf-toast {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          border-radius: var(--radius-lg);
          background: var(--color-surface-elevated);
          border: 1px solid var(--color-border);
          box-shadow: var(--shadow-lg);
          animation: toastIn 0.3s ease-out;
          pointer-events: auto;
        }

        .wf-toast--exit {
          animation: toastOut 0.2s ease-in forwards;
        }

        .wf-toast--success .wf-toast__icon { color: var(--color-success); }
        .wf-toast--error .wf-toast__icon { color: var(--color-error); }
        .wf-toast--warning .wf-toast__icon { color: var(--color-warning); }
        .wf-toast--info .wf-toast__icon { color: var(--color-info); }

        .wf-toast__icon {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .wf-toast__content {
          flex: 1;
          min-width: 0;
        }

        .wf-toast__title {
          display: block;
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--color-text);
          margin-bottom: 2px;
        }

        .wf-toast__message {
          font-size: var(--text-sm);
          color: var(--color-text-secondary);
          line-height: 1.4;
        }

        .wf-toast__close {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border: none;
          background: none;
          color: var(--color-text-tertiary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all var(--transition-fast);
        }

        .wf-toast__close:hover {
          background: var(--color-bg-secondary);
          color: var(--color-text);
        }

        @keyframes toastIn {
          from {
            opacity: 0;
            transform: translateX(100%) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }

        @keyframes toastOut {
          from {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateX(100%) scale(0.9);
          }
        }
      `}</style>
    </>
  );
}

const noopToast = {
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
};

export function useToast() {
  const context = useContext(ToastContext);
  // Return no-op during SSR/static generation
  if (!context) return noopToast;
  return context;
}
