'use client';

import dynamic from 'next/dynamic';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

/**
 * Leaflet, loaded on the client, without the page jumping when it arrives.
 *
 * The placeholder used to be a hardcoded 400px while every caller renders the
 * map at a different height — the trip editor asks for 350px. So the box was
 * 400px tall until the chunk downloaded and then snapped to 350, moving
 * everything below it by 50px at the exact moment the user was most likely to be
 * reaching for something. next/dynamic's `loading` renders before the real
 * component and receives none of its props, which is how the two drifted apart.
 *
 * Reserving the space on the wrapper instead means the box is the right size
 * from the first paint, whatever the caller asked for, and the map fills it in.
 * Leaflet also needs a parent with a real height or it renders at zero and shows
 * nothing at all.
 */

const MapSkeleton = () => (
  <div className="map-skeleton" aria-hidden="true">
    <LoadingSpinner size={32} />
    <style jsx>{`
      .map-skeleton {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg-secondary);
        border-radius: var(--radius-xl);
        border: 1px solid var(--color-border-light);
      }
    `}</style>
  </div>
);

const TripMap = dynamic(() => import('./TripMap'), {
  ssr: false,
  loading: MapSkeleton,
});

export default function DynamicMap({ height = '400px', ...props }) {
  return (
    // The reserved box. Both the skeleton and the map fill it exactly, so
    // nothing below moves when one is swapped for the other.
    <div
      className="map-slot"
      style={{ height }}
      // The map is a visual aid for a list that is already on the page in full.
      // Announcing "map" and then nothing useful is worse than staying quiet;
      // every marker's information is in the itinerary above it.
      role="presentation"
    >
      <TripMap height="100%" {...props} />
      <style jsx>{`
        .map-slot {
          width: 100%;
          /* Below this the map is too small to read on a phone, and the caller's
             pixel height was chosen for a desktop column. */
          min-height: 220px;
          overflow: hidden;
          border-radius: var(--radius-xl);
        }
      `}</style>
    </div>
  );
}
