# News Section

The News section (`/dashboard/news`) gives every resident a single place to glance at things they actually check daily — local weather, air quality, traffic & civic alerts, city news, markets, cricket, panchang, fuel prices, and AI/tech headlines — all auto-tuned to wherever they are right now.

It uses **only free, key-less data sources** and **no new npm dependencies**. Total cost to operate: ₹0.

---

## Where it lives in the UI

- Desktop sidebar: **News** (newspaper icon, second item under Home).
- Mobile bottom nav: behind the **More** sheet → **News**.
- Direct URL: `/dashboard/news`.

The page is one client component that renders one of nine panels based on the active tab. Panels lazy-load their own data on mount, scoped to the user's resolved location.

---

## Tabs

| Tab | Component | Default content |
|---|---|---|
| Weather | `WeatherPanel` | Current temp + condition emoji, humidity / wind / 1-hour rain, sunrise/sunset, 5-day forecast, severe-weather alerts |
| Air Quality | `AirQualityPanel` | US AQI dial with color-coded band + advice, dominant pollutant, PM2.5/PM10/O₃/NO₂/SO₂/CO grid |
| Traffic & Civic | `FeedListPanel` (`category=traffic`) | Roads, transit, water/power outages, GHMC notices |
| Local News | `FeedListPanel` (`category=local`) | Curated newspaper feeds (Hyd, Blr, Mumbai, Delhi, Chennai, Pune, Kolkata) — Google News fallback for other cities |
| Markets | `MarketsPanel` | NIFTY 50, SENSEX, BANK NIFTY, USD/INR, EUR/INR, Gold (USD/oz) with %-change |
| Cricket | `FeedListPanel` (`source=cricket`) | India / IPL / international match coverage from major sports outlets |
| Panchang | `PanchangPanel` | Today's tithi, paksha, weekday in Sanskrit, moon phase + illumination, sunrise/sunset/day length |
| Fuel News | `FeedListPanel` (`source=fuel`) | Latest stories on petrol/diesel price changes for the city |
| AI / Tech | `FeedListPanel` (`category=ai`) | The Verge AI, MIT Technology Review, Hacker News |

---

## Geolocation flow

`src/hooks/useGeoLocation.ts` is the single source of truth for the active city + coordinates.

```
On mount of /dashboard/news
  └─ Read localStorage["ae-news-location"]
      ├─ Hit, < 7 days old → use cached city (status='ready')
      └─ Miss
          └─ Read localStorage["ae-news-geo-prompted"]
              ├─ '1' → user previously declined → fall back to Hyderabad silently
              └─ unset → call navigator.geolocation.getCurrentPosition()
                  ├─ allowed → reverse-geocode coords → cache + render
                  └─ denied  → mark prompted=1 → fall back to Hyderabad
```

The hook exposes:

```ts
{
  location: ResolvedLocation;       // { lat, lon, city, region?, country?, source }
  status: 'loading' | 'ready' | 'denied' | 'error';
  hydrating: boolean;               // true on the first render
  requestLocation(): Promise<ResolvedLocation | null>;  // re-prompt browser
  setManualLocation(loc): void;     // pick a city from the search popover
  resetLocation(): void;            // clear → fall back to Hyderabad
}
```

`source` is one of:

- `geolocation` — auto-detected. Pill shows an "AUTO" badge.
- `manual` — picked via the search popover.
- `fallback` — defaulted to Hyderabad. Pill icon is greyed out.

### Why we never re-prompt aggressively

Browsers already remember the user's permission state. Re-prompting is annoying and on iOS Safari is rate-limited. We track `ae-news-geo-prompted` in `localStorage` and, once set, never auto-prompt again — the user always has the manual button in the location picker.

### Cache TTL

Resolved locations expire after **7 days**. After that we re-prompt automatically — useful for users who travel or move flats.

---

## Location picker

`src/components/news/LocationPicker.tsx` renders the small `📍 City` pill at the top-right of the page (or below the title on mobile). Tap it to open a popover with:

1. **Use my current location** button (re-prompts the browser).
2. **City search** input — debounced 300 ms, hits `/api/news/geocode?q=<term>` (Open-Meteo forward geocoding, returns up to 8 candidates).
3. **Reset to Hyderabad** link (only shown when source ≠ fallback).

