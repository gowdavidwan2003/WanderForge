import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/requireUser';
import { resolveLegs } from '@/lib/routeLookup';
import { legKey } from '@/lib/routeCache';
import { getGeocodeCacheClients } from '@/lib/api/geocodeCacheClients';

/**
 * Real road distances and durations between consecutive stops.
 *
 * The provider logic moved to @/lib/routeLookup so the generate route can
 * measure a plan before deciding whether to re-prompt about it, and so both
 * paths share one cache. Google Routes is billed per leg; without the cache in
 * front of it, opening a trip would re-bill every journey on it.
 */
export async function POST(request) {
  // These routes spend the operator's Google quota, so they must not be
  // callable anonymously.
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const { coordinates, mode = 'car' } = await request.json();

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return NextResponse.json(
        { error: 'At least two [lng, lat] coordinates are required' },
        { status: 400 }
      );
    }
    if (coordinates.length > 25) {
      return NextResponse.json({ error: 'Too many coordinates (max 25)' }, { status: 400 });
    }

    // Consecutive pairs along the chain, which is what the caller is asking for.
    const pairs = [];
    for (let i = 0; i < coordinates.length - 1; i++) {
      pairs.push({
        from: { lat: coordinates[i][1], lng: coordinates[i][0] },
        to: { lat: coordinates[i + 1][1], lng: coordinates[i + 1][0] },
      });
    }

    const cache = await getGeocodeCacheClients();
    const { legs, stats } = await resolveLegs(pairs, { mode, cache });

    return NextResponse.json({
      // Indexed form, for callers that want the chain back in order.
      legs: pairs.map((p, i) => ({ from: i, to: i + 1, ...(legs[legKey(p.from, p.to)] || {}) })),
      // Keyed form, ready to pass straight to checkItinerary.
      roadLegs: legs,
      stats,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
