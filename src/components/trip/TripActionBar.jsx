'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';

/**
 * The trip editor's action row.
 *
 * Nine buttons, every one of them `white-space: nowrap`, previously sat in a
 * single `flex-shrink: 0` row — roughly 1000px of content inside a 343px content
 * box on a 375px phone. The row could neither wrap nor shrink and the page has no
 * horizontal scroll, so the right-hand actions (including AI Generate, the
 * product's primary action) were rendered off-screen and unreachable. Travel
 * planning is a phone-first activity, so that was a total functional loss on the
 * majority device class.
 *
 * Secondary actions therefore collapse into an overflow menu below 768px, while
 * the primary action and the collaboration controls stay on the bar at every
 * width. Actions are passed as data rather than markup so the bar and the menu
 * cannot drift apart.
 *
 * @param actions        [{ key, label, icon, onClick, disabled, loading, variant, title }]
 * @param primaryAction  the one action that must never be hidden
 * @param children       always-visible leading content (collaboration/presence)
 */
export default function TripActionBar({ actions = [], primaryAction, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const overflowRef = useRef(null);

  // A menu that cannot be dismissed by clicking away or pressing Escape traps
  // phone users, who have no other way out of it.
  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (e) => {
      if (!overflowRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const runAction = (action) => {
    setMenuOpen(false);
    action.onClick?.();
  };

  return (
    <div className="action-bar">
      {children}

      <div className="action-bar__inline">
        {actions.map((action) => (
          <Button
            key={action.key}
            variant={action.variant || 'ghost'}
            size="sm"
            onClick={action.onClick}
            loading={!!action.loading}
            disabled={!!action.disabled}
            icon={<span>{action.icon}</span>}
            title={action.title}
          >
            {action.label}
          </Button>
        ))}
      </div>

      <div className="action-bar__overflow" ref={overflowRef}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMenuOpen((open) => !open)}
          icon={<span>☰</span>}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title="More trip actions"
        >
          More
        </Button>

        {menuOpen && (
          <div className="action-menu" role="menu">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                className="action-menu__item"
                onClick={() => runAction(action)}
                disabled={!!action.disabled || !!action.loading}
                title={action.title}
              >
                <span className="action-menu__icon">{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {primaryAction && (
        <Button
          variant="primary"
          size="sm"
          onClick={primaryAction.onClick}
          loading={!!primaryAction.loading}
          disabled={!!primaryAction.disabled}
          icon={<span>{primaryAction.icon}</span>}
          title={primaryAction.title}
        >
          {primaryAction.label}
        </Button>
      )}

      <style jsx>{`
        .action-bar {
          position: relative;
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-wrap: wrap;
          justify-content: flex-end;
          min-width: 0;
        }

        .action-bar__inline {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-wrap: wrap;
          justify-content: flex-end;
          min-width: 0;
        }

        /* Hidden on desktop, where every action fits on the bar itself. */
        .action-bar__overflow {
          display: none;
          position: relative;
        }

        .action-menu {
          position: absolute;
          top: calc(100% + var(--space-2));
          right: 0;
          z-index: 200;
          min-width: 216px;
          display: flex;
          flex-direction: column;
          padding: var(--space-2);
          gap: 2px;
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: var(--radius-lg);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        }

        .action-menu__item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          width: 100%;
          padding: var(--space-3);
          border: none;
          border-radius: var(--radius-md);
          background: none;
          color: var(--color-text-primary);
          font-family: var(--font-body);
          font-size: var(--text-sm);
          text-align: left;
          cursor: pointer;
        }

        .action-menu__item:hover:not(:disabled) {
          background: var(--color-surface-hover, rgba(127, 127, 127, 0.12));
        }

        .action-menu__item:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: -2px;
        }

        .action-menu__item:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .action-menu__icon {
          font-size: 16px;
          flex-shrink: 0;
        }

        @media (max-width: 768px) {
          .action-bar {
            justify-content: flex-start;
            width: 100%;
          }

          /* Secondary actions move into the menu so the primary one always fits. */
          .action-bar__inline {
            display: none;
          }

          .action-bar__overflow {
            display: block;
            /* Anchoring the menu to this button clipped it: the bar wraps, so the
               button can sit mid-row, and a right-aligned 216px panel then hangs
               off the left edge of a 375px screen. Going static hands the menu's
               containing block to .action-bar, which spans the full width. */
            position: static;
          }

          .action-menu {
            left: 0;
            right: 0;
            min-width: 0;
          }
        }
      `}</style>
    </div>
  );
}