On mobile the popover anchors to the **left** edge of its trigger and is sized as `calc(100vw - 1.5rem)` capped at `max-w-xs`, so it never hangs off the right of the viewport.

---

## API routes

All routes live in `src/app/api/news/`. Each one validates inputs, sets a `revalidate`-based cache, and returns plain JSON.

### `/api/news/weather`

```
GET /api/news/weather?lat=17.385&lon=78.4867&city=Hyderabad
```

| | |
|---|---|
| **Source** | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) |
| **Cache** | 10 minutes (per unique `lat,lon`) |
| **Auth** | None |
| **Defaults** | Hyderabad if params are missing or invalid |

Returns current weather, a 5-day daily forecast, sunrise/sunset, and a `deriveAlerts()` function output (heavy-rain, high UV, extreme heat warnings).

### `/api/news/air-quality`

```
GET /api/news/air-quality?lat=17.385&lon=78.4867&city=Hyderabad
```

| | |
|---|---|
| **Source** | [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) |
| **Cache** | 15 minutes |
| **Auth** | None |

Returns PM2.5, PM10, O₃, NO₂, SO₂, CO concentrations, plus US AQI and a derived "band" label/color/advice. Bands follow the official US EPA cutoffs (Good ≤50 / Moderate ≤100 / USG ≤150 / Unhealthy ≤200 / Very Unhealthy ≤300 / Hazardous).

### `/api/news/feeds`

```
GET /api/news/feeds?category=traffic|local|hyderabad|ai&city=Hyderabad
```

| | |
|---|---|
| **Source** | RSS/Atom — see source map below |
| **Cache** | 15 minutes |
| **Auth** | None |
| **Allowed categories** | `traffic`, `local`, `hyderabad` (legacy alias for local-Hyderabad), `ai` |

Source matrix:

- `ai` → static: The Verge AI, MIT Technology Review, Hacker News.
- `traffic` → Google News RSS, three searches scoped to the city: `<city> traffic`, `<city> water/power/municipal`, `<city> metro/bus/transport`.
- `local` → curated city-specific newspaper feeds for **Hyderabad, Bengaluru, Mumbai, Delhi, Chennai, Pune, Kolkata**. For any other city we fall back to a Google News search of `<city> city news`.

The route fans out to the matched feeds in parallel (each call has a 6 s timeout via `fetchFeed`), dedupes by URL, sorts by recency, returns the top 20.

### `/api/news/cricket`

```
GET /api/news/cricket
```

| | |
|---|---|
| **Source** | Google News RSS — three searches: India cricket, IPL, international (Test/ODI/T20) |
| **Cache** | 10 minutes |
| **Auth** | None |
| **Notes** | City-independent. We tried Cricbuzz's API (returns protobuf binary) and ESPNCricinfo (Akamai-blocked) — Google News scoped to current scoring is the most reliable free source. |

### `/api/news/markets`

```
GET /api/news/markets
```

| | |
|---|---|
| **Source** | Yahoo Finance v8 chart endpoint |
| **Cache** | 5 minutes |
| **Auth** | None — but Yahoo blocks the default Node UA, so we always send a browser-style `User-Agent`. |
| **Symbols** | `^NSEI` (NIFTY 50), `^BSESN` (SENSEX), `^NSEBANK` (BANK NIFTY), `USDINR=X`, `EURINR=X`, `GC=F` (Gold) |

Yahoo's older `v7/finance/quote` endpoint started requiring auth in 2024 and returns 401 — **don't switch back to it**. The `v8/finance/chart` endpoint is still anonymous and gives us enough info to compute price + previous close + % change.

### `/api/news/panchang`

```
GET /api/news/panchang?lat=17.385&lon=78.4867&city=Hyderabad
```

| | |
|---|---|
| **Source** | Computed locally, sun times from Open-Meteo |
| **Cache** | 1 hour |
| **Auth** | None |

Returns:

- `tithi` — name (one of 30 tithis like Pratipada, Purnima, Amavasya), paksha (Shukla / Krishna), index 1–30
- `moon` — phase name + emoji + age in days + illumination %
- `weekday` — Sanskrit/Hindi day name (e.g. "Shanivar (Sat)")
- `sunrise`, `sunset`, `dayLength`

