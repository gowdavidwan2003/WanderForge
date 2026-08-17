import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/requireUser';

const ORS_PROFILE = {
  car: 'driving-car',
  mixed: 'driving-car',
  public_transit: 'driving-car',
  flight: 'driving-car',
  bike: 'cycling-regular',
  walking: 'foot-walking',
};

const GOOGLE_MODE = {
  car: 'DRIVE',
  mixed: 'DRIVE',
  flight: 'DRIVE',
  public_transit: 'TRANSIT',
  bike: 'BICYCLE',
  walking: 'WALK',
};

/**
 * Real road distances and durations between consecutive itinerary stops.
 *
 * Google's Routes API is the more accurate source, especially on mountain roads
 * where OpenRouteService is optimistic (it returns 30 min for a ghat climb Google
 * puts at 47). The batched computeRouteMatrix endpoint requires billing, so this
 * issues one computeRoutes call per leg and falls back to the ORS matrix when
 * Google is unavailable, rate-limited, or not configured.
 */

async function googleLeg(apiKey, from, to, mode) {
  const travelMode = GOOGLE_MODE[mode] || 'DRIVE';

  const body = {
    origin: { location: { latLng: { latitude: from[1], longitude: from[0] } } },
    destination: { location: { latLng: { latitude: to[1], longitude: to[0] } } },
    travelMode,
  };
  // Traffic-aware routing is only valid for DRIVE, and better reflects what a
  // traveler actually sees in the Google Maps app.
  if (travelMode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Google Routes ${res.status}`);

  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('No route returned');

  // Durations come back as protobuf-style strings, e.g. "2809s".
  const secs = parseFloat(String(route.duration || '').replace('s', ''));
  return {
    km: (route.distanceMeters ?? 0) / 1000,
    minutes: Number.isFinite(secs) ? secs / 60 : null,
  };
}

async function orsMatrix(apiKey, coordinates, mode) {
  const profile = ORS_PROFILE[mode] || ORS_PROFILE.car;
  const res = await fetch(`https://api.openrouteservice.org/v2/matrix/${profile}`, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: coordinates, metrics: ['duration', 'distance'] }),
  });
  if (!res.ok) throw new Error(`ORS ${res.status}`);

  const data = await res.json();
  const legs = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const meters = data.distances?.[i]?.[i + 1];
    const seconds = data.durations?.[i]?.[i + 1];
    legs.push({
      from: i,
      to: i + 1,
      km: typeof meters === 'number' ? meters / 1000 : null,
      minutes: typeof seconds === 'number' ? seconds / 60 : null,
    });
  }
  return legs;
}

export async function POST(request) {
  // These routes spend the operator's Google and Groq quota, so they must
  // not be callable anonymously.
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

    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    const orsKey =
      process.env.OPENROUTESERVICE_API_KEY || process.env.NEXT_PUBLIC_ORS_API_KEY;

    if (googleKey) {
      try {
        const legs = await Promise.all(
          coordinates.slice(0, -1).map(async (from, i) => {
            const leg = await googleLeg(googleKey, from, coordinates[i + 1], mode);
            return { from: i, to: i + 1, ...leg };
          })
        );
        return NextResponse.json({ legs, source: 'google' });
      } catch (err) {
        // Demo keys hit quota quickly; fall through rather than failing the check.
        console.warn('[WanderForge] Google Routes unavailable, falling back to ORS:', err.message);
      }
    }

    if (!orsKey) {
      return NextResponse.json({ error: 'Routing is not configured' }, { status: 503 });
    }

    const legs = await orsMatrix(orsKey, coordinates, mode);
    return NextResponse.json({ legs, source: 'ors' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
