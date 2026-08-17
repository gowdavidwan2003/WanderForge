'use client'; // Error boundaries must be Client Components.

import { useEffect } from 'react';
import ErrorScreen from '@/components/layout/ErrorScreen';

/**
 * Segment boundary for the trip editor.
 *
 * The editor mounts the riskiest parts of the app — Leaflet, the AI chat panel,
 * the expense and booking panels — and errors bubble to the nearest boundary.
 * Without this one, a Leaflet tile failure took down the whole application
 * instead of just the page the user was on, losing the surrounding shell.
 */
export default function TripEditorError({ error, unstable_retry }) {
  useEffect(() => {
    console.error('[WanderForge] Trip editor error:', error);
  }, [error]);

  return (
    <ErrorScreen
      emoji="🧳"
      title="This trip would not open"
      message="Something went wrong loading the editor. Your itinerary is stored safely — nothing was lost."
      detail={error?.digest ? `Reference: ${error.digest}` : error?.message}
      onRetry={unstable_retry}
    />
  );
}
