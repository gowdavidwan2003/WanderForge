'use client';

import Link from 'next/link';
import Button from '@/components/ui/Button';

/**
 * Shared full-page fallback for the error and not-found boundaries.
 *
 * Before this existed the app had no convention files at all, so any throw
 * during render — a bad row from Supabase, a Leaflet failure, a ReferenceError
 * in a panel — unwound to Next's built-in root handler and replaced the page
 * with an unstyled "Application error" screen offering no retry and no way back.
 *
 * `onRetry` should be the boundary's `unstable_retry`, which re-fetches and
 * re-renders the failed segment rather than only clearing the error state.
 */
export default function ErrorScreen({
  emoji = '🧭',
  title,
  message,
  detail,
  onRetry,
  retryLabel = 'Try again',
  homeHref = '/dashboard',
  homeLabel = 'Back to dashboard',
}) {
  return (
    <div className="err">
      <div className="err__card">
        <span className="err__emoji" aria-hidden="true">{emoji}</span>
        <h1 className="err__title">{title}</h1>
        <p className="err__message">{message}</p>

        {detail && <p className="err__detail">{detail}</p>}

        <div className="err__actions">
          {onRetry && (
            <Button variant="primary" size="md" onClick={() => onRetry()}>
              {retryLabel}
            </Button>
          )}
          <Link href={homeHref} className="err__link">{homeLabel}</Link>
        </div>
      </div>

      <style jsx>{`
        .err {
          min-height: 70vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-8, 32px) var(--space-4, 16px);
        }

        .err__card {
          width: 100%;
          max-width: 460px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-3, 12px);
        }

        .err__emoji {
          font-size: 48px;
          line-height: 1;
        }

        .err__title {
          font-size: var(--text-2xl, 24px);
          margin: 0;
          color: var(--color-text-primary, #111);
        }

        .err__message {
          margin: 0;
          font-size: var(--text-base, 16px);
          line-height: 1.6;
          color: var(--color-text-secondary, #444);
        }

        .err__detail {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--text-xs, 12px);
          color: var(--color-text-tertiary, #777);
          word-break: break-word;
        }

        .err__actions {
          margin-top: var(--space-3, 12px);
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: var(--space-4, 16px);
        }

        .err__link {
          font-size: var(--text-sm, 14px);
          color: var(--color-primary, #4f46e5);
          font-weight: 600;
        }

        .err__link:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
