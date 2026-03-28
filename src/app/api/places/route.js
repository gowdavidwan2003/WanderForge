import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const radius = searchParams.get('radius') || '1000'; // meters
  const category = searchParams.get('category') || 'tourism';

  if (!lat || !lng) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }

  try {
    // Use Overpass API for nearby places
    const overpassCategories = {
      tourism: '"tourism"~"attraction|museum|viewpoint|gallery|artwork|zoo|theme_park"',
      food: '"amenity"~"restaurant|cafe|fast_food|bar|pub|food_court"',
      nature: '"natural"~"peak|water|beach|cliff|cave_entrance"',
      shopping: '"shop"~"mall|supermarket|gift|clothes|books"',
      nightlife: '"amenity"~"nightclub|bar|pub|casino"',
      culture: '"amenity"~"theatre|cinema|library|arts_centre"',
      transport: '"amenity"~"bus_station|ferry_terminal" or "railway"~"station"',
    };

    const filter = overpassCategories[category] || overpassCategories.tourism;
    
    const query = `
      [out:json][timeout:10];
      (
        node[${filter}](around:${radius},${lat},${lng});
        way[${filter}](around:${radius},${lat},${lng});
      );
      out center 20;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) throw new Error('Overpass API error');

    const data = await response.json();
    
    const places = data.elements
      .filter((el) => el.tags?.name)
      .map((el) => ({
        id: el.id,
        name: el.tags.name,
        type: el.tags.tourism || el.tags.amenity || el.tags.shop || el.tags.natural || 'place',
        lat: el.lat || el.center?.lat,
        lng: el.lon || el.center?.lon,
        description: el.tags.description || el.tags['description:en'] || '',
        website: el.tags.website || '',
        phone: el.tags.phone || '',
        opening_hours: el.tags.opening_hours || '',
        cuisine: el.tags.cuisine || '',
        wheelchair: el.tags.wheelchair || '',
      }))
      .filter(p => p.lat && p.lng);

    return NextResponse.json({ places });
  } catch (err) {
    return NextResponse.json({ error: err.message, places: [] }, { status: 500 });
  }
}
