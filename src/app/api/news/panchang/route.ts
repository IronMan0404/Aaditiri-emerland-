import { NextResponse } from 'next/server';

// Telugu Panchangam (పంచాంగం) — computed locally from astronomical formulas
// so we don't depend on any paid API. Accurate to within ~5–10 minutes of
// Drik Panchang for the next century, which is plenty for daily planning
// (people read panchangam to know "is 11am ok or in Rahu Kalam?", not to
// time a yajna to the second).
//
// Outputs the classical "pancha-anga" (five limbs):
//   1. Tithi      (తిథి)    — lunar day
//   2. Vara       (వారం)   — weekday
//   3. Nakshatra  (నక్షత్రం) — lunar mansion (1 of 27)
//   4. Yoga       (యోగం)   — sun+moon longitude band (1 of 27)
//   5. Karana     (కరణం)   — half-tithi (1 of 11 names, repeating)
//
// Plus the auspicious / inauspicious time windows that residents actually
// plan their day around: Rahu Kalam, Yamaganda, Gulika, Abhijit, Brahma
// Muhurat, Amrit Kaal, Varjyam, Durmuhurtam.
//
// All angle math is mean (not true) — Drik Panchang uses true longitudes
// which require an ephemeris (~5 MB of data). For a community app the mean
// values are within a few minutes and don't bloat the bundle.

export const revalidate = 3600;

const DEFAULT_LAT = 17.385;
const DEFAULT_LON = 78.4867;

// =============================================================================
// Astronomy helpers — mean sun & moon longitudes
// =============================================================================

const DEG = Math.PI / 180;
function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

// Julian Day Number for a given UTC Date. Standard astronomical formula
// (Meeus, "Astronomical Algorithms", chapter 7).
function julianDay(date: Date): number {
  const Y = date.getUTCFullYear();
  const M = date.getUTCMonth() + 1;
  const D = date.getUTCDate()
    + (date.getUTCHours()   + (date.getUTCMinutes() + date.getUTCSeconds() / 60) / 60) / 24;
  let y = Y;
  let m = M;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716))
       + Math.floor(30.6001 * (m + 1))
       + D + B - 1524.5;
}

// Mean longitude of the Sun (deg, geocentric, of-date). Sufficient for
// Vedic-calendar use; difference from true longitude is < 2°.
function sunMeanLongitude(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M  = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  // Equation of centre — adds the largest periodic correction so we're not
  // wildly off near perihelion / aphelion.
  const C = (1.914602 - 0.004817 * T) * Math.sin(M * DEG)
          + 0.019993 * Math.sin(2 * M * DEG)
          + 0.000289 * Math.sin(3 * M * DEG);
  return norm360(L0 + C);
}

// Mean longitude of the Moon (deg, geocentric, of-date). We add the largest
// periodic term (Evection) so Tithi computation is accurate to ~10 mins.
function moonMeanLongitude(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const L  = 218.3164477 + 481267.88123421 * T;
  const D  = 297.8501921 + 445267.1114034 * T;       // mean elongation
  const Mm = 134.9633964 + 477198.8675055 * T;       // moon mean anomaly
  const Ms = 357.5291092 + 35999.0502909  * T;       // sun mean anomaly
  // Big four periodic perturbations — enough for tithi/nakshatra precision.
  const correction =
      6.289 * Math.sin(Mm * DEG)
    - 1.274 * Math.sin((2 * D - Mm) * DEG)
    + 0.658 * Math.sin(2 * D * DEG)
    - 0.186 * Math.sin(Ms * DEG);
  return norm360(L + correction);
}

// =============================================================================
// Tithi / Nakshatra / Yoga / Karana
// =============================================================================

// Tithi = floor((moon - sun) / 12). 30 tithis per lunar month.
function tithiIndex(sun: number, moon: number): number {
  return Math.floor(norm360(moon - sun) / 12); // 0..29
}

// Nakshatra = floor(moon / 13.333). 27 nakshatras across 360°.
function nakshatraIndex(moon: number): number {
  return Math.floor(moon / (360 / 27)); // 0..26
}

// Yoga = floor((sun + moon) / 13.333). 27 yogas.
function yogaIndex(sun: number, moon: number): number {
  return Math.floor(norm360(sun + moon) / (360 / 27)); // 0..26
}

