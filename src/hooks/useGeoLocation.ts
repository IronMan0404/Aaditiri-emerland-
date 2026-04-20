'use client';
import { useCallback, useEffect, useState } from 'react';

// Default fallback. We hard-code the community's home city so a user who
// denies location permission still sees something useful.
export const HYDERABAD: ResolvedLocation = {
  lat: 17.385,
  lon: 78.4867,
  locality: 'Hyderabad',
  city: 'Hyderabad',
  region: 'Telangana',
  country: 'India',
  countryCode: 'IN',
  displayName: 'Hyderabad, Telangana',
  source: 'fallback',
};

export interface ResolvedLocation {
  lat: number;
  lon: number;
  // Most-specific human-readable place name we could resolve. This is the
  // primary label shown in the UI \u2014 e.g. "Lingampally" or "Madhapur"
  // instead of just "Hyderabad". Falls back to `city` when we couldn't get
  // a finer level (city-centre coords, or Open-Meteo search hits).
  locality: string;
  // Parent city / town. May equal `locality` when we're already in a city centre.
  city: string;
  region?: string;
  country?: string;
  countryCode?: string;
  // Pre-formatted "Locality, City, Region" string from the geocode API.
  // Use this when you want the full place name in one line.
  displayName?: string;
  // What kind of place locality is (suburb, village, town, hamlet, ...) \u2014
  // optional, only used by the picker for the secondary subtitle.
  type?: string;
  // Where we got this from \u2014 useful for the UI ("\ud83d\udccd Auto-detected" vs "Manual").
  source: 'geolocation' | 'manual' | 'fallback';
}

interface PersistedLocation extends ResolvedLocation {
  // ms epoch \u2014 we re-prompt for geolocation if the cached value is older
  // than a week, so the user isn't locked into a stale city forever.
  cachedAt: number;
}

// Why a geolocation attempt failed. Used by the UI to show a specific,
// actionable message instead of a generic "unable to detect".
export type GeoDenialReason =
  | 'permission'      // user (or browser policy) blocked the prompt
  | 'timeout'         // GPS didn't lock in time
  | 'unavailable'     // device knows it can't fix a location right now
  | 'unsupported'     // navigator.geolocation missing entirely
  | 'insecure'        // page not served over HTTPS / secure context
  | 'reverse_geocode' // we got coords but couldn't resolve a city name
  | null;

interface GeoState {
  location: ResolvedLocation;
  status: 'loading' | 'ready' | 'denied' | 'error';
  // True only on the first render before we've hydrated from localStorage.
  // Components should suppress UI flicker until this flips false.
  hydrating: boolean;
  // Populated whenever status flips to 'denied' or 'error'. Cleared on success.
  denialReason: GeoDenialReason;
}

