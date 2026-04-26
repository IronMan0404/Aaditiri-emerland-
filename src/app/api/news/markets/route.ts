import { NextResponse } from 'next/server';

// Yahoo Finance's v8 chart endpoint is unauthenticated and returns enough
// info to compute "current price" + "% change vs previous close". We use
// it for NIFTY 50, SENSEX, USD/INR and a couple of popular ETFs.
//
// The v7 /quote endpoint started requiring auth in 2024; v8 /chart still
// works as long as we send a real-looking User-Agent header.

interface SymbolDef {
  id: string;
  yahoo: string;
  name: string;
  type: 'index' | 'fx' | 'commodity' | 'derived';
}

const SYMBOLS: SymbolDef[] = [
  { id: 'nifty',   yahoo: '%5ENSEI',  name: 'NIFTY 50',   type: 'index' },
  { id: 'sensex',  yahoo: '%5EBSESN', name: 'SENSEX',     type: 'index' },
  { id: 'banknif', yahoo: '%5ENSEBANK', name: 'BANK NIFTY', type: 'index' },
  { id: 'usdinr',  yahoo: 'USDINR=X', name: 'USD / INR',  type: 'fx'    },
  { id: 'eurinr',  yahoo: 'EURINR=X', name: 'EUR / INR',  type: 'fx'    },
  { id: 'gold',    yahoo: 'GC=F',     name: 'Gold (USD/oz)', type: 'commodity' },
];

// 5-minute cache. Markets move minute-to-minute when open, but for a
// dashboard glance 5 minutes is plenty fresh and keeps the upstream
// rate-limit-friendly.
export const revalidate = 300;

interface Quote {
  id: string;
  name: string;
  type: SymbolDef['type'];
  price: number | null;
  prevClose: number | null;
  changePct: number | null;
  changeAbs: number | null;
  currency: string;
  marketState: string;
  updatedAt: string | null;
  /**
   * Optional human-friendly subtitle for derived rows. The base symbol
   * rows leave this null and the UI falls back to the type label.
   */
  subtitle?: string | null;
}

async function fetchQuote(sym: SymbolDef): Promise<Quote> {
  // Asking for `range=5d&interval=1d` gives us the last several daily
  // closes — we need at least two so we can compute the percentage
  // change against the previous close even if today's session is closed.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.yahoo}?range=5d&interval=1d`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      headers: {
        // Yahoo blocks the default Node UA — a browser-ish UA gets through.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`yahoo ${res.status}`);
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta ?? {};
    const closes: number[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((n: number | null): n is number => typeof n === 'number');
    const price = typeof meta.regularMarketPrice === 'number'
      ? meta.regularMarketPrice
      : (validCloses[validCloses.length - 1] ?? null);
    const prevClose = typeof meta.chartPreviousClose === 'number'
      ? meta.chartPreviousClose
      : (validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null);
    const changeAbs = price !== null && prevClose !== null ? price - prevClose : null;
    const changePct = price !== null && prevClose ? ((price - prevClose) / prevClose) * 100 : null;
    return {
      id: sym.id,
      name: sym.name,
      type: sym.type,
      price,
      prevClose,
      changeAbs,
      changePct,
      currency: meta.currency ?? '',
      marketState: meta.marketState ?? '',
      updatedAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      subtitle: null,
    };
  } catch {
    return {
      id: sym.id, name: sym.name, type: sym.type,
      price: null, prevClose: null, changeAbs: null, changePct: null,
      currency: '', marketState: '', updatedAt: null, subtitle: null,
    };
  }
}

/**
 * Indian gold market price per 10g, derived from Yahoo's COMEX gold
 * future (USD/oz) × USD/INR. We surface BOTH 24K and 22K because every
 * Indian jeweller quotes those two purities side by side.
 *
 * Why we don't hit a paid "live Indian jeweller" API:
 *   - The official price is set by IBJA every morning ~10am IST.
 *   - Free public IBJA scraping is unreliable (their site is JS-rendered).
 *   - Indian rates *do* track the dollar spot price + USD/INR very closely
 *     (within ~1% before GST + making charges). For a dashboard glance
 *     "what's gold worth roughly today" this derivation is good enough,
 *     and the disclaimer in the UI makes the limitation honest.
 *
 * Conversion: 1 troy ounce = 31.1034768 grams.
 *   24K (pure)  = spot * (10 / 31.1035)
 *   22K (916)   = 24K * (22/24) ≈ 24K * 0.91667
 *
 * GST (3%) and jeweller making charges are NOT added — the disclaimer
 * tells the user that.
 */
const TROY_OZ_TO_G = 31.1034768;

function deriveGoldInrQuotes(goldUsdOz: Quote, usdInr: Quote): Quote[] {
  // Need both base prices to derive anything meaningful.
  if (goldUsdOz.price === null || usdInr.price === null) return [];

  const inrPerOz = goldUsdOz.price * usdInr.price;
  const inrPer10g24k = (inrPerOz / TROY_OZ_TO_G) * 10;
  const inrPer10g22k = inrPer10g24k * (22 / 24);

  // Combine % change of each leg for an approximate INR-side change.
  // Not strictly mathematically right (would need today's vs yesterday's
  // *INR* close from the same instrument) but for a dashboard glance the
  // sum of "USD gold change % + USD/INR change %" is a reasonable proxy.
  const baseChange =
    (goldUsdOz.changePct ?? 0) + (usdInr.changePct ?? 0);
  const combinedChangePct = goldUsdOz.changePct === null && usdInr.changePct === null
    ? null
    : baseChange;

  return [
    {
      id: 'gold24kinr',
      name: 'Gold 24K',
      type: 'derived',
      price: Math.round(inrPer10g24k),
      prevClose: null,
      changeAbs: null,
      changePct: combinedChangePct,
      currency: '₹',
      marketState: '',
      updatedAt: goldUsdOz.updatedAt,
      subtitle: '₹/10g (market spot)',
    },
    {
      id: 'gold22kinr',
      name: 'Gold 22K',
      type: 'derived',
      price: Math.round(inrPer10g22k),
      prevClose: null,
      changeAbs: null,
      changePct: combinedChangePct,
      currency: '₹',
      marketState: '',
      updatedAt: goldUsdOz.updatedAt,
      subtitle: '₹/10g (market spot)',
    },
  ];
}

export async function GET() {
  const quotes = await Promise.all(SYMBOLS.map(fetchQuote));

  // Build derived gold ₹/10g rows from existing fetches — no extra HTTP cost.
  const goldUsd = quotes.find((q) => q.id === 'gold');
  const usdInr = quotes.find((q) => q.id === 'usdinr');
  const derived = goldUsd && usdInr ? deriveGoldInrQuotes(goldUsd, usdInr) : [];

  // Order: Indian indices, Indian gold (most-glanced), FX, then USD gold (raw).
  const ordered = [
    ...quotes.filter((q) => ['nifty', 'sensex', 'banknif'].includes(q.id)),
    ...derived,
    ...quotes.filter((q) => ['usdinr', 'eurinr'].includes(q.id)),
    ...quotes.filter((q) => q.id === 'gold'),
  ];

  return NextResponse.json({
    quotes: ordered,
    updatedAt: new Date().toISOString(),
  });
}