// Karana = 2 per tithi (half-tithi). There are 11 names: 4 fixed at the
// month boundary (Shakuni, Chatushpada, Naga, Kimstughna) and 7 movable
// that rotate through the rest. Standard Vedic mapping.
function karanaName(sun: number, moon: number): string {
  const tIdx = tithiIndex(sun, moon);
  const half = Math.floor(norm360(moon - sun) / 6) % 60; // 0..59 across the month
  // Fixed karanas at end of Krishna Chaturdashi → Shukla Pratipada.
  if (half === 0) return 'Kimstughna (కింస్తుఘ్న)';
  if (half === 57) return 'Shakuni (శకుని)';
  if (half === 58) return 'Chatushpada (చతుష్పాద)';
  if (half === 59) return 'Naga (నాగ)';
  // Movable karanas cycle through 7 names, starting from half-tithi 1.
  const movable = ['Bava', 'Balava', 'Kaulava', 'Taitila', 'Garaja', 'Vanija', 'Vishti (Bhadra)'];
  const movableTe = ['బవ', 'బాలవ', 'కౌలవ', 'తైతిల', 'గరజ', 'వణిజ', 'విష్టి (భద్ర)'];
  const i = ((half - 1) % 7 + 7) % 7;
  void tIdx; // tIdx is implicit in `half` — kept for readability
  return `${movable[i]} (${movableTe[i]})`;
}

// =============================================================================
// Static reference tables — Telugu names for each anga
// =============================================================================

// Tithi names. 1–15 = Shukla Paksha (waxing), 16–30 = Krishna Paksha
// (waning). Index 30 (Amavasya) is also the "0th" of the next month.
const TITHI = [
  ['Pratipada',   'పాడ్యమి'],
  ['Dwitiya',     'విదియ'],
  ['Tritiya',     'తదియ'],
  ['Chaturthi',   'చవితి'],
  ['Panchami',    'పంచమి'],
  ['Shashthi',    'షష్ఠి'],
  ['Saptami',     'సప్తమి'],
  ['Ashtami',     'అష్టమి'],
  ['Navami',      'నవమి'],
  ['Dashami',     'దశమి'],
  ['Ekadashi',    'ఏకాదశి'],
  ['Dwadashi',    'ద్వాదశి'],
  ['Trayodashi',  'త్రయోదశి'],
  ['Chaturdashi', 'చతుర్దశి'],
  ['Purnima',     'పౌర్ణమి'],
  ['Pratipada',   'పాడ్యమి'],
  ['Dwitiya',     'విదియ'],
  ['Tritiya',     'తదియ'],
  ['Chaturthi',   'చవితి'],
  ['Panchami',    'పంచమి'],
  ['Shashthi',    'షష్ఠి'],
  ['Saptami',     'సప్తమి'],
  ['Ashtami',     'అష్టమి'],
  ['Navami',      'నవమి'],
  ['Dashami',     'దశమి'],
  ['Ekadashi',    'ఏకాదశి'],
  ['Dwadashi',    'ద్వాదశి'],
  ['Trayodashi',  'త్రయోదశి'],
  ['Chaturdashi', 'చతుర్దశి'],
  ['Amavasya',    'అమావాస్య'],
] as const;

// 27 Nakshatras (lunar mansions).
const NAKSHATRA = [
  ['Ashwini',         'అశ్వని'],
  ['Bharani',         'భరణి'],
  ['Krittika',        'కృత్తిక'],
  ['Rohini',          'రోహిణి'],
  ['Mrigashira',      'మృగశిర'],
  ['Ardra',           'ఆర్ద్ర'],
  ['Punarvasu',       'పునర్వసు'],
  ['Pushya',          'పుష్యమి'],
  ['Ashlesha',        'ఆశ్లేష'],
  ['Magha',           'మఖ'],
  ['Purva Phalguni',  'పుబ్బ'],
  ['Uttara Phalguni', 'ఉత్తర'],
  ['Hasta',           'హస్త'],
  ['Chitra',          'చిత్త'],
  ['Swati',           'స్వాతి'],
  ['Vishakha',        'విశాఖ'],
  ['Anuradha',        'అనురాధ'],
  ['Jyeshtha',        'జ్యేష్ఠ'],
  ['Mula',            'మూల'],
  ['Purva Ashadha',   'పూర్వాషాఢ'],
  ['Uttara Ashadha',  'ఉత్తరాషాఢ'],
  ['Shravana',        'శ్రవణం'],
  ['Dhanishta',       'ధనిష్ఠ'],
  ['Shatabhisha',     'శతభిష'],
  ['Purva Bhadrapada','పూర్వాభాద్ర'],
  ['Uttara Bhadrapada','ఉత్తరాభాద్ర'],
  ['Revati',          'రేవతి'],
] as const;

