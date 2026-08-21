import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/requireUser';
import { lookupPlace } from '@/lib/placeLookup';

/**
 * Place lookup for activity locations.
 *
 * The provider logic lives in @/lib/placeLookup so the generate route can resolve
 * coordinates server-side before the conflict checker runs — the checker cannot
 * judge travel time between two places it has no coordinates for.
 */
export async function GET(request) {
  // These routes spend the operator's Google and Groq quota, so they must
  // not be callable anonymously.
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const nearLat = parseFloat(searchParams.get('lat'));
  const nearLng = parseFloat(searchParams.get('lng'));

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 });
  }

  const near =
    Number.isFinite(nearLat) && Number.isFinite(nearLng)
      ? { lat: nearLat, lng: nearLng }
      : null;

  try {
    const { results, source } = await lookupPlace(query, near);
    return NextResponse.json({ results, source });
  } catch (err) {
    return NextResponse.json({ error: err.message, results: [] }, { status: 500 });
  }
}
