'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  CloudRain, Wind, Droplets, AlertTriangle, RefreshCw, ExternalLink,
  Share2, Search, Sun, Sunrise, Sunset, TrendingUp, TrendingDown,
} from 'lucide-react';
import type { ResolvedLocation } from '@/hooks/useGeoLocation';
import { shareOrCopy } from '@/lib/share';

// =============================================================================
// Shared types & helpers
// =============================================================================

interface FeedItem {
  title: string;
  link: string;
  publishedAt: string;
  source: string;
  summary?: string;
  imageUrl?: string;
}

// Whitelist external URLs to http(s) only \u2014 same defence as the previous
// version so a hostile feed can't return javascript:/data: links.
function safeUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function SkeletonCards({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-900">
      <p className="text-sm font-semibold">Couldn&rsquo;t load this section</p>
      <p className="text-xs mt-1 opacity-90">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-xs font-semibold mt-2 px-3 py-1.5 rounded-lg bg-white border border-amber-300 hover:bg-amber-100"
      >
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

// =============================================================================
// Weather
// =============================================================================

interface WeatherDay { date: string; label: string; condition: string; icon: string; minC: number; maxC: number; rainMm: number; rainChance: number; uvIndex: number }
interface WeatherAlert { level: 'info' | 'warning' | 'severe'; title: string; detail: string }
interface WeatherPayload {
  location: string;
  updatedAt: string;
  sunrise?: string;
  sunset?: string;
  current: { tempC: number; feelsLikeC: number; humidity: number; precipitationMm: number; windKmh: number; isDay: boolean; condition: string; icon: string };
  daily: WeatherDay[];
  alerts: WeatherAlert[];
}

export function WeatherPanel({ location }: { location: ResolvedLocation }) {
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ lat: String(location.lat), lon: String(location.lon), city: location.city });
      const res = await fetch(`/api/news/weather?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load weather');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load weather');
    } finally {
      setLoading(false);
    }
  }, [location.lat, location.lon, location.city]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <SkeletonCards count={3} />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { current, daily, alerts, location: city, updatedAt, sunrise, sunset } = data;
  const sunriseLabel = sunrise ? new Date(sunrise).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const sunsetLabel = sunset ? new Date(sunset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] text-white p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] sm:text-xs uppercase tracking-wider text-white/70 truncate">{city}</p>
            <p className="text-4xl sm:text-5xl font-bold mt-1 leading-none">{Math.round(current.tempC)}°</p>
            <p className="text-xs sm:text-sm text-white/85 mt-1 truncate">{current.condition} · feels {Math.round(current.feelsLikeC)}°</p>
          </div>
          <div className="text-5xl sm:text-6xl leading-none shrink-0" aria-hidden="true">{current.icon}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 sm:pt-4 border-t border-white/20 text-center text-[11px] sm:text-xs">
          <div><Droplets size={14} className="inline mb-0.5" /><p className="font-semibold">{current.humidity}%</p><p className="text-white/70 text-[10px] sm:text-xs">Humidity</p></div>
          <div><Wind size={14} className="inline mb-0.5" /><p className="font-semibold">{Math.round(current.windKmh)} km/h</p><p className="text-white/70 text-[10px] sm:text-xs">Wind</p></div>
          <div><CloudRain size={14} className="inline mb-0.5" /><p className="font-semibold">{current.precipitationMm.toFixed(1)} mm</p><p className="text-white/70 text-[10px] sm:text-xs">Rain (1h)</p></div>
        </div>
        {(sunriseLabel || sunsetLabel) && (
          <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-white/20 text-center text-[11px] sm:text-xs">
            <div><Sunrise size={12} className="inline mb-0.5" /> <span className="font-semibold">{sunriseLabel}</span> <span className="text-white/70">Sunrise</span></div>
            <div><Sunset size={12} className="inline mb-0.5" /> <span className="font-semibold">{sunsetLabel}</span> <span className="text-white/70">Sunset</span></div>
          </div>
        )}
        <p className="text-[10px] text-white/60 mt-3 text-right">Updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}</p>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={`${a.title}-${i}`} className={`rounded-xl border p-3 flex items-start gap-3 ${
              a.level === 'severe' ? 'bg-red-50 border-red-200 text-red-900'
                : a.level === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}>
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold text-sm">{a.title}</p>
                <p className="text-xs mt-0.5 opacity-90">{a.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-white border border-gray-200 p-3 shadow-sm">
        <p className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">Next 5 days</p>
        <div className="grid grid-cols-5 gap-0.5 sm:gap-1">
          {daily.slice(0, 5).map((d) => (
            <div key={d.date} className="text-center py-2 rounded-lg hover:bg-gray-50 min-w-0">
              <p className="text-[11px] sm:text-xs font-semibold text-gray-700 truncate">{d.label}</p>
              <p className="text-xl sm:text-2xl my-1" aria-hidden="true">{d.icon}</p>
              <p className="text-[11px] sm:text-xs text-gray-900 font-semibold whitespace-nowrap">{Math.round(d.maxC)}°<span className="text-gray-400 font-normal">/{Math.round(d.minC)}°</span></p>
              {(d.rainChance ?? 0) >= 30 && (<p className="text-[9px] sm:text-[10px] text-blue-600 mt-0.5">{d.rainChance}%</p>)}
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-gray-400 text-center">Forecast by Open-Meteo</p>
    </div>
  );
}

// =============================================================================
// Air Quality
// =============================================================================

interface AqiPayload {
  city: string;
  updatedAt: string;
  usAqi: number;
  band: { label: string; color: string; advice: string };
  dominant: { name: string; raw: number; unit: string };
  pollutants: { pm2_5?: number; pm10?: number; ozone?: number; no2?: number; so2?: number; co?: number };
}

export function AirQualityPanel({ location }: { location: ResolvedLocation }) {
  const [data, setData] = useState<AqiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ lat: String(location.lat), lon: String(location.lon), city: location.city });
      const res = await fetch(`/api/news/air-quality?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load air quality');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load air quality');
    } finally { setLoading(false); }
  }, [location.lat, location.lon, location.city]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <SkeletonCards count={2} />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { usAqi, band, dominant, pollutants, updatedAt, city } = data;
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-2xl p-4 sm:p-5 text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${band.color}, ${band.color}dd)` }}>
        <p className="text-[10px] sm:text-xs uppercase tracking-wider text-white/80 truncate">{city} · Air Quality</p>
        <p className="text-5xl sm:text-6xl font-bold mt-1 leading-none">{usAqi}</p>
        <p className="text-sm font-semibold mt-1">{band.label}</p>
        <p className="text-xs text-white/90 mt-2 leading-snug">{band.advice}</p>
        <p className="text-[10px] text-white/70 mt-3">Dominant: {dominant.name} · {dominant.raw.toFixed(1)} {dominant.unit}</p>
      </div>

      <div className="rounded-xl bg-white border border-gray-200 p-3 shadow-sm">
        <p className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">Pollutants now</p>
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-center">
          {([
            ['PM2.5', pollutants.pm2_5, 'µg/m³'],
            ['PM10',  pollutants.pm10,  'µg/m³'],
            ['O₃',   pollutants.ozone, 'µg/m³'],
            ['NO₂',  pollutants.no2,   'µg/m³'],
            ['SO₂',  pollutants.so2,   'µg/m³'],
            ['CO',   pollutants.co,    'µg/m³'],
          ] as [string, number | undefined, string][]).map(([name, val, unit]) => (
            <div key={name} className="py-2 px-1 rounded-lg bg-gray-50 min-w-0">
              <p className="text-[10px] text-gray-500">{name}</p>
              <p className="text-sm font-bold text-gray-900">{val !== undefined ? val.toFixed(1) : '–'}</p>
              <p className="text-[10px] text-gray-400 truncate">{unit}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-gray-400 text-center">Updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })} · Open-Meteo Air Quality</p>
    </div>
  );
}

// =============================================================================
// Markets
// =============================================================================

interface Quote {
  id: string; name: string; type: string;
  price: number | null; prevClose: number | null;
  changeAbs: number | null; changePct: number | null;
  currency: string; marketState: string;
}

export function MarketsPanel() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/news/markets', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load markets');
      const json = await res.json();
      setQuotes(json.quotes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load markets');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && quotes.length === 0) return <SkeletonCards count={3} />;
  if (error && quotes.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-3">
      {/* 2-up on phones too: a single full-width column made these cards
          look stretched and empty. 2 columns also fits 6 quotes in 3 rows
          which is much more glanceable on mobile. */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {quotes.map((q) => {
          const up = (q.changePct ?? 0) >= 0;
          const Icon = up ? TrendingUp : TrendingDown;
          const valueStr = q.price === null ? '–' : q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 });
          return (
            <div key={q.id} className="rounded-xl bg-white border border-gray-200 p-3 sm:p-4 shadow-sm min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-500 font-semibold truncate">{q.type === 'index' ? 'Index' : q.type === 'fx' ? 'Currency' : 'Commodity'}</p>
                  <p className="text-xs sm:text-sm font-bold text-gray-900 truncate">{q.name}</p>
                </div>
                {q.changePct !== null && (
                  <div className={`flex items-center gap-0.5 text-[10px] sm:text-xs font-bold shrink-0 ${up ? 'text-green-600' : 'text-red-600'}`}>
                    <Icon size={12} />
                    {up ? '+' : ''}{q.changePct.toFixed(2)}%
                  </div>
                )}
              </div>
              <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-2 truncate">{valueStr}</p>
              {q.changeAbs !== null && (
                <p className={`text-[10px] sm:text-xs mt-0.5 truncate ${up ? 'text-green-600' : 'text-red-600'}`}>{up ? '+' : ''}{q.changeAbs.toFixed(2)} {q.currency}</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-400 text-center px-2 leading-snug">Quotes from Yahoo Finance · 5-min cache · for information only, not investment advice</p>
    </div>
  );
}

// =============================================================================
// Panchang
// =============================================================================

interface PanchangPayload {
  city: string; date: string; weekday: string;
  moon: { name: string; emoji: string; illumPct: number; ageDays: number };
  tithi: { index: number; name: string; paksha: 'Shukla' | 'Krishna' };
  sunrise?: string; sunset?: string; dayLength?: string;
}

export function PanchangPanel({ location }: { location: ResolvedLocation }) {
  const [data, setData] = useState<PanchangPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ lat: String(location.lat), lon: String(location.lon), city: location.city });
      const res = await fetch(`/api/news/panchang?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load panchang');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load panchang');
    } finally { setLoading(false); }
  }, [location.lat, location.lon, location.city]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <SkeletonCards count={2} />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const sunrise = data.sunrise ? new Date(data.sunrise).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–';
  const sunset  = data.sunset  ? new Date(data.sunset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })  : '–';
  const dateLabel = new Date(data.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-white p-4 sm:p-5 shadow-sm">
        <p className="text-[10px] sm:text-xs uppercase tracking-wider text-white/80 truncate">{data.city} · Panchang</p>
        <p className="text-sm sm:text-base font-bold mt-1 leading-tight">{dateLabel}</p>
        <p className="text-xs sm:text-sm text-white/90 mt-0.5">{data.weekday}</p>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-3 sm:mt-4 pt-3 border-t border-white/20">
          <div className="min-w-0">
            <p className="text-[10px] text-white/70 uppercase tracking-wider">Tithi</p>
            <p className="text-base sm:text-lg font-bold truncate">{data.tithi.name}</p>
            <p className="text-[10px] text-white/80 truncate">{data.tithi.paksha} · day {data.tithi.index}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-white/70 uppercase tracking-wider">Moon</p>
            <p className="text-base sm:text-lg font-bold truncate">
              <span aria-hidden="true">{data.moon.emoji}</span> {data.moon.name}
            </p>
            <p className="text-[10px] text-white/80">{data.moon.illumPct}% illuminated</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-white border border-gray-200 p-3 sm:p-4 shadow-sm grid grid-cols-3 gap-1 sm:gap-2 text-center">
        <div className="min-w-0">
          <Sunrise size={16} className="inline text-orange-500 mb-1" />
          <p className="text-xs sm:text-sm font-bold text-gray-900 truncate">{sunrise}</p>
          <p className="text-[10px] text-gray-500">Sunrise</p>
        </div>
        <div className="min-w-0">
          <Sun size={16} className="inline text-yellow-500 mb-1" />
          <p className="text-xs sm:text-sm font-bold text-gray-900 truncate">{data.dayLength ?? '–'}</p>
          <p className="text-[10px] text-gray-500">Day length</p>
        </div>
        <div className="min-w-0">
          <Sunset size={16} className="inline text-orange-700 mb-1" />
          <p className="text-xs sm:text-sm font-bold text-gray-900 truncate">{sunset}</p>
          <p className="text-[10px] text-gray-500">Sunset</p>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 text-center px-2 leading-snug">
        Tithi computed locally · For full Panchang (Nakshatra, Yoga, Karana) visit{' '}
        <a href="https://www.drikpanchang.com/" target="_blank" rel="noopener noreferrer" className="underline">drikpanchang.com</a>
      </p>
    </div>
  );
}

// =============================================================================
// Generic feed list (Traffic / Local / AI / Cricket / Fuel)
// =============================================================================

type FeedSource = 'feeds' | 'cricket' | 'fuel';

interface FeedPanelProps {
  source: FeedSource;
  category?: string;
  location: ResolvedLocation;
  emptyMessage?: string;
}

export function FeedListPanel({ source, category, location, emptyMessage }: FeedPanelProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let url: string;
      const cityParam = encodeURIComponent(location.city);
      if (source === 'feeds') {
        url = `/api/news/feeds?category=${encodeURIComponent(category ?? 'local')}&city=${cityParam}`;
      } else if (source === 'cricket') {
        url = '/api/news/cricket';
      } else {
        url = `/api/news/fuel?city=${cityParam}`;
      }
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load feed');
      const json = await res.json();
      setItems(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feed');
    } finally { setLoading(false); }
  }, [source, category, location.city]);

  useEffect(() => { load(); }, [load]);

  // Local search filter \u2014 narrows the already-loaded list, no extra fetch.
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((it) =>
      it.title.toLowerCase().includes(q) ||
      it.source.toLowerCase().includes(q) ||
      (it.summary?.toLowerCase().includes(q) ?? false)
    );
  }, [items, search]);

  if (loading && items.length === 0) return <SkeletonCards count={5} />;
  if (error && items.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-3">
      {items.length > 3 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter stories..."
            className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:border-[#1B5E20] focus:outline-none focus:ring-1 focus:ring-[#1B5E20]"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-12">{emptyMessage ?? 'No items match your search.'}</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((item, i) => (
            <NewsCard key={item.link || item.title} item={item} featured={i === 0 && !search} />
          ))}
        </ul>
      )}
    </div>
  );
}

// Individual news card. The first card in a list is rendered as a larger
// "featured" variant with a bigger thumbnail; the rest are compact rows.
function NewsCard({ item, featured }: { item: FeedItem; featured?: boolean }) {
  const href = safeUrl(item.link);
  const img = item.imageUrl ? safeUrl(item.imageUrl) : null;

  const onShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!href) return;
    await shareOrCopy({ title: item.title, text: item.title, url: href });
  };

  const meta = (
    <>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[#1B5E20] truncate min-w-0">{item.source}</span>
        <div className="flex items-center gap-1 shrink-0">
          {href && (
            <button
              type="button"
              onClick={onShare}
              className="p-1 -my-1 rounded-md text-gray-400 hover:text-[#1B5E20] hover:bg-gray-50"
              aria-label="Share article"
            >
              <Share2 size={13} />
            </button>
          )}
          {href && <ExternalLink size={11} className="text-gray-300" aria-hidden="true" />}
        </div>
      </div>
      <h3 className={`font-semibold text-gray-900 leading-snug line-clamp-3 ${featured ? 'text-sm sm:text-base' : 'text-[13px] sm:text-sm'}`}>{item.title}</h3>
      {item.summary && (
        <p className={`text-gray-500 mt-1 line-clamp-2 ${featured ? 'text-xs sm:text-sm' : 'text-[11px] sm:text-xs'}`}>{item.summary}</p>
      )}
      <p className="text-[10px] text-gray-400 mt-1.5 sm:mt-2">{formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}</p>
    </>
  );

  const inner = (
    <div className={`flex gap-2.5 sm:gap-3 ${featured ? 'flex-col' : 'flex-row'}`}>
      {img && (
        <div className={`shrink-0 overflow-hidden rounded-lg bg-gray-100 ${
          featured ? 'w-full aspect-[16/9]' : 'w-16 h-16 sm:w-20 sm:h-20'
        }`}>
          { /* eslint-disable-next-line @next/next/no-img-element -- 3rd-party feed thumbnails: domains are unbounded so we can't pre-allowlist them in next.config; native <img> is fine for these decorative thumbs. */ }
          <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.parentElement!.style.display = 'none'; }} />
        </div>
      )}
      <div className="min-w-0 flex-1">{meta}</div>
    </div>
  );

  return (
    <li>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-white rounded-xl border border-gray-200 p-3 sm:p-4 shadow-sm hover:border-[#1B5E20]/40 hover:shadow transition active:scale-[0.99]"
        >
          {inner}
        </a>
      ) : (
        <div className="block bg-white rounded-xl border border-gray-200 p-3 sm:p-4 shadow-sm">{inner}</div>
      )}
    </li>
  );
}
