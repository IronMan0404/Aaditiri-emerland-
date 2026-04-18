import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/rss';

// Free live-score APIs all either need keys or are rate-limited. Instead
// we lean on Google News RSS scoped to current-day cricket coverage,
// which gives a continuously updated stream of headlines from Cricbuzz,
// ESPNCricinfo, NDTV Sports etc. The headlines themselves usually
// include the latest score (e.g. "IND 245/4 (45) vs AUS").

export const revalidate = 600;

const FEEDS = [
  { name: 'India',           url: 'https://news.google.com/rss/search?q=india+cricket+today+score&hl=en-IN&gl=IN&ceid=IN:en' },
  { name: 'IPL',             url: 'https://news.google.com/rss/search?q=IPL+2026+match+score&hl=en-IN&gl=IN&ceid=IN:en' },
  { name: 'International',   url: 'https://news.google.com/rss/search?q=cricket+test+ODI+T20+score&hl=en-IN&gl=IN&ceid=IN:en' },
];

export async function GET() {
  const batches = await Promise.all(
    FEEDS.map((f) => fetchFeed(f.url, f.name, { limit: 8, revalidate: 600 }))
  );
  // Dedupe by link, sort by recency.
  const seen = new Set<string>();
  const all = batches.flat()
    .filter((it) => {
      const key = (it.link || it.title).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 20);
  return NextResponse.json({ items: all });
}