Tithi & moon phase are computed via [Conway's simple lunar-age algorithm](https://en.wikipedia.org/wiki/Lunar_phase#Calculating_phase) — accurate to ~1 day, which is enough for naming the tithi. For full Panchang detail (Nakshatra, Yoga, Karana, Rahu Kalam) we link out to drikpanchang.com — every API exposing that data needs a paid key.

### `/api/news/fuel`

```
GET /api/news/fuel?city=Hyderabad
```

| | |
|---|---|
| **Source** | Google News RSS scoped to `<city> petrol diesel price today` |
| **Cache** | 30 minutes |
| **Auth** | None |

We tried scraping goodreturns / NDTV Fuel pages — both block scrapers. Surfacing the latest news headlines is more reliable than risking a stale scraped number, and the user gets an accurate dated price from the linked article.

### `/api/news/geocode`

```
GET /api/news/geocode?lat=17.385&lon=78.4867   # reverse mode
GET /api/news/geocode?q=mumbai                  # forward search
```

| | |
|---|---|
| **Reverse source** | [Nominatim (OpenStreetMap)](https://nominatim.org/release-docs/latest/api/Reverse/) |
| **Forward source** | [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) |
| **Cache** | 24 hours |
| **Auth** | None |

Nominatim's usage policy requires a real `User-Agent` and ≤1 req/sec — we send `AaditriEmerland/1.0` and cache aggressively. **Don't strip the User-Agent header** or Nominatim will return 403.

Open-Meteo doesn't have a reverse-geocoding endpoint (we tried) — that's why we use Nominatim for reverse and Open-Meteo for forward.

---

## RSS parser

`src/lib/rss.ts` is a dependency-free RSS/Atom parser. Around ~120 lines.

### `clean()` — order matters

```
CDATA unwrap → entity decode → strip <a>/<img>/<script>/<style> → strip remaining tags
```

Reordering breaks Times of India: their `<description>` body is XML-escaped HTML (`&lt;a href=...&gt;`). If we strip tags before decoding entities, the unescaped HTML leaks through with all its attributes, producing summaries like `&quot;https://timesofindia... target=_blank&gt; rams into tree`.

### Image extraction

`extractImage()` tries, in order:

1. `<enclosure url="..." />` — Times of India, The Hindu
2. `<media:thumbnail url="..." />` — some news feeds
3. `<media:content url="..." medium="image" />` — Atom-style
4. First `<img src="...">` embedded in `<description>` (after entity decode)

If none match, `imageUrl` is `undefined` and the card renders text-only.

### Adding a new feed

Edit `STATIC_SOURCES` (city-independent feeds like AI/Tech) or `CITY_FEEDS` (curated newspaper feeds per city) in `src/app/api/news/feeds/route.ts`. Each entry is just `{ name, url }`. The `dedupe()` step in `GET` deduplicates the merged result by URL, so overlapping feeds are safe.

For traffic / civic / cricket we use Google News RSS searches (`gnews()` helper) — those are auto-generated from the city name, no manual updates needed when adding a new city.

---

## Security

### XSS surface

External feeds are untrusted. Two attack vectors we close:

1. **Article URLs** (`item.link`) → passed through `safeUrl()` in `panels.tsx` before reaching `<a href>`. Only `http:` / `https:` allowed. If a feed returns `javascript:alert(1)` or `data:text/html,...`, the link is rendered as a non-interactive `<div>` instead of an `<a>`.
2. **Image URLs** (`item.imageUrl`) → same `safeUrl()` check before reaching `<img src>`. Failed loads also hide the entire image container so we don't leave a broken-image icon.

### Server-side fetches

Every API route runs server-side, so we can:

- Send custom User-Agents (Yahoo, Nominatim) without exposing them in client code
- Rate-limit upstream calls via `revalidate` so a hostile client can't fan out 1000 requests/sec
- Validate query params (lat/lon range, allowed categories) before they reach the upstream

### No secrets

The News feature uses zero API keys. Nothing under `src/app/api/news/` references `process.env`. If you ever introduce a paid API, scope its key to a `server-only` module under `src/lib/` and document the rotation procedure in `SECURITY.md`.

---

## Mobile UX

Designed for **320–414 px viewport first**, expanded to desktop with `sm:` (≥640 px) breakpoints.

### Page header

Stacks vertically on phones (title above, location pill below) so a long city name like "Lingampalli, Telangana" can't push the subtitle off-screen. Side-by-side on desktop.

### Tab strip

Full-bleed horizontal scroll on phones (`-mx-3` cancels the page gutter so the strip touches the screen edge), wraps on desktop. A right-edge gradient fade gives users a visual hint that there's more to scroll.

Each tab pill: icon + short label (e.g. "Weather", "Air"). Long-form labels ("Air Quality", "AI / Tech") only show in the expanded desktop layout.

### News cards

- Thumbnail: 64×64 on mobile, 80×80 on desktop. The featured (first) card has a 16:9 hero image instead.
- Card padding `p-3` on mobile, `p-4` on desktop.
- Title `line-clamp-3` so a long headline can't push everything down.
- Share button on every card → uses Web Share API on supported browsers, falls back to clipboard via `shareOrCopy()` from `src/lib/share.ts`.

### Markets

Always 2-up grid on mobile (single full-width column looked stretched and empty). Quotes are formatted with `en-IN` locale so values display as `78,493.54` not `78493.54`.

### Search/filter

Each feed-list panel shows a client-side filter input when ≥4 items are loaded — narrows the rendered list by title/source/summary. No extra fetch.

### Touch targets

All interactive elements are ≥44 px tall (Apple HIG minimum). The location-picker rows use `py-2.5` and the search input uses `py-2.5`.

---

## Adding a new tab

1. Pick a free, key-less data source. Probe it locally first (`curl -s -o NUL -w "%{http_code}\n" <url>`) to confirm it doesn't 401/403/CORS-fail.
2. Add a new route under `src/app/api/news/<name>/route.ts`. Set `export const revalidate = <seconds>` and accept `?city=` / `?lat=&lon=` if your data is location-dependent.
3. Add a panel component to `src/components/news/panels.tsx` (or split into its own file if `panels.tsx` is getting large). Follow the existing pattern: `useState` for data + loading + error, `useCallback` for the fetch, `<SkeletonCards>` while loading, `<ErrorState>` on failure. Mobile-first sizing (smaller fonts/padding by default, `sm:` for desktop).
4. Add the tab to the `Tab` union and the `TABS` array in `src/app/dashboard/news/page.tsx`.
5. Wire the new panel into the conditional render block at the bottom of the page.
6. Update this doc.

---

## Operational notes

- **All caching is in-process via `revalidate`** — no Redis, no external cache. Means each Vercel function instance maintains its own cache. That's fine for our scale (hundreds of users, not millions).
- **Upstream timeouts**: `fetchFeed()` in `src/lib/rss.ts` aborts after 6 s. Other routes use the default Node fetch timeout (no explicit limit) — if Open-Meteo or Yahoo ever stall, the route will hang up to ~30 s before Vercel kills it. Acceptable trade-off given how rarely these fail.
- **No telemetry / tracking** is sent to any of these third parties beyond the request itself. We don't pass user IDs, session info, or auth tokens.

---

## Files at a glance

```
src/
├── app/
│   ├── api/news/
│   │   ├── weather/route.ts           # Open-Meteo forecast
│   │   ├── air-quality/route.ts       # Open-Meteo AQI
│   │   ├── feeds/route.ts             # RSS aggregator (traffic/local/ai)
│   │   ├── cricket/route.ts           # Google News (cricket)
│   │   ├── markets/route.ts           # Yahoo Finance v8
│   │   ├── panchang/route.ts          # Local computation + Open-Meteo sun times
│   │   ├── fuel/route.ts              # Google News (fuel)
│   │   └── geocode/route.ts           # Nominatim reverse + Open-Meteo forward
│   └── dashboard/news/
│       └── page.tsx                   # Page shell + tab switcher
├── components/news/
│   ├── LocationPicker.tsx             # 📍 city pill + popover
│   └── panels.tsx                     # All 5 panel components (Weather, AQI, Markets, Panchang, FeedList)
├── hooks/
│   └── useGeoLocation.ts              # Geolocation + reverse-geocode + localStorage
└── lib/
    ├── rss.ts                         # Dependency-free RSS/Atom parser
    └── share.ts                       # Web Share API + clipboard fallback
```
