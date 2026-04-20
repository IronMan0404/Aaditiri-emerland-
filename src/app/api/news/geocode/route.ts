import { NextResponse } from 'next/server';

// Two modes:
//   ?lat=&lon=   -> reverse-geocode using Nominatim (OpenStreetMap), returns
//                   locality (suburb/village/neighbourhood) + city + region
//                   + country. Resolved at zoom=14 so a user sitting in a
//                   village or suburb gets that specific name back, not just
//                   the parent district.
//   ?q=<name>    -> forward-search. Tries Nominatim first (covers villages,
//                   hamlets, suburbs, schools, landmarks), falls back to
//                   Open-Meteo geocoding (city-only but better-ranked for
//                   ambiguous city names like "Springfield").
//
// Both upstream services are free and require no API key. Nominatim's
// usage policy asks for ~1 req/sec and a real User-Agent. We cache for
// 24h server-side and rate-limit ourselves naturally because every call
// is proxied through this route.

export const revalidate = 86400;

const NOMINATIM_UA =
  'AaditriEmerland/1.0 (community app; admin@aaditri-emerland.local)';

interface ReverseResult {
  // Most-specific human-readable place name we could resolve. This is what
  // the UI shows as the primary label, e.g. "Lingampally" or "Madhapur"
  // rather than "Hyderabad".
  locality: string;
  // Parent city / town. May equal locality when the user is in a city centre.
  city: string;
  region?: string;
  country?: string;
  // ISO 3166-1 alpha-2 country code, useful for flag emojis or i18n.
  countryCode?: string;
  // What kind of place locality is (suburb, village, town, hamlet, neighbourhood, ...)
  // so the UI can hint "Village in Telangana" vs "Suburb of Hyderabad".
  type?: string;
  lat: number;
  lon: number;
  // Pre-formatted "Locality, City, Region" string for direct display.
  displayName: string;
}

interface SearchResult {
  locality: string;
  city: string;
  region?: string;
  country?: string;
  countryCode?: string;
  type?: string;
  lat: number;
  lon: number;
  displayName: string;
}

// Nominatim returns dozens of address components. Pick the most specific
// one available, in increasing-locality order.
type NominatimAddress = {
  neighbourhood?: string;
  suburb?: string;
  hamlet?: string;
  village?: string;
  town?: string;
  city_district?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state_district?: string;
  state?: string;
  country?: string;
  country_code?: string;
};

function pickLocality(addr: NominatimAddress, fallbackName: string): string {
  return (
    addr.neighbourhood ||
    addr.suburb ||
    addr.hamlet ||
    addr.village ||
    addr.town ||
    addr.city_district ||
    addr.city ||
    addr.municipality ||
    addr.county ||
    fallbackName ||
    'Your location'
  );
}

function pickCity(addr: NominatimAddress, fallbackName: string): string {
  return (
    addr.city ||
    addr.town ||
    addr.municipality ||
    addr.village ||
    addr.county ||
    addr.state_district ||
    fallbackName ||
    'Your location'
  );
}

function buildDisplayName(parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const key = p.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(', ');
}

async function reverse(lat: number, lon: number): Promise<ReverseResult | null> {
  try {
    // zoom=14 lands at the suburb / village / neighbourhood layer. zoom=10
    // (the previous default) collapsed everything to "Hyderabad" even when
    // the user was actually in a specific village or layout 30km out.
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?lat=${lat}&lon=${lon}` +
      `&format=jsonv2&zoom=14&addressdetails=1&accept-language=en`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': NOMINATIM_UA,
        Accept: 'application/json',
      },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      name?: string;
      type?: string;
      address?: NominatimAddress;
    };
    const addr = json.address ?? {};
    const fallbackName = json.name ?? '';
    const locality = pickLocality(addr, fallbackName);
    const city = pickCity(addr, fallbackName);
    return {
      locality,
      city,
      region: addr.state,
      country: addr.country,
      countryCode: addr.country_code?.toUpperCase(),
      type: json.type,
      lat,
      lon,
      displayName: buildDisplayName([locality, city, addr.state]),
    };
  } catch {
    return null;
  }
}

// Forward search via Nominatim. Returns up to 8 results so we can offer
// the user a choice between, say, "Madhapur, Hyderabad" and the smaller
// "Madhapur, Karimnagar". featuretype is intentionally not constrained so
// villages and hamlets are included alongside cities.
async function searchNominatim(q: string): Promise<SearchResult[]> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(q)}` +
      `&format=jsonv2&addressdetails=1&limit=8&accept-language=en`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': NOMINATIM_UA,
        Accept: 'application/json',
      },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{
      lat: string;
      lon: string;
      name?: string;
      display_name?: string;
      type?: string;
      address?: NominatimAddress;
    }>;
    if (!Array.isArray(json)) return [];
    const out: SearchResult[] = [];
    for (const r of json) {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const addr = r.address ?? {};
      const fallbackName = r.name ?? '';
      const locality = pickLocality(addr, fallbackName);
      const city = pickCity(addr, fallbackName);
      out.push({
        locality,
        city,
        region: addr.state,
        country: addr.country,
        countryCode: addr.country_code?.toUpperCase(),
        type: r.type,
        lat,
        lon,
        displayName: buildDisplayName([locality, city, addr.state, addr.country]),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// Fallback search via Open-Meteo. Only city-level, but it's well-ranked for
// ambiguous city names. We use it when Nominatim returns nothing.
async function searchOpenMeteo(q: string): Promise<SearchResult[]> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      q,
    )}&count=8&language=en&format=json`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: Array<{
        name: string;
        admin1?: string;
        admin2?: string;
        country?: string;
        country_code?: string;
        feature_code?: string;
        latitude: number;
        longitude: number;
      }>;
    };
    const results = Array.isArray(json.results) ? json.results : [];
    return results.map((r) => ({
      locality: r.name,
      city: r.name,
      region: r.admin1,
      country: r.country,
      countryCode: r.country_code,
      type: r.feature_code,
      lat: r.latitude,
      lon: r.longitude,
      displayName: buildDisplayName([r.name, r.admin1, r.country]),
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
    // Try Nominatim first (covers villages + suburbs), fall back to
    // Open-Meteo if it has nothing. This means searching "Lingampally"
    // or "Tellapur" actually returns hits, while "Springfield" still
    // benefits from Open-Meteo's better disambiguation when Nominatim
    // is ambiguous.
    let results = await searchNominatim(q.trim());
    if (results.length === 0) {
      results = await searchOpenMeteo(q.trim());
    }
    return NextResponse.json({ results });
  }

  return NextResponse.json(
    { error: 'Pass either lat+lon (reverse) or q (search)' },
    { status: 400 },
  );
}
