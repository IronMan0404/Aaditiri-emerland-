import { NextResponse } from 'next/server';

// Yahoo Finance's v8 chart endpoint is unauthenticated and returns enough
// info to compute "current price" + "% change vs previous close". We use
// it for NIFTY 50, SENSEX, USD/INR and a couple of popular ETFs.
//
// The v7 /quote endpoint started requiring auth in 2024; v8 /chart still
// works as long as we send a real-looking User-Agent header.

interface Symbol { id: string; yahoo: string; name: string; type: 'index' | 'fx' | 'commodity' }

const SYMBOLS: Symbol[] = [
  { id: 'nifty',   yahoo: '%5ENSEI',  name: 'NIFTY 50',   type: 'index' },
  { id: 'sensex',  yahoo: '%5EBSESN', name: 'SENSEX',     type: 'index' },
  { id: 'banknif', yahoo: '%5ENSEBANK', name: 'BANK NIFTY', type: 'index' },
  { id: 'usdinr',  yahoo: 'USDINR=X', name: 'USD / INR',  type: 'fx'    },
  { id: 'eurinr',  yahoo: 'EURINR=X', name: 'EUR / INR',  type: 'fx'    },
  { id: 'gold',    yahoo: 'GC=F',     name: 'Gold (USD)', type: 'commodity' },
];

// 5-minute cache. Markets move minute-to-minute when open, but for a
// dashboard glance 5 minutes is plenty fresh and keeps the upstream
// rate-limit-friendly.
export const revalidate = 300;

interface Quote {
  id: string;
  name: string;
  type: Symbol['type'];
  price: number | null;
  prevClose: number | null;
  changePct: number | null;
  changeAbs: number | null;
  currency: string;
  marketState: string;
  updatedAt: string | null;
}

async function fetchQuote(sym: Symbol): Promise<Quote> {
  // Asking for `range=5d&interval=1d` gives us the last several daily
  // closes \u2014 we need at least two so we can compute the percentage
  // change against the previous close even if today's session is closed.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.yahoo}?range=5d&interval=1d`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      headers: {
        // Yahoo blocks the default Node UA \u2014 a browser-ish UA gets through.
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
    };
  } catch {
    return {
      id: sym.id, name: sym.name, type: sym.type,
      price: null, prevClose: null, changeAbs: null, changePct: null,
      currency: '', marketState: '', updatedAt: null,
    };
  }
}

export async function GET() {
  const quotes = await Promise.all(SYMBOLS.map(fetchQuote));
  return NextResponse.json({
    quotes,
    updatedAt: new Date().toISOString(),
  });
}
