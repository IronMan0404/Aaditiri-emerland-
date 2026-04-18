import { NextResponse } from 'next/server';

// Two modes:
//   ?lat=&lon=   \u2192 reverse-geocode using Nominatim (OpenStreetMap), returns city/region/country
//   ?q=<name>    \u2192 forward-search using Open-Meteo geocoding, returns up to 8 candidates
//
// Both upstream services are free and require no API key. Nominatim's
// usage policy asks for ~1 req/sec and a real User-Agent, which is fine
// because we cache responses for 24h and we proxy them server-side.

export const revalidate = 86400;

interface ReverseResult {
  city: string;
  region?: string;
  country?: string;
  lat: number;
  lon: number;
}

interface SearchResult {
  city: string;
  region?: string;
  country?: string;
  lat: number;
  lon: number;
  countryCode?: string;
}

async function reverse(lat: number, lon: number): Promise<ReverseResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        // Nominatim's policy explicitly requires identifying the application.
        'User-Agent': 'AaditriEmerland/1.0 (community app; admin@aaditri-emerland.local)',
        Accept: 'application/json',
      },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const addr = json.address ?? {};
    const city: string =
      addr.city || addr.town || addr.village || addr.suburb || addr.county || json.name || 'Your location';
    return {
      city,
      region: addr.state,
      country: addr.country,
      lat,
      lon,
    };
  } catch {
    return null;
  }
}

async function search(q: string): Promise<SearchResult[]> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return [];
    const json = await res.json();
    const results = Array.isArray(json.results) ? json.results : [];
    return results.map((r: {
      name: string; admin1?: string; country?: string; country_code?: string;
      latitude: number; longitude: number;
    }) => ({
      city: r.name,
      region: r.admin1,
      country: r.country,
      countryCode: r.country_code,
      lat: r.latitude,
      lon: r.longitude,
    }));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latStr = url.searchParams.get('lat');
  const lonStr = url.searchParams.get('lon');
  const q = url.searchParams.get('q');

  if (latStr && lonStr) {
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
    }
    const result = await reverse(lat, lon);
    if (!result) return NextResponse.json({ error: 'Reverse geocode failed' }, { status: 502 });
    return NextResponse.json(result);
  }

  if (q && q.trim().length >= 2) {
    const results = await search(q.trim());
    return NextResponse.json({ results });
  }

  return NextResponse.json(
    { error: 'Pass either lat+lon (reverse) or q (search)' },
    { status: 400 }
  );
}
