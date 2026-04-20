'use client';
import { useEffect, useRef, useState } from 'react';
import { MapPin, Search, X, Loader2, LocateFixed, Check, AlertTriangle } from 'lucide-react';
import { describeDenial, type GeoDenialReason, type ResolvedLocation } from '@/hooks/useGeoLocation';

interface SearchHit {
  locality: string;
  city: string;
  region?: string;
  country?: string;
  countryCode?: string;
  type?: string;
  displayName?: string;
  lat: number;
  lon: number;
}

interface Props {
  current: ResolvedLocation;
  status: 'loading' | 'ready' | 'denied' | 'error';
  // Why the last detection attempt failed, if any. Drives the inline help text.
  denialReason?: GeoDenialReason;
  onPickCoords: (loc: Omit<ResolvedLocation, 'source'>) => void;
  onUseGeolocation: () => void;
  onReset: () => void;
}

// Human-friendly label for an OSM place type. Returns null for generic /
// unknown types so we don't show "Unknown" in the UI.
function placeTypeLabel(type?: string): string | null {
  if (!type) return null;
  const map: Record<string, string> = {
    village: 'Village',
    hamlet: 'Hamlet',
    town: 'Town',
    suburb: 'Suburb',
    neighbourhood: 'Neighbourhood',
    city: 'City',
    municipality: 'Municipality',
    administrative: 'Area',
    locality: 'Locality',
    quarter: 'Quarter',
    residential: 'Residential area',
    farm: 'Farm',
    isolated_dwelling: 'Settlement',
  };
  return map[type] ?? null;
}

// A small pill that shows the current locality (with city / region as a
// secondary subtitle), and opens a popover with a search box + a "use my
// location" button. Designed to feel like Google's location picker but
// smaller \u2014 fits in the page header.
export default function LocationPicker({ current, status, denialReason, onPickCoords, onUseGeolocation, onReset }: Props) {
  const denialMessage = describeDenial(denialReason ?? null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Close the popover on click-outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Debounced search against /api/news/geocode (now Nominatim-backed, so
  // villages, suburbs, and small localities are searchable).
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/news/geocode?q=${encodeURIComponent(q.trim())}`);
        const json = await res.json();
        setHits(Array.isArray(json.results) ? json.results : []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Primary label: the locality if we have one (e.g. "Lingampally"),
  // otherwise the city. The pill stays compact; the full place name is in
  // the secondary `title` tooltip and in the popover header.
  const primaryLabel = current.locality || current.city;
  const secondaryParts = [current.locality && current.locality !== current.city ? current.city : null, current.region]
    .filter(Boolean);
  const secondary = secondaryParts.join(', ');

  return (
    <div ref={popRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={current.displayName || primaryLabel}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:border-[#1B5E20] hover:text-[#1B5E20] transition shadow-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {status === 'loading' ? (
          <Loader2 size={12} className="animate-spin text-[#1B5E20]" />
        ) : (
          <MapPin size={12} className={current.source === 'fallback' ? 'text-gray-400' : 'text-[#1B5E20]'} />
        )}
        <span className="max-w-[140px] sm:max-w-[180px] truncate">{primaryLabel}</span>
        {current.source === 'geolocation' && <span className="text-[9px] text-[#1B5E20] font-bold">AUTO</span>}
      </button>

      {open && (
        // On mobile we anchor to the LEFT edge of the trigger so the popover
        // stays inside the viewport even when the trigger is on the left side
        // of the row (the page header stacks vertically on phones, so the pill
        // sits flush-left, not flush-right). On sm+ desktops it goes to the
        // right of the trigger as before.
        <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-[calc(100vw-1.5rem)] max-w-xs sm:w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-30 overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Change location</span>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <div className="text-sm font-semibold text-gray-900 truncate" title={current.displayName || primaryLabel}>
              {primaryLabel}
            </div>
            {(secondary || placeTypeLabel(current.type)) && (
              <div className="text-[11px] text-gray-500 truncate">
                {[placeTypeLabel(current.type), secondary].filter(Boolean).join(' \u00b7 ')}
              </div>
            )}
          </div>

          <div className="p-3 space-y-2">
            <button
              type="button"
              onClick={() => { onUseGeolocation(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg bg-[#1B5E20]/5 hover:bg-[#1B5E20]/10 text-sm font-semibold text-[#1B5E20] transition"
            >
              <LocateFixed size={14} />
              Use my current location
            </button>

            {denialMessage && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] leading-snug text-amber-900">
                <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber-600" />
                <div className="flex-1">
                  <p>{denialMessage}</p>
                  <button
                    type="button"
                    onClick={() => { onUseGeolocation(); }}
                    className="mt-1 font-semibold text-amber-700 hover:text-amber-900 underline"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search city, village, or area"
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-[#1B5E20] focus:outline-none focus:ring-1 focus:ring-[#1B5E20]"
                autoFocus
              />
            </div>

            <div className="max-h-60 overflow-y-auto -mx-1">
              {searching && (
                <p className="text-xs text-gray-400 px-3 py-2">Searching...</p>
              )}
              {!searching && q.trim().length >= 2 && hits.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-2">No matches</p>
              )}
              {hits.map((h, idx) => {
                const active = Math.abs(h.lat - current.lat) < 0.05 && Math.abs(h.lon - current.lon) < 0.05;
                const subtitle = [placeTypeLabel(h.type), h.region, h.country]
                  .filter(Boolean)
                  .join(' \u00b7 ');
                return (
                  <button
                    key={`${h.locality}-${h.lat}-${h.lon}-${idx}`}
                    type="button"
                    onClick={() => {
                      onPickCoords({
                        lat: h.lat,
                        lon: h.lon,
                        locality: h.locality,
                        city: h.city,
                        region: h.region,
                        country: h.country,
                        countryCode: h.countryCode,
                        type: h.type,
                        displayName: h.displayName,
                      });
                      setOpen(false);
                      setQ('');
                    }}
                    className="flex items-center gap-2 w-full text-left px-3 py-2.5 hover:bg-gray-50 rounded-lg"
                  >
                    <MapPin size={12} className="text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {h.locality}
                        {h.locality !== h.city && (
                          <span className="text-gray-500 font-normal">, {h.city}</span>
                        )}
                      </p>
                      {subtitle && (
                        <p className="text-[10px] text-gray-500 truncate">{subtitle}</p>
                      )}
                    </div>
                    {active && <Check size={14} className="text-[#1B5E20]" />}
                  </button>
                );
              })}
            </div>

            {current.source !== 'fallback' && (
              <button
                type="button"
                onClick={() => { onReset(); setOpen(false); }}
                className="text-[10px] text-gray-500 hover:text-gray-700 underline pt-1"
              >
                Reset to Hyderabad (community default)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
