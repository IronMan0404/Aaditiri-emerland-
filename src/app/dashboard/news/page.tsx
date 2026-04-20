'use client';
import { useState } from 'react';
import { Cloud, Wind, TrafficCone, Newspaper, Cpu, LineChart, Trophy, Sun, Fuel } from 'lucide-react';
import { useGeoLocation } from '@/hooks/useGeoLocation';
import LocationPicker from '@/components/news/LocationPicker';
import {
  WeatherPanel,
  AirQualityPanel,
  MarketsPanel,
  PanchangPanel,
  FeedListPanel,
} from '@/components/news/panels';

type Tab = 'weather' | 'air' | 'traffic' | 'local' | 'markets' | 'cricket' | 'panchang' | 'fuel' | 'ai';

const TABS: { id: Tab; label: string; short: string; icon: typeof Cloud }[] = [
  { id: 'weather',  label: 'Weather',         short: 'Weather',  icon: Cloud       },
  { id: 'air',      label: 'Air Quality',     short: 'Air',      icon: Wind        },
  { id: 'traffic',  label: 'Traffic & Civic', short: 'Traffic',  icon: TrafficCone },
  { id: 'local',    label: 'Local News',      short: 'Local',    icon: Newspaper   },
  { id: 'markets',  label: 'Markets',         short: 'Markets',  icon: LineChart   },
  { id: 'cricket',  label: 'Cricket',         short: 'Cricket',  icon: Trophy      },
  { id: 'panchang', label: 'Panchang',        short: 'Panchang', icon: Sun         },
  { id: 'fuel',     label: 'Fuel News',       short: 'Fuel',     icon: Fuel        },
  { id: 'ai',       label: 'AI / Tech',       short: 'AI',       icon: Cpu         },
];

export default function NewsPage() {
  const [tab, setTab] = useState<Tab>('weather');
  const geo = useGeoLocation();

  return (
    // px-3 on phones (smaller gutter so cards have more horizontal room),
    // px-4 from sm: upward. pb-6 then the layout's pb-20 keeps the last
    // card clear of the bottom MobileNav on phones.
    <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-6">
      {/* Header row \u2014 stacks vertically on phones (title above, pill below)
          so a long city name like "Lingampalli, Telangana" can't push the
          subtitle off-screen. On sm+ desktops we put the pill on the right. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight">News</h1>
          {(() => {
            // Build a compact "Locality, City" or "Locality, Region" label.
            // We avoid the full displayName (which can include country) so
            // the subtitle stays one line on phones.
            const primary = geo.location.locality || geo.location.city;
            const parent =
              geo.location.locality && geo.location.locality !== geo.location.city
                ? geo.location.city
                : geo.location.region;
            const label = [primary, parent].filter(Boolean).join(', ');
            return (
              <p
                className="text-xs sm:text-sm text-gray-500 mt-0.5 truncate"
                title={geo.location.displayName || label}
              >
                Live updates for{' '}
                <span className="font-semibold text-gray-700">{label}</span>
                {geo.status === 'loading' && <span className="ml-1 text-[#1B5E20]">· locating…</span>}
                {geo.status === 'denied' && <span className="ml-1 text-gray-400">· using community default</span>}
              </p>
            );
          })()}
        </div>
        {/* On mobile: pill aligns to the start under the subtitle.
            On desktop: pill sits at top-right. */}
        <div className="self-start">
          <LocationPicker
            current={geo.location}
            status={geo.status}
            denialReason={geo.denialReason}
            onPickCoords={geo.setManualLocation}
            onUseGeolocation={geo.requestLocation}
            onReset={geo.resetLocation}
          />
        </div>
      </div>

      {/* Tab strip. Full-bleed horizontal scroll on phones (extends to the
          page edge so users get a visual cue that there's more), wraps on
          sm+ desktops. The negative margin + matching padding cancels out
          the page gutter so the scroll snaps naturally to the screen edge. */}
      <div className="relative -mx-3 sm:mx-0 mb-4 sm:mb-5">
        <div className="flex gap-1.5 overflow-x-auto px-3 sm:px-0 pb-1.5 scrollbar-hide sm:flex-wrap">
          {TABS.map(({ id, short, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-full text-xs font-semibold transition shrink-0 whitespace-nowrap ${
                  active
                    ? 'bg-[#1B5E20] text-white shadow-sm'
                    : 'bg-white text-gray-600 border border-gray-200'
                }`}
              >
                <Icon size={13} />
                {short}
              </button>
            );
          })}
        </div>
        {/* Right-edge fade so users can tell the strip scrolls horizontally on mobile. */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-1.5 w-6 bg-gradient-to-l from-[#F5F5F5] to-transparent sm:hidden" />
      </div>

      {/* Don't render any panel until the geo hook has hydrated, otherwise
          we'd fire the panel's fetch with the fallback location and then
          fire it again 50ms later with the real one. */}
      {geo.hydrating ? (
        <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />
      ) : (
        <>
          {tab === 'weather'  && <WeatherPanel    location={geo.location} />}
          {tab === 'air'      && <AirQualityPanel location={geo.location} />}
          {tab === 'traffic'  && <FeedListPanel   source="feeds" category="traffic" location={geo.location} />}
          {tab === 'local'    && <FeedListPanel   source="feeds" category="local"   location={geo.location} />}
          {tab === 'markets'  && <MarketsPanel    />}
          {tab === 'cricket'  && <FeedListPanel   source="cricket" location={geo.location} />}
          {tab === 'panchang' && <PanchangPanel   location={geo.location} />}
          {tab === 'fuel'     && <FeedListPanel   source="fuel"    location={geo.location} />}
          {tab === 'ai'       && <FeedListPanel   source="feeds" category="ai"      location={geo.location} />}
        </>
      )}
    </div>
  );
}
