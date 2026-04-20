'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MapPin, ChevronRight, Loader2 } from 'lucide-react';
import { useGeoLocation } from '@/hooks/useGeoLocation';

// One-line "Nearby" pill for the dashboard hero. A single tap takes the
// resident to /dashboard/news for the full breakdown (weather, air, traffic,
// local). Intentionally tiny: 1 row, 2 fetches, no duplication of the news
// page — it exists only to make the daily glance value (temp + AQI) visible
// without needing a navigation click.
export default function NearbyPill() {
  const geo = useGeoLocation();
  const [tempC, setTempC] = useState<number | null>(null);
  const [aqi, setAqi] = useState<number | null>(null);
  const [aqiColor, setAqiColor] = useState<string | null>(null);

  // Skip fetches until the geo hook has hydrated, otherwise we'd fire once
  // with the fallback location and again with the real one.
  useEffect(() => {
    if (geo.hydrating) return;

    const lat = geo.location.lat;
    const lon = geo.location.lon;
    const city = encodeURIComponent(geo.location.city);
    const ctrl = new AbortController();

    Promise.allSettled([
      fetch(`/api/news/weather?lat=${lat}&lon=${lon}&city=${city}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { current?: { tempC?: number } } | null) => {
          if (typeof j?.current?.tempC === 'number') setTempC(j.current.tempC);
        }),
      fetch(`/api/news/air-quality?lat=${lat}&lon=${lon}&city=${city}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { usAqi?: number; band?: { color?: string } } | null) => {
          if (typeof j?.usAqi === 'number') setAqi(j.usAqi);
          if (typeof j?.band?.color === 'string') setAqiColor(j.band.color);
        }),
    ]).catch(() => { /* network noise on tab-switch — safe to ignore */ });

    return () => ctrl.abort();
  }, [geo.hydrating, geo.location.lat, geo.location.lon, geo.location.city]);

  // Hero text is white-on-green, so this pill uses a translucent white chip
  // to match the existing "Flat 413" / "Admin Dashboard" pills next to it.
  const placeLabel = geo.location.locality || geo.location.city;
  const coordsTooltip = `${formatCoords(geo.location.lat, geo.location.lon)} — tap for News`;

  return (
    <Link
      href="/dashboard/news"
      title={coordsTooltip}
      aria-label={`Nearby: ${placeLabel}${tempC !== null ? `, ${Math.round(tempC)} degrees` : ''}${aqi !== null ? `, AQI ${aqi}` : ''}. Open News.`}
      className="inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full border border-white/20 transition"
    >
      <MapPin size={12} aria-hidden="true" />
      <span className="max-w-[120px] truncate">{placeLabel}</span>

      {geo.hydrating || (tempC === null && aqi === null) ? (
        <Loader2 size={11} className="animate-spin opacity-70" aria-hidden="true" />
      ) : (
        <>
          {tempC !== null && (
            <>
              <span className="opacity-50" aria-hidden="true">·</span>
              <span>{Math.round(tempC)}°</span>
            </>
          )}
          {aqi !== null && (
            <>
              <span className="opacity-50" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-0.5">
                {aqiColor && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: aqiColor }}
                    aria-hidden="true"
                  />
                )}
                AQI {aqi}
              </span>
            </>
          )}
        </>
      )}

      <ChevronRight size={11} className="opacity-70" aria-hidden="true" />
    </Link>
  );
}

// "12.9716°N, 77.5946°E" — surfaced in the tooltip so the coords are still
// discoverable without spending a row of vertical space on them.
function formatCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lon).toFixed(4)}°${ew}`;
}
