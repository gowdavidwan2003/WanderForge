'use client'; // Error boundaries must be Client Components.

import { useEffect } from 'react';
import ErrorScreen from '@/components/layout/ErrorScreen';

/**
 * Catch-all boundary for anything thrown while rendering a route under src/app.
 *
 * `unstable_retry` is the Next 16.2 prop — it re-fetches and re-renders the
 * segment, where the older `reset` only clears the boundary's error state.
 */
export default function AppError({ error, unstable_retry }) {
  useEffect(() => {
    // Until error tracking lands (S3-5) the console is the only record.
    console.error('[WanderForge] Unhandled render error:', error);
  }, [error]);

  return (
    <ErrorScreen
      emoji="🧭"
      title="We lost the thread"
      message="Something broke while loading this page. Your trips are safe — nothing was changed."
      detail={error?.digest ? `Reference: ${error.digest}` : error?.message}
      onRetry={unstable_retry}
    />
  );
}
