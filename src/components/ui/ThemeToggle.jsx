'use client';

import { useTheme } from '@/context/ThemeProvider';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      <div className="theme-toggle__track">
        <div className={`theme-toggle__thumb ${theme === 'dark' ? 'theme-toggle__thumb--dark' : ''}`}>
          {theme === 'light' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </div>
      </div>

      <style jsx>{`
        .theme-toggle {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
        }

        .theme-toggle__track {
          width: 48px;
          height: 26px;
          border-radius: 13px;
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          position: relative;
          transition: background var(--transition-base);
        }

        .theme-toggle__thumb {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--color-primary);
          position: absolute;
          top: 1px;
          left: 1px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-on-primary);
          transition: transform var(--transition-spring);
          box-shadow: var(--shadow-sm);
        }

        .theme-toggle__thumb--dark {
          transform: translateX(22px);
        }
      `}</style>
    </button>
  );
}
