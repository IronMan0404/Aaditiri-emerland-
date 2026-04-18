import { NextResponse } from 'next/server';

// Open-Meteo's free Air Quality API. No key, includes US AQI + European
// AQI + raw pollutant concentrations. Updates every hour.
// https://open-meteo.com/en/docs/air-quality-api

const DEFAULT_LAT = 17.385;
const DEFAULT_LON = 78.4867;

// Cache 15 min \u2014 AQI changes slowly enough that hammering the upstream
// every page load would just waste bandwidth.
export const revalidate = 900;

// US EPA AQI bands. We mirror the official cut-offs and human-friendly
// labels here so the UI doesn't need a lookup table.
function aqiBand(usAqi: number): {
  label: string;
  color: string;
  advice: string;
} {
  if (usAqi <= 50)  return { label: 'Good',                            color: '#16A34A', advice: 'Air quality is satisfactory.' };
  if (usAqi <= 100) return { label: 'Moderate',                        color: '#FACC15', advice: 'Acceptable for most, sensitive groups should limit prolonged exertion.' };
  if (usAqi <= 150) return { label: 'Unhealthy for Sensitive Groups',  color: '#FB923C', advice: 'Children, elderly and people with lung conditions should reduce outdoor activity.' };
  if (usAqi <= 200) return { label: 'Unhealthy',                       color: '#EF4444', advice: 'Everyone may begin to experience effects \u2014 limit outdoor exertion.' };
  if (usAqi <= 300) return { label: 'Very Unhealthy',                  color: '#A855F7', advice: 'Health alert \u2014 avoid outdoor activity, wear an N95 mask outside.' };
  return                 { label: 'Hazardous',                         color: '#7E1D1D', advice: 'Emergency conditions \u2014 stay indoors, run an air purifier.' };
}

// Pick the highest-impact pollutant from the current snapshot. Numbers
// come from Open-Meteo in \u00b5g/m\u00b3 (or for CO, the same units).
function dominantPollutant(p: { pm2_5?: number; pm10?: number; ozone?: number; nitrogen_dioxide?: number; carbon_monoxide?: number }) {
  // We weight each pollutant by how much it matters for AQI \u2014 PM2.5 is
  // by far the biggest health driver in Indian cities, hence the boost.
  const scored: { name: string; score: number; raw: number; unit: string }[] = [
    { name: 'PM2.5',  score: (p.pm2_5 ?? 0) * 4, raw: p.pm2_5 ?? 0,  unit: '\u00b5g/m\u00b3' },
    { name: 'PM10',   score: (p.pm10 ?? 0) * 1, raw: p.pm10 ?? 0,    unit: '\u00b5g/m\u00b3' },
    { name: 'Ozone',  score: (p.ozone ?? 0) * 0.5, raw: p.ozone ?? 0, unit: '\u00b5g/m\u00b3' },
    { name: 'NO\u2082',     score: (p.nitrogen_dioxide ?? 0) * 1, raw: p.nitrogen_dioxide ?? 0, unit: '\u00b5g/m\u00b3' },
    { name: 'CO',     score: (p.carbon_monoxide ?? 0) * 0.05, raw: p.carbon_monoxide ?? 0, unit: '\u00b5g/m\u00b3' },
  ];
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

function parseCoords(request: Request): { lat: number; lon: number; city: string } {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const city = url.searchParams.get('city') ?? 'Hyderabad';
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { lat, lon, city };
  }
  return { lat: DEFAULT_LAT, lon: DEFAULT_LON, city: 'Hyderabad' };
}

export async function GET(request: Request) {
  const { lat, lon, city } = parseCoords(request);
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=pm2_5,pm10,us_aqi,european_aqi,carbon_monoxide,nitrogen_dioxide,ozone,sulphur_dioxide` +
    `&timezone=auto`;
  try {
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return NextResponse.json({ error: 'AQI provider unavailable' }, { status: 502 });
    const json = await res.json();
    const c = json.current ?? {};
    const usAqi = c.us_aqi ?? 0;
    const band = aqiBand(usAqi);
    const dominant = dominantPollutant({
      pm2_5: c.pm2_5,
      pm10: c.pm10,
      ozone: c.ozone,
      nitrogen_dioxide: c.nitrogen_dioxide,
      carbon_monoxide: c.carbon_monoxide,
    });

    return NextResponse.json({
      city,
      coords: { lat, lon },
      updatedAt: c.time ?? new Date().toISOString(),
      usAqi,
      europeanAqi: c.european_aqi,
      band,
      dominant,
      pollutants: {
        pm2_5: c.pm2_5,
        pm10: c.pm10,
        ozone: c.ozone,
        no2: c.nitrogen_dioxide,
        so2: c.sulphur_dioxide,
        co: c.carbon_monoxide,
      },
    });
  } catch {
    return NextResponse.json({ error: 'AQI fetch failed' }, { status: 500 });
  }
}