const STORAGE_KEY = 'ae-news-location';
const PROMPT_FLAG = 'ae-news-geo-prompted';
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function readPersisted(): PersistedLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedLocation> & {
      lat?: number;
      lon?: number;
      city?: string;
    };
    if (typeof parsed.lat !== 'number' || typeof parsed.lon !== 'number') return null;
    // Backfill fields added in newer versions of the schema. Old persisted
    // entries had {lat, lon, city, source, cachedAt} only \u2014 we now require
    // `locality` and prefer a `displayName`. Fill them in from `city` so the
    // first render after an upgrade doesn't crash.
    const city = parsed.city ?? 'Your location';
    const locality = parsed.locality ?? city;
    return {
      lat: parsed.lat,
      lon: parsed.lon,
      locality,
      city,
      region: parsed.region,
      country: parsed.country,
      countryCode: parsed.countryCode,
      type: parsed.type,
      displayName:
        parsed.displayName ??
        [locality, city, parsed.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '),
      source: parsed.source ?? 'manual',
      cachedAt: parsed.cachedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

function writePersisted(loc: ResolvedLocation) {
  try {
    const value: PersistedLocation = { ...loc, cachedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be disabled (private mode); silently ignore.
  }
}

// Reverse-geocode raw coords into a friendly city / region label by calling
// our own /api/news/geocode (which proxies Nominatim and adds caching).
// Throws a tagged error on failure so callers can distinguish a reverse-geocode
// problem from an outright geolocation failure.
class ReverseGeocodeError extends Error {
  constructor() { super('Reverse geocode failed'); this.name = 'ReverseGeocodeError'; }
}

async function reverseGeocode(lat: number, lon: number): Promise<ResolvedLocation> {
  const res = await fetch(`/api/news/geocode?lat=${lat}&lon=${lon}`, { cache: 'force-cache' });
  if (!res.ok) throw new ReverseGeocodeError();
  const json = (await res.json()) as {
    locality?: string;
    city?: string;
    region?: string;
    country?: string;
    countryCode?: string;
    type?: string;
    displayName?: string;
  };
  const city = json.city || json.locality || 'Your location';
  const locality = json.locality || city;
  return {
    lat,
    lon,
    locality,
    city,
    region: json.region,
    country: json.country,
    countryCode: json.countryCode,
    type: json.type,
    displayName: json.displayName || [locality, city, json.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '),
    source: 'geolocation',
  };
}

// Coords-only fallback used when reverse geocode fails but we DO have a
// fix from the browser. Keeps the location object well-formed so the rest
// of the UI doesn't have to special-case missing fields.
function coordsOnlyLocation(lat: number, lon: number): ResolvedLocation {
  const label = `Near ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  return {
    lat,
    lon,
    locality: label,
    city: label,
    displayName: label,
    source: 'geolocation',
  };
}

// Tagged error so the hook can distinguish each browser-level failure mode
// without leaking the raw GeolocationPositionError shape into UI code.
class GeoError extends Error {
  reason: GeoDenialReason;
  constructor(reason: GeoDenialReason, message: string) {
    super(message);
    this.name = 'GeoError';
    this.reason = reason;
  }
}

function requestBrowserGeolocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('unsupported', 'Geolocation not supported by this browser'));
      return;
    }
    // Browsers silently fail (or return a misleading "permission denied")
    // when the page isn't a secure context. Catch this up-front so the UI
    // can tell the user to switch to https.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      reject(new GeoError('insecure', 'Location requires a secure (https) connection'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => {
        // GeolocationPositionError codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
        let reason: GeoDenialReason = 'unavailable';
        if (err && typeof err.code === 'number') {
          if (err.code === 1) reason = 'permission';
          else if (err.code === 2) reason = 'unavailable';
          else if (err.code === 3) reason = 'timeout';
        }
        reject(new GeoError(reason, err?.message || 'Geolocation failed'));
      },
      // 15s timeout (was 8s) — mobile GPS often takes >8s on first lock,
      // especially indoors or right after the user grants permission.
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60 * 60 * 1000 }
    );
  });
}

// Narrow an unknown thrown value to a denial reason for state.
function toDenialReason(err: unknown): GeoDenialReason {
  if (err instanceof GeoError) return err.reason;
  if (err instanceof ReverseGeocodeError) return 'reverse_geocode';
  return 'unavailable';
}

export function useGeoLocation() {
  const [state, setState] = useState<GeoState>({
    location: HYDERABAD,
    status: 'ready',
    hydrating: true,
    denialReason: null,
  });

  // On mount: hydrate from localStorage if present, otherwise auto-prompt
  // ONCE. We track that we've prompted in a separate localStorage key so a
  // user who declines isn't pestered every page load.
  useEffect(() => {
    const persisted = readPersisted();
    if (persisted && Date.now() - persisted.cachedAt < STALE_AFTER_MS) {
      setState({ location: persisted, status: 'ready', hydrating: false, denialReason: null });
      return;
    }

    const alreadyPrompted = window.localStorage.getItem(PROMPT_FLAG) === '1';
    if (alreadyPrompted && !persisted) {
      // User previously declined or errored \u2014 don't prompt again, just use fallback.
      setState({ location: HYDERABAD, status: 'ready', hydrating: false, denialReason: null });
      return;
    }

    setState((s) => ({ ...s, hydrating: false, status: 'loading', denialReason: null }));
    requestBrowserGeolocation()
      .then(async ({ lat, lon }) => {
        try {
          const resolved = await reverseGeocode(lat, lon);
          writePersisted(resolved);
          window.localStorage.setItem(PROMPT_FLAG, '1');
          setState({ location: resolved, status: 'ready', hydrating: false, denialReason: null });
        } catch (err) {
          // We have coords but no city name. Show coords-as-location and
          // surface the reason so the picker can hint at retrying.
          const fallback = coordsOnlyLocation(lat, lon);
          writePersisted(fallback);
          window.localStorage.setItem(PROMPT_FLAG, '1');
          setState({
            location: fallback,
            status: 'ready',
            hydrating: false,
            denialReason: toDenialReason(err),
          });
        }
      })
      .catch((err: unknown) => {
        window.localStorage.setItem(PROMPT_FLAG, '1');
        setState({
          location: HYDERABAD,
          status: 'denied',
          hydrating: false,
          denialReason: toDenialReason(err),
        });
      });
  }, []);

  // Manually request (or re-request) geolocation \u2014 wired to the
  // "Use my location" / "Try again" buttons. Always reprompts the browser
  // and bypasses the PROMPT_FLAG suppression so the user can retry after
  // fixing browser permissions.
  const requestLocation = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', denialReason: null }));
    try {
      const { lat, lon } = await requestBrowserGeolocation();
      try {
        const resolved = await reverseGeocode(lat, lon);
        writePersisted(resolved);
        window.localStorage.setItem(PROMPT_FLAG, '1');
        setState({ location: resolved, status: 'ready', hydrating: false, denialReason: null });
        return resolved;
      } catch (err) {
        const fallback = coordsOnlyLocation(lat, lon);
        writePersisted(fallback);
        setState({
          location: fallback,
          status: 'ready',
          hydrating: false,
          denialReason: toDenialReason(err),
        });
        return fallback;
      }
    } catch (err: unknown) {
      setState((s) => ({ ...s, status: 'denied', denialReason: toDenialReason(err) }));
      return null;
    }
  }, []);

  // Set a city manually (from the search picker). Skips the browser geo prompt.
  const setManualLocation = useCallback((loc: Omit<ResolvedLocation, 'source'>) => {
    const next: ResolvedLocation = { ...loc, source: 'manual' };
    writePersisted(next);
    setState({ location: next, status: 'ready', hydrating: false, denialReason: null });
  }, []);

  // Reset back to the community default.
  const resetLocation = useCallback(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setState({ location: HYDERABAD, status: 'ready', hydrating: false, denialReason: null });
  }, []);

  return { ...state, requestLocation, setManualLocation, resetLocation };
}

// User-facing message for each denial reason. Exported so the picker (or any
// other component) can render a consistent explanation.
export function describeDenial(reason: GeoDenialReason): string | null {
  switch (reason) {
    case 'permission':
      return 'Location is blocked. Enable it for this site in your browser settings, then try again.';
    case 'timeout':
      return 'GPS took too long to respond. Try again from a window or outdoors.';
    case 'unavailable':
      return 'Your device couldn\u2019t determine a location right now. Try again in a moment.';
    case 'unsupported':
      return 'This browser doesn\u2019t support location detection.';
    case 'insecure':
      return 'Location only works over a secure (https) connection.';
    case 'reverse_geocode':
      return 'We got your coordinates, but couldn\u2019t look up the city name.';
    default:
      return null;
  }
}
