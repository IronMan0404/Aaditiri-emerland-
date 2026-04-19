'use client';
import { useEffect, useRef, useState } from 'react';
import { MapPin, Search, X, Loader2, LocateFixed, Check, AlertTriangle } from 'lucide-react';
import { describeDenial, type GeoDenialReason, type ResolvedLocation } from '@/hooks/useGeoLocation';

interface SearchHit {
  city: string;
  region?: string;
  country?: string;
  countryCode?: string;
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

// A small \ud83d\udccd pill that shows the current city, and opens a popover with a
// city-search box + a "use my location" button. Designed to feel like
// Google's location picker but smaller \u2014 fits in the page header.
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

  // Debounced search against /api/news/geocode.
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

  return (
    <div ref={popRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:border-[#1B5E20] hover:text-[#1B5E20] transition shadow-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {status === 'loading' ? (
          <Loader2 size={12} className="animate-spin text-[#1B5E20]" />
        ) : (
          <MapPin size={12} className={current.source === 'fallback' ? 'text-gray-400' : 'text-[#1B5E20]'} />
        )}
        <span className="max-w-[120px] sm:max-w-[140px] truncate">{current.city}</span>
        {current.source === 'geolocation' && <span className="text-[9px] text-[#1B5E20] font-bold">AUTO</span>}
      </button>

      {open && (
        // On mobile we anchor to the LEFT edge of the trigger so the popover
        // stays inside the viewport even when the trigger is on the left side
        // of the row (the page header stacks vertically on phones, so the pill
        // sits flush-left, not flush-right). On sm+ desktops it goes to the
        // right of the trigger as before.
        <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-[calc(100vw-1.5rem)] max-w-xs sm:w-72 bg-white rounded-xl shadow-lg border border-gray-200 z-30 overflow-hidden">
          <div className="p-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Change location</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
              <X size={14} />
            </button>
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
                placeholder="Search city, e.g. Bengaluru"
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
              {hits.map((h) => {
                const active = Math.abs(h.lat - current.lat) < 0.05 && Math.abs(h.lon - current.lon) < 0.05;
                return (
                  <button
                    key={`${h.city}-${h.lat}-${h.lon}`}
                    type="button"
                    onClick={() => {
                      onPickCoords({ lat: h.lat, lon: h.lon, city: h.city, region: h.region, country: h.country });
                      setOpen(false);
                      setQ('');
                    }}
                    className="flex items-center gap-2 w-full text-left px-3 py-2.5 hover:bg-gray-50 rounded-lg"
                  >
                    <MapPin size={12} className="text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{h.city}</p>
                      <p className="text-[10px] text-gray-500 truncate">
                        {[h.region, h.country].filter(Boolean).join(', ')}
                      </p>
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
