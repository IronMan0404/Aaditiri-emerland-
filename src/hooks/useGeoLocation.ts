'use client';
import { useCallback, useEffect, useState } from 'react';

// Default fallback. We hard-code the community's home city so a user who
// denies location permission still sees something useful.
export const HYDERABAD: ResolvedLocation = {
  lat: 17.385,
  lon: 78.4867,
  city: 'Hyderabad',
  region: 'Telangana',
  country: 'India',
  source: 'fallback',
};

export interface ResolvedLocation {
  lat: number;
  lon: number;
  city: string;
  region?: string;
  country?: string;
  // Where we got this from \u2014 useful for the UI ("\ud83d\udccd Auto-detected" vs "Manual").
  source: 'geolocation' | 'manual' | 'fallback';
}

interface PersistedLocation extends ResolvedLocation {
  // ms epoch \u2014 we re-prompt for geolocation if the cached value is older
  // than a week, so the user isn't locked into a stale city forever.
  cachedAt: number;
}

interface GeoState {
  location: ResolvedLocation;
  status: 'loading' | 'ready' | 'denied' | 'error';
  // True only on the first render before we've hydrated from localStorage.
  // Components should suppress UI flicker until this flips false.
  hydrating: boolean;
}

const STORAGE_KEY = 'ae-news-location';
const PROMPT_FLAG = 'ae-news-geo-prompted';
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function readPersisted(): PersistedLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLocation;
    if (typeof parsed.lat !== 'number' || typeof parsed.lon !== 'number') return null;
    return parsed;
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
async function reverseGeocode(lat: number, lon: number): Promise<ResolvedLocation> {
  try {
    const res = await fetch(`/api/news/geocode?lat=${lat}&lon=${lon}`, { cache: 'force-cache' });
    if (!res.ok) throw new Error('reverse geocode failed');
    const json = (await res.json()) as { city: string; region?: string; country?: string };
    return {
      lat,
      lon,
      city: json.city || 'Your location',
      region: json.region,
      country: json.country,
      source: 'geolocation',
    };
  } catch {
    return { lat, lon, city: 'Your location', source: 'geolocation' };
  }
}

function requestBrowserGeolocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
    );
  });
}

export function useGeoLocation() {
  const [state, setState] = useState<GeoState>({
    location: HYDERABAD,
    status: 'ready',
    hydrating: true,
  });

  // On mount: hydrate from localStorage if present, otherwise auto-prompt
  // ONCE. We track that we've prompted in a separate localStorage key so a
  // user who declines isn't pestered every page load.
  useEffect(() => {
    const persisted = readPersisted();
    if (persisted && Date.now() - persisted.cachedAt < STALE_AFTER_MS) {
      setState({ location: persisted, status: 'ready', hydrating: false });
      return;
    }

    const alreadyPrompted = window.localStorage.getItem(PROMPT_FLAG) === '1';
    if (alreadyPrompted && !persisted) {
      // User previously declined or errored \u2014 don't prompt again, just use fallback.
      setState({ location: HYDERABAD, status: 'ready', hydrating: false });
      return;
    }

    setState((s) => ({ ...s, hydrating: false, status: 'loading' }));
    requestBrowserGeolocation()
      .then(async ({ lat, lon }) => {
        const resolved = await reverseGeocode(lat, lon);
        writePersisted(resolved);
        window.localStorage.setItem(PROMPT_FLAG, '1');
        setState({ location: resolved, status: 'ready', hydrating: false });
      })
      .catch(() => {
        window.localStorage.setItem(PROMPT_FLAG, '1');
        setState({ location: HYDERABAD, status: 'denied', hydrating: false });
      });
  }, []);

  // Manually request (or re-request) geolocation \u2014 wired to the
  // "Use my location" button. Always reprompts the browser.
  const requestLocation = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const { lat, lon } = await requestBrowserGeolocation();
      const resolved = await reverseGeocode(lat, lon);
      writePersisted(resolved);
      window.localStorage.setItem(PROMPT_FLAG, '1');
      setState({ location: resolved, status: 'ready', hydrating: false });
      return resolved;
    } catch {
      setState((s) => ({ ...s, status: 'denied' }));
      return null;
    }
  }, []);

  // Set a city manually (from the search picker). Skips the browser geo prompt.
  const setManualLocation = useCallback((loc: Omit<ResolvedLocation, 'source'>) => {
    const next: ResolvedLocation = { ...loc, source: 'manual' };
    writePersisted(next);
    setState({ location: next, status: 'ready', hydrating: false });
  }, []);

  // Reset back to the community default.
  const resetLocation = useCallback(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setState({ location: HYDERABAD, status: 'ready', hydrating: false });
  }, []);

  return { ...state, requestLocation, setManualLocation, resetLocation };
}
