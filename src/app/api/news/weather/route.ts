import { NextResponse } from 'next/server';

// Defaults are the community's home city \u2014 used when the client doesn't
// pass coordinates (first paint, server-rendered fallback, etc).
const DEFAULT_LAT = 17.385;
const DEFAULT_LON = 78.4867;
const DEFAULT_CITY = 'Hyderabad';

function buildOpenMeteoUrl(lat: number, lon: number) {
  // Open-Meteo's free forecast API. No API key, generous rate limits.
  // We pin timezone to "auto" so the server resolves it from coords \u2014 that
  // way the daily breakdown matches the user's actual local day boundaries.
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,sunrise,sunset` +
    `&timezone=auto&forecast_days=5`
  );
}

// Open-Meteo's WMO weather codes \u2192 short human label + emoji icon.
// Reference: https://open-meteo.com/en/docs (search "WMO Weather interpretation codes")
const WEATHER_CODE_MAP: Record<number, { label: string; icon: string }> = {
  0:  { label: 'Clear sky',                  icon: '\u2600\uFE0F' },
  1:  { label: 'Mostly clear',               icon: '\uD83C\uDF24\uFE0F' },
  2:  { label: 'Partly cloudy',              icon: '\u26C5' },
  3:  { label: 'Overcast',                   icon: '\u2601\uFE0F' },
  45: { label: 'Fog',                        icon: '\uD83C\uDF2B\uFE0F' },
  48: { label: 'Freezing fog',               icon: '\uD83C\uDF2B\uFE0F' },
  51: { label: 'Light drizzle',              icon: '\uD83C\uDF26\uFE0F' },
  53: { label: 'Drizzle',                    icon: '\uD83C\uDF26\uFE0F' },
  55: { label: 'Heavy drizzle',              icon: '\uD83C\uDF27\uFE0F' },
  61: { label: 'Light rain',                 icon: '\uD83C\uDF26\uFE0F' },
  63: { label: 'Rain',                       icon: '\uD83C\uDF27\uFE0F' },
  65: { label: 'Heavy rain',                 icon: '\uD83C\uDF27\uFE0F' },
  66: { label: 'Freezing rain',              icon: '\uD83C\uDF27\uFE0F' },
  67: { label: 'Heavy freezing rain',        icon: '\uD83C\uDF27\uFE0F' },
  71: { label: 'Light snow',                 icon: '\uD83C\uDF28\uFE0F' },
  73: { label: 'Snow',                       icon: '\uD83C\uDF28\uFE0F' },
  75: { label: 'Heavy snow',                 icon: '\u2744\uFE0F' },
  77: { label: 'Snow grains',                icon: '\u2744\uFE0F' },
  80: { label: 'Rain showers',               icon: '\uD83C\uDF26\uFE0F' },
  81: { label: 'Rain showers',               icon: '\uD83C\uDF27\uFE0F' },
  82: { label: 'Violent rain showers',       icon: '\u26C8\uFE0F' },
  85: { label: 'Snow showers',               icon: '\uD83C\uDF28\uFE0F' },
  86: { label: 'Heavy snow showers',         icon: '\uD83C\uDF28\uFE0F' },
  95: { label: 'Thunderstorm',               icon: '\u26C8\uFE0F' },
  96: { label: 'Thunderstorm with hail',     icon: '\u26C8\uFE0F' },
  99: { label: 'Severe thunderstorm + hail', icon: '\u26C8\uFE0F' },
};

function describe(code: number): { label: string; icon: string } {
  return WEATHER_CODE_MAP[code] ?? { label: 'Unknown', icon: '\uD83C\uDF21\uFE0F' };
}

// Derive simple alert lines from the raw forecast. Open-Meteo doesn't expose
// IMD warnings on the free tier, so we synthesise basic ones from the data
// we DO have: heavy rain probability, very high UV, and extreme temps.
interface Alert { level: 'info' | 'warning' | 'severe'; title: string; detail: string }

function deriveAlerts(daily: {
  precipitation_probability_max: (number | null)[];
  precipitation_sum: (number | null)[];
  uv_index_max: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  time: string[];
}): Alert[] {
  const alerts: Alert[] = [];
  for (let i = 0; i < daily.time.length; i += 1) {
    const day = daily.time[i];
    const when = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(day).toLocaleDateString('en-IN', { weekday: 'short' });
    const pop = daily.precipitation_probability_max[i] ?? 0;
    const mm  = daily.precipitation_sum[i] ?? 0;
    const uv  = daily.uv_index_max[i] ?? 0;
    const tmax = daily.temperature_2m_max[i] ?? 0;

    if (mm >= 50) alerts.push({ level: 'severe',  title: `${when}: Heavy rainfall expected`,  detail: `Up to ${mm.toFixed(0)} mm forecast \u2014 expect waterlogging in low-lying areas.` });
    else if (pop >= 70 && mm >= 10) alerts.push({ level: 'warning', title: `${when}: Rain likely`, detail: `${pop}% chance of rain, around ${mm.toFixed(0)} mm.` });
    if (uv >= 9) alerts.push({ level: 'warning', title: `${when}: Very high UV index`, detail: `UV index peaks at ${uv.toFixed(0)} \u2014 use sunscreen, avoid midday sun.` });
    if (tmax >= 42) alerts.push({ level: 'severe', title: `${when}: Heat alert`, detail: `Max temperature around ${tmax.toFixed(0)}\u00B0C \u2014 stay hydrated, avoid outdoor activity 11am\u20134pm.` });
  }
  return alerts.slice(0, 5);
}

// Cache the response on the Vercel edge for 10 minutes. Open-Meteo updates
// hourly so this is plenty fresh, and it means a sudden burst of dashboard
// loads doesn't fan out to 100 separate Open-Meteo calls.
//
// NOTE: this `revalidate` only applies to the route output without query
// params. For per-coords calls Next will key the cache on the full URL,
// so each unique lat/lon pair is cached separately for 10 minutes.
export const revalidate = 600;

function parseCoords(request: Request): { lat: number; lon: number; city: string } {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const city = url.searchParams.get('city') ?? '';
  if (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  ) {
    return { lat, lon, city: city.trim() || 'Your area' };
  }
  return { lat: DEFAULT_LAT, lon: DEFAULT_LON, city: DEFAULT_CITY };
}

export async function GET(request: Request) {
  const { lat, lon, city } = parseCoords(request);
  try {
    const res = await fetch(buildOpenMeteoUrl(lat, lon), { next: { revalidate: 600 } });
    if (!res.ok) {
      return NextResponse.json({ error: 'Weather provider unavailable' }, { status: 502 });
    }
    const raw = await res.json();

    const current = raw.current ?? {};
    const daily = raw.daily ?? {};
    const cw = describe(current.weather_code ?? 0);

    return NextResponse.json({
      location: city,
      coords: { lat, lon },
      updatedAt: current.time ?? new Date().toISOString(),
      sunrise: daily.sunrise?.[0],
      sunset: daily.sunset?.[0],
      current: {
        tempC: current.temperature_2m,
        feelsLikeC: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        precipitationMm: current.precipitation,
        windKmh: current.wind_speed_10m,
        isDay: current.is_day === 1,
        condition: cw.label,
        icon: cw.icon,
      },
      daily: (daily.time ?? []).map((day: string, i: number) => {
        const d = describe(daily.weather_code?.[i] ?? 0);
        return {
          date: day,
          label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(day).toLocaleDateString('en-IN', { weekday: 'short' }),
          condition: d.label,
          icon: d.icon,
          minC: daily.temperature_2m_min?.[i],
          maxC: daily.temperature_2m_max?.[i],
          rainMm: daily.precipitation_sum?.[i],
          rainChance: daily.precipitation_probability_max?.[i],
          uvIndex: daily.uv_index_max?.[i],
        };
      }),
      alerts: deriveAlerts(daily),
    });
  } catch (e) {
    console.error('[news/weather] failed', e);
    return NextResponse.json({ error: 'Weather fetch failed' }, { status: 500 });
  }
}
