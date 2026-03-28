'use client';

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = 'button',
  className = '',
  ...props
}) {
  const baseClass = `wf-btn wf-btn--${variant} wf-btn--${size}${fullWidth ? ' wf-btn--full' : ''}${loading ? ' wf-btn--loading' : ''} ${className}`;

  return (
    <>
      <button
        type={type}
        className={baseClass}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="wf-btn__spinner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </span>
        )}
        {!loading && icon && <span className="wf-btn__icon">{icon}</span>}
        <span className="wf-btn__label">{children}</span>
        {!loading && iconRight && <span className="wf-btn__icon wf-btn__icon--right">{iconRight}</span>}
      </button>

      <style jsx>{`
        .wf-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-family: var(--font-body);
          font-weight: 600;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all var(--transition-base);
          white-space: nowrap;
          position: relative;
          overflow: hidden;
          letter-spacing: 0.01em;
        }

        .wf-btn::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(rgba(255,255,255,0.1), transparent);
          opacity: 0;
          transition: opacity var(--transition-fast);
        }

        .wf-btn:hover::after {
          opacity: 1;
        }

        .wf-btn:active {
          transform: scale(0.97);
        }

        .wf-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        /* Sizes */
        .wf-btn--sm {
          padding: 8px 16px;
          font-size: var(--text-sm);
          border-radius: var(--radius-sm);
        }

        .wf-btn--md {
          padding: 12px 24px;
          font-size: var(--text-base);
        }

        .wf-btn--lg {
          padding: 16px 32px;
          font-size: var(--text-lg);
          border-radius: var(--radius-lg);
        }

        /* Variants */
        .wf-btn--primary {
          background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
          color: var(--color-text-on-primary);
          box-shadow: var(--shadow-sm), 0 0 0 0 rgba(var(--color-primary-rgb), 0);
        }

        .wf-btn--primary:hover:not(:disabled) {
          box-shadow: var(--shadow-md), 0 0 20px rgba(var(--color-primary-rgb), 0.3);
          transform: translateY(-1px);
        }

        .wf-btn--secondary {
          background: var(--color-surface);
          color: var(--color-text);
          border: 1px solid var(--color-border);
        }

        .wf-btn--secondary:hover:not(:disabled) {
          background: var(--color-surface-hover);
          border-color: var(--color-primary-light);
          box-shadow: var(--shadow-sm);
        }

        .wf-btn--ghost {
          background: transparent;
          color: var(--color-text-secondary);
        }

        .wf-btn--ghost:hover:not(:disabled) {
          background: var(--color-bg-secondary);
          color: var(--color-text);
        }

        .wf-btn--accent {
          background: linear-gradient(135deg, var(--color-accent), var(--color-accent-dark));
          color: white;
        }

        .wf-btn--accent:hover:not(:disabled) {
          box-shadow: var(--shadow-md);
          transform: translateY(-1px);
        }

        .wf-btn--success {
          background: var(--color-success);
          color: white;
        }

        .wf-btn--danger {
          background: var(--color-error);
          color: white;
        }

        /* Full Width */
        .wf-btn--full {
          width: 100%;
        }

        /* Spinner */
        .wf-btn__spinner {
          display: flex;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Icon */
        .wf-btn__icon {
          display: flex;
          flex-shrink: 0;
        }
      `}</style>
    </>
  );
}
