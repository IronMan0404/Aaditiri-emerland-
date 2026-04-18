import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/rss';

// Reliable per-day petrol/diesel pricing endpoints all either need an API
// key or block scrapers (goodreturns blocks bots, NDTV's pricing page is
// JavaScript-rendered). We surface the latest news headlines about fuel
// prices in the user's city instead \u2014 readers get an accurate, dated
// number from the linked story rather than us inventing a stale value.

export const revalidate = 1800;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = (url.searchParams.get('city') ?? 'Hyderabad').trim() || 'Hyderabad';
  const items = await fetchFeed(
    `https://news.google.com/rss/search?q=${encodeURIComponent(city + ' petrol diesel price today')}&hl=en-IN&gl=IN&ceid=IN:en`,
    'Fuel news',
    { limit: 10, revalidate: 1800 }
  );
  return NextResponse.json({ city, items });
}