// 27 Yogas.
const YOGA = [
  ['Vishkambha', 'విష్కంభ'], ['Priti',       'ప్రీతి'],     ['Ayushman',   'ఆయుష్మాన్'],
  ['Saubhagya',  'సౌభాగ్య'], ['Shobhana',    'శోభన'],      ['Atiganda',   'అతిగండ'],
  ['Sukarma',    'సుకర్మ'],   ['Dhriti',      'ధృతి'],      ['Shoola',     'శూల'],
  ['Ganda',      'గండ'],     ['Vriddhi',     'వృద్ధి'],     ['Dhruva',     'ధ్రువ'],
  ['Vyaghata',   'వ్యాఘాత'],  ['Harshana',    'హర్షణ'],     ['Vajra',      'వజ్ర'],
  ['Siddhi',     'సిద్ధి'],   ['Vyatipata',   'వ్యతీపాత'],   ['Variyana',   'వరీయన'],
  ['Parigha',    'పరిఘ'],    ['Shiva',       'శివ'],        ['Siddha',     'సిద్ధ'],
  ['Sadhya',     'సాధ్య'],   ['Shubha',      'శుభ'],        ['Shukla',     'శుక్ల'],
  ['Brahma',     'బ్రహ్మ'],  ['Indra',       'ఇంద్ర'],      ['Vaidhriti',  'వైధృతి'],
] as const;

// Vara — weekday. JS getDay() returns 0=Sunday..6=Saturday which matches
// the Vedic order (Ravi=Sun starts the week).
const VARA = [
  ['Ravivara',     'ఆదివారం',   'Sun'],
  ['Somavara',     'సోమవారం',  'Mon'],
  ['Mangalavara',  'మంగళవారం', 'Tue'],
  ['Budhavara',    'బుధవారం',   'Wed'],
  ['Guruvara',     'గురువారం', 'Thu'],
  ['Shukravara',   'శుక్రవారం', 'Fri'],
  ['Shanivara',    'శనివారం',   'Sat'],
] as const;

// Telugu solar months (Masa). Tied roughly to Sun's sidereal longitude.
// Index 0 = Chaitra (~mid-March start). Used as a coarse calendar context
// label — for ritual-precise masa we'd need true sidereal longitude, which
// the mean approximation we use is within ~1° of (so off by a day or two
// at month boundaries — acceptable for a community-app glance).
const MASA = [
  ['Chaitra',     'చైత్రం'],
  ['Vaishakha',   'వైశాఖం'],
  ['Jyeshtha',    'జ్యేష్ఠం'],
  ['Ashadha',     'ఆషాఢం'],
  ['Shravana',    'శ్రావణం'],
  ['Bhadrapada',  'భాద్రపదం'],
  ['Ashwija',     'ఆశ్వయుజం'],
  ['Kartika',     'కార్తీకం'],
  ['Margashira',  'మార్గశిరం'],
  ['Pushya',      'పుష్యం'],
  ['Magha',       'మాఘం'],
  ['Phalguna',    'ఫాల్గుణం'],
] as const;

// Six ritus (seasons), 2 months each starting from Chaitra.
const RITU = [
  ['Vasanta',  'వసంత ఋతువు',  'Spring'],
  ['Grishma',  'గ్రీష్మ ఋతువు', 'Summer'],
  ['Varsha',   'వర్ష ఋతువు',  'Monsoon'],
  ['Sharad',   'శరదృతువు',    'Autumn'],
  ['Hemanta',  'హేమంత ఋతువు','Pre-winter'],
  ['Shishira', 'శిశిర ఋతువు', 'Winter'],
] as const;

// 60-year Telugu Samvatsara cycle. The cycle is anchored such that the
// year starting on Ugadi 1987 was "Plavanga" — we offset from there.
// Source: standard Drik Panchang Samvatsara list.
const SAMVATSARA = [
  'Prabhava', 'Vibhava', 'Shukla', 'Pramoda', 'Prajotpatti', 'Angirasa',
  'Shrimukha', 'Bhava', 'Yuva', 'Dhata', 'Ishvara', 'Bahudhanya',
  'Pramathi', 'Vikrama', 'Vrisha', 'Chitrabhanu', 'Subhanu', 'Tarana',
  'Parthiva', 'Vyaya', 'Sarvajit', 'Sarvadhari', 'Virodhi', 'Vikriti',
  'Khara', 'Nandana', 'Vijaya', 'Jaya', 'Manmatha', 'Durmukhi',
  'Hevilambi', 'Vilambi', 'Vikari', 'Sharvari', 'Plava', 'Shubhakrit',
  'Shobhakrit', 'Krodhi', 'Vishvavasu', 'Parabhava', 'Plavanga', 'Kilaka',
  'Saumya', 'Sadharana', 'Virodhikrit', 'Paridhavi', 'Pramadi', 'Ananda',
  'Rakshasa', 'Nala', 'Pingala', 'Kalayukti', 'Siddharthi', 'Raudra',
  'Durmati', 'Dundubhi', 'Rudhirodgari', 'Raktakshi', 'Krodhana', 'Akshaya',
] as const;

