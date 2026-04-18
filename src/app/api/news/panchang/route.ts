import { NextResponse } from 'next/server';

// Reliable free Panchang APIs all need API keys (Vedic Time, Drik, etc).
// We compute the basics locally instead \u2014 enough for daily planning:
//   * Sunrise / sunset / day length (from Open-Meteo, location-aware)
//   * Moon phase (computed via Conway's simple lunar-age algorithm)
//   * Tithi (lunar day, derived from moon phase)
//   * Vaar (weekday in Sanskrit / Hindi)
//
// For full astrological detail (nakshatra, yoga, karana, rahu kalam) the
// user can deep-link out from the Panchang card to a third-party site \u2014
// we keep this lightweight and always-on.

export const revalidate = 3600;

const DEFAULT_LAT = 17.385;
const DEFAULT_LON = 78.4867;

// Approximate lunar age in days for a given date. Conway's algorithm \u2014
// accurate to within ~1 day, which is fine for naming the tithi.
function lunarAgeDays(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  let r = y % 100;
  r = r % 19;
  if (r > 9) r -= 19;
  r = ((r * 11) % 30) + (m < 3 ? m + 2 : m) + d;
  if (y < 2000) r -= 4;
  else r -= 8.3;
  r = ((r % 30) + 30) % 30;
  return r;
}

function moonPhase(age: number): { name: string; emoji: string; illumPct: number } {
  // 8-phase classification used by most calendars.
  const illumPct = Math.round((1 - Math.cos((age / 29.53) * 2 * Math.PI)) * 50);
  if (age < 1.84566)  return { name: 'New Moon',         emoji: '\ud83c\udf11', illumPct };
  if (age < 5.53699)  return { name: 'Waxing Crescent',  emoji: '\ud83c\udf12', illumPct };
  if (age < 9.22831)  return { name: 'First Quarter',    emoji: '\ud83c\udf13', illumPct };
  if (age < 12.91963) return { name: 'Waxing Gibbous',   emoji: '\ud83c\udf14', illumPct };
  if (age < 16.61096) return { name: 'Full Moon',        emoji: '\ud83c\udf15', illumPct };
  if (age < 20.30228) return { name: 'Waning Gibbous',   emoji: '\ud83c\udf16', illumPct };
  if (age < 23.99361) return { name: 'Last Quarter',     emoji: '\ud83c\udf17', illumPct };
  if (age < 27.68493) return { name: 'Waning Crescent',  emoji: '\ud83c\udf18', illumPct };
  return                   { name: 'New Moon',         emoji: '\ud83c\udf11', illumPct };
}

// Names of 30 tithis. The lunar month has 15 in the waxing (Shukla Paksha)
// and 15 in the waning (Krishna Paksha) half. Tithi index = floor(age * 30 / 29.53).
const TITHI_NAMES = [
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
  'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
  'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Purnima',
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
  'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
  'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Amavasya',
];

const VAAR = ['Ravivar (Sun)', 'Somvar (Mon)', 'Mangalvar (Tue)', 'Budhvar (Wed)', 'Guruvar (Thu)', 'Shukravar (Fri)', 'Shanivar (Sat)'];

function tithiAt(age: number): { index: number; name: string; paksha: 'Shukla' | 'Krishna' } {
  const idx = Math.min(29, Math.floor((age / 29.53) * 30));
  return {
    index: idx + 1,
    name: TITHI_NAMES[idx],
    paksha: idx < 15 ? 'Shukla' : 'Krishna',
  };
}

async function fetchSunTimes(lat: number, lon: number): Promise<{ sunrise?: string; sunset?: string }> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return {};
    const json = await res.json();
    return {
      sunrise: json.daily?.sunrise?.[0],
      sunset: json.daily?.sunset?.[0],
    };
  } catch {
    return {};
  }
}

function dayLength(sunrise?: string, sunset?: string): string | undefined {
  if (!sunrise || !sunset) return undefined;
  const ms = new Date(sunset).getTime() - new Date(sunrise).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat')) || DEFAULT_LAT;
  const lon = Number(url.searchParams.get('lon')) || DEFAULT_LON;
  const city = url.searchParams.get('city') || 'Hyderabad';

  const now = new Date();
  const age = lunarAgeDays(now);
  const phase = moonPhase(age);
  const tithi = tithiAt(age);
  const sun = await fetchSunTimes(lat, lon);

  return NextResponse.json({
    city,
    coords: { lat, lon },
    date: now.toISOString().slice(0, 10),
    weekday: VAAR[now.getDay()],
    moon: { ...phase, ageDays: Number(age.toFixed(1)) },
    tithi,
    sunrise: sun.sunrise,
    sunset: sun.sunset,
    dayLength: dayLength(sun.sunrise, sun.sunset),
  });
}
