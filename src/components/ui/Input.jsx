'use client';

import { useState } from 'react';

export default function Input({
  label,
  type = 'text',
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  required = false,
  disabled = false,
  id,
  name,
  className = '',
  ...props
}) {
  const [focused, setFocused] = useState(false);
  const inputId = id || name || label?.toLowerCase().replace(/\s/g, '-');

  return (
    <>
      <div className={`wf-input-group ${error ? 'wf-input-group--error' : ''} ${focused ? 'wf-input-group--focused' : ''} ${className}`}>
        {label && (
          <label htmlFor={inputId} className="wf-input-group__label">
            {label}
            {required && <span className="wf-input-group__required">*</span>}
          </label>
        )}
        <div className="wf-input-group__wrapper">
          {icon && <span className="wf-input-group__icon">{icon}</span>}
          <input
            id={inputId}
            name={name}
            type={type}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            required={required}
            disabled={disabled}
            className={`wf-input ${icon ? 'wf-input--with-icon' : ''}`}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            {...props}
          />
        </div>
        {error && <p className="wf-input-group__error">{error}</p>}
        {hint && !error && <p className="wf-input-group__hint">{hint}</p>}
      </div>

      <style jsx>{`
        .wf-input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .wf-input-group__label {
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-text);
        }

        .wf-input-group__required {
          color: var(--color-error);
          margin-left: 2px;
        }

        .wf-input-group__wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .wf-input-group__icon {
          position: absolute;
          left: 14px;
          color: var(--color-text-tertiary);
          display: flex;
          pointer-events: none;
          transition: color var(--transition-fast);
        }

        .wf-input-group--focused .wf-input-group__icon {
          color: var(--color-primary);
        }

        .wf-input {
          width: 100%;
          padding: 12px 16px;
          font-family: var(--font-body);
          font-size: var(--text-base);
          color: var(--color-text);
          background: var(--color-surface);
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md);
          outline: none;
          transition: all var(--transition-base);
        }

        .wf-input--with-icon {
          padding-left: 44px;
        }

        .wf-input::placeholder {
          color: var(--color-text-tertiary);
        }

        .wf-input:hover:not(:disabled) {
          border-color: var(--color-primary-light);
        }

        .wf-input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.15);
        }

        .wf-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: var(--color-bg-secondary);
        }

        .wf-input-group--error .wf-input {
          border-color: var(--color-error);
        }

        .wf-input-group--error .wf-input:focus {
          box-shadow: 0 0 0 3px rgba(198, 40, 40, 0.15);
        }

        .wf-input-group__error {
          font-size: var(--text-sm);
          color: var(--color-error);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .wf-input-group__hint {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
        }
      `}</style>
    </>
  );
}