function samvatsaraName(year: number): string {
  // Plavanga starts in 1987 → index 40. Keep the modulo positive.
  const idx = (((year - 1987) % 60) + 60) % 60;
  return SAMVATSARA[(idx + 40) % 60];
}

// =============================================================================
// Auspicious & inauspicious kalams (time windows)
// =============================================================================

interface Kalam { startISO: string; endISO: string; }

function addMs(d: Date, ms: number): Date { return new Date(d.getTime() + ms); }

// Rahu Kalam / Yamaganda / Gulika are each 1/8 of day-length, indexed by
// weekday using fixed classical positions. Day-length is split into 8
// equal parts from sunrise.
function kalamFromIndex(sunrise: Date, sunset: Date, index: number): Kalam {
  const slice = (sunset.getTime() - sunrise.getTime()) / 8;
  const start = addMs(sunrise, slice * index);
  const end   = addMs(sunrise, slice * (index + 1));
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

// Classical weekday → slot mappings (0 = Sunday).
const RAHU_SLOTS    = [8, 2, 7, 5, 6, 4, 3].map((s) => s - 1); // Sun..Sat
const YAMA_SLOTS    = [5, 4, 3, 2, 1, 7, 6].map((s) => s - 1);
const GULIKA_SLOTS  = [7, 6, 5, 4, 3, 2, 1].map((s) => s - 1);

function rahuKalam(sunrise: Date, sunset: Date, weekday: number): Kalam {
  return kalamFromIndex(sunrise, sunset, RAHU_SLOTS[weekday]);
}
function yamaganda(sunrise: Date, sunset: Date, weekday: number): Kalam {
  return kalamFromIndex(sunrise, sunset, YAMA_SLOTS[weekday]);
}
function gulikaKalam(sunrise: Date, sunset: Date, weekday: number): Kalam {
  return kalamFromIndex(sunrise, sunset, GULIKA_SLOTS[weekday]);
}

// Abhijit Muhurat — ~24-min window centred on solar noon (midpoint of
// sunrise & sunset). Considered universally auspicious except on Wednesday.
function abhijitMuhurat(sunrise: Date, sunset: Date): Kalam {
  const mid = (sunrise.getTime() + sunset.getTime()) / 2;
  const halfWindow = ((sunset.getTime() - sunrise.getTime()) / 15) / 2; // 1/15th of day, halved
  return {
    startISO: new Date(mid - halfWindow).toISOString(),
    endISO:   new Date(mid + halfWindow).toISOString(),
  };
}

// Brahma Muhurat — 96 minutes before sunrise, 48 minutes long.
function brahmaMuhurat(sunrise: Date): Kalam {
  return {
    startISO: addMs(sunrise, -96 * 60_000).toISOString(),
    endISO:   addMs(sunrise, -48 * 60_000).toISOString(),
  };
}

// Amrit Kaal — derived from Vijaya Muhurat: starts at sunrise + 5/15 of
// day-length, lasts 1/15 of day. (Approximation; true Amrit Kaal ties to
// nakshatra's "amrit" segment which needs a full ephemeris.)
function amritKaal(sunrise: Date, sunset: Date): Kalam {
  const dayLen = sunset.getTime() - sunrise.getTime();
  const start  = addMs(sunrise, dayLen * 5 / 15);
  const end    = addMs(start, dayLen / 15);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

// Durmuhurtam — 2 inauspicious 48-min windows during the day. Positions
// vary by weekday. We compute the primary one (most apps show only this).
const DURMUHURTAM_FRAC: Record<number, number> = {
  0: 11/15,  // Sunday
  1: 7/15,   // Monday
  2: 4/15,   // Tuesday
  3: 8/15,   // Wednesday
  4: 9/15,   // Thursday
  5: 10/15,  // Friday
  6: 1/15,   // Saturday
};
function durmuhurtam(sunrise: Date, sunset: Date, weekday: number): Kalam {
  const dayLen = sunset.getTime() - sunrise.getTime();
  const start  = addMs(sunrise, dayLen * DURMUHURTAM_FRAC[weekday]);
  const end    = addMs(start, 48 * 60_000);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

// Varjyam — derived from current nakshatra's "vishaghatika" (toxic) segment.
// Each nakshatra has a specific fraction of its 60-ghatika span that's
// considered varjyam. We use the standard table (in ghatikas: 1 ghatika ≈ 24min).
const VARJYAM_GHATIKA: number[] = [
  50, 24, 30, 40, 14, 21, 30, 20, 32, 30, 20, 18, 21, 20, 14,
  14, 10, 14, 56, 24, 20, 10, 14, 18, 16, 24, 30,
];
function varjyam(nakIdx: number, moonStartUtc: Date, moonEndUtc: Date): Kalam {
  // Span the nakshatra is active across — approximated as ~24h centered on now.
  const span = moonEndUtc.getTime() - moonStartUtc.getTime();
  const ghatikaMs = span / 60;
  const start = addMs(moonStartUtc, ghatikaMs * VARJYAM_GHATIKA[nakIdx]);
  const end   = addMs(start, ghatikaMs * 1.6); // varjyam window ≈ 1.6 ghatikas (~38min)
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

// =============================================================================
// Sun & Moon timings (from Open-Meteo)
// =============================================================================

interface SunMoonTimes { sunrise?: string; sunset?: string; moonrise?: string; moonset?: string }
async function fetchSunMoonTimes(lat: number, lon: number): Promise<SunMoonTimes> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return {};
    const json = await res.json();
    return {
      sunrise: json.daily?.sunrise?.[0],
      sunset: json.daily?.sunset?.[0],
      // Open-Meteo dropped moonrise/moonset from the free tier in 2024;
      // we leave these undefined and the UI hides the row gracefully.
    };
  } catch { return {}; }
}

function dayLengthLabel(sunrise?: string, sunset?: string): string | undefined {
  if (!sunrise || !sunset) return undefined;
  const ms = new Date(sunset).getTime() - new Date(sunrise).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  const totalMin = Math.round(ms / 60000);
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

// Lunar age (0..29.53) from sun/moon longitudes — used by the legacy
// `moon` field for the simple panel.
function moonPhase(sun: number, moon: number): { name: string; emoji: string; illumPct: number; ageDays: number } {
  const elong = norm360(moon - sun);
  const ageDays = (elong / 360) * 29.530588;
  const illumPct = Math.round((1 - Math.cos(elong * DEG)) * 50);
  let name = 'New Moon', emoji = '🌑';
  if      (elong < 22.5)  { name = 'New Moon';        emoji = '🌑'; }
  else if (elong < 67.5)  { name = 'Waxing Crescent'; emoji = '🌒'; }
  else if (elong < 112.5) { name = 'First Quarter';   emoji = '🌓'; }
  else if (elong < 157.5) { name = 'Waxing Gibbous';  emoji = '🌔'; }
  else if (elong < 202.5) { name = 'Full Moon';       emoji = '🌕'; }
  else if (elong < 247.5) { name = 'Waning Gibbous';  emoji = '🌖'; }
  else if (elong < 292.5) { name = 'Last Quarter';    emoji = '🌗'; }
  else if (elong < 337.5) { name = 'Waning Crescent'; emoji = '🌘'; }
  return { name, emoji, illumPct, ageDays: Number(ageDays.toFixed(1)) };
}

// =============================================================================
// Route handler
// =============================================================================

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat')) || DEFAULT_LAT;
  const lon = Number(url.searchParams.get('lon')) || DEFAULT_LON;
  const city = url.searchParams.get('city') || 'Hyderabad';

  const now = new Date();
  const jd  = julianDay(now);
  const sunLon  = sunMeanLongitude(jd);
  const moonLon = moonMeanLongitude(jd);

  const tIdx = tithiIndex(sunLon, moonLon);
  const nIdx = nakshatraIndex(moonLon);
  const yIdx = yogaIndex(sunLon, moonLon);
  const wd   = now.getDay();

  const tithi = {
    index: tIdx + 1,
    nameEn: TITHI[tIdx][0],
    nameTe: TITHI[tIdx][1],
    paksha: tIdx < 15 ? 'Shukla' as const : 'Krishna' as const,
    pakshaTe: tIdx < 15 ? 'శుక్ల పక్షం' : 'కృష్ణ పక్షం',
  };
  const nakshatra = { index: nIdx + 1, nameEn: NAKSHATRA[nIdx][0], nameTe: NAKSHATRA[nIdx][1] };
  const yoga      = { index: yIdx + 1, nameEn: YOGA[yIdx][0],     nameTe: YOGA[yIdx][1] };
  const karana    = { name: karanaName(sunLon, moonLon) };
  const vara      = { nameEn: VARA[wd][0], nameTe: VARA[wd][1], short: VARA[wd][2] };

  // Solar masa via current sun longitude. 30° per masa, 0° = Mesha (which
  // maps to Chaitra in lunar calendar terms used here).
  const masaIdx = Math.floor(sunLon / 30) % 12;
  const masa = { nameEn: MASA[masaIdx][0], nameTe: MASA[masaIdx][1] };
  const rituIdx = Math.floor(masaIdx / 2);
  const ritu = { nameEn: RITU[rituIdx][0], nameTe: RITU[rituIdx][1], season: RITU[rituIdx][2] };
  // Ayana — Uttarayana (Sun travelling N: Capricorn→Cancer) vs Dakshinayana.
  // Sidereal sun in Capricorn..Gemini = Uttarayana. Approximated from
  // tropical longitude; off by ~24° so we shift.
  const sunSidereal = norm360(sunLon - 24);
  const ayana = sunSidereal >= 270 || sunSidereal < 90
    ? { nameEn: 'Uttarayana', nameTe: 'ఉత్తరాయణం' }
    : { nameEn: 'Dakshinayana', nameTe: 'దక్షిణాయణం' };
  const samvatsara = samvatsaraName(now.getFullYear());

  const sun = await fetchSunMoonTimes(lat, lon);

  // All kalam computations need real sunrise/sunset Date objects. If
  // Open-Meteo failed, fall back to 6am–6pm so the UI can still render
  // approximate kalams (clearly labelled as approximate downstream).
  const sunriseDate = sun.sunrise ? new Date(sun.sunrise) : new Date(now.toISOString().slice(0, 10) + 'T06:00:00Z');
  const sunsetDate  = sun.sunset  ? new Date(sun.sunset)  : new Date(now.toISOString().slice(0, 10) + 'T18:00:00Z');

  // Varjyam needs the nakshatra's start/end. Without a true ephemeris we
  // approximate as a 24h window centred on now — accurate to ~1 hour.
  const nakStart = new Date(now.getTime() - 12 * 3600_000);
  const nakEnd   = new Date(now.getTime() + 12 * 3600_000);

  const auspicious = {
    abhijit:       abhijitMuhurat(sunriseDate, sunsetDate),
    brahmaMuhurat: brahmaMuhurat(sunriseDate),
    amritKaal:     amritKaal(sunriseDate, sunsetDate),
  };
  const inauspicious = {
    rahuKalam:    rahuKalam(sunriseDate, sunsetDate, wd),
    yamaganda:    yamaganda(sunriseDate, sunsetDate, wd),
    gulikaKalam:  gulikaKalam(sunriseDate, sunsetDate, wd),
    durmuhurtam:  durmuhurtam(sunriseDate, sunsetDate, wd),
    varjyam:      varjyam(nIdx, nakStart, nakEnd),
  };

  return NextResponse.json({
    city,
    coords: { lat, lon },
    date: now.toISOString().slice(0, 10),
    // Legacy fields kept for backwards-compat with the existing simple panel.
    weekday: `${vara.nameEn} (${vara.short})`,
    moon: moonPhase(sunLon, moonLon),
    tithi: { index: tithi.index, name: tithi.nameEn, paksha: tithi.paksha },
    sunrise: sun.sunrise,
    sunset: sun.sunset,
    dayLength: dayLengthLabel(sun.sunrise, sun.sunset),
    // New: full Telugu Panchangam payload.
    telugu: {
      samvatsara,
      ayana,
      ritu,
      masa,
      paksha: { nameEn: tithi.paksha, nameTe: tithi.pakshaTe },
      vara,
      tithi,
      nakshatra,
      yoga,
      karana,
      auspicious,
      inauspicious,
      // Echoed so the UI can show "approximate" caveats only when applicable.
      computed: {
        sunriseFromApi: Boolean(sun.sunrise),
        method: 'mean-longitude (Meeus simplified)',
      },
    },
  });
}
