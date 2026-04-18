import { NextResponse } from 'next/server';
import { fetchFeed, type FeedItem } from '@/lib/rss';

// Google News exposes a free no-auth RSS at /rss/search?q=... We use this
// for any city we don't have a hand-curated feed for.
const gnews = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

// Static (city-independent) feeds. AI/Tech is the same regardless of where
// the user is sitting.
const STATIC_SOURCES: Record<string, { name: string; url: string }[]> = {
  ai: [
    { name: 'The Verge \u2014 AI',         url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
    { name: 'MIT Technology Review',       url: 'https://www.technologyreview.com/feed/' },
    { name: 'Hacker News',                 url: 'https://hnrss.org/frontpage' },
  ],
};

// Hand-curated city feeds, where we actually trust the local newspapers'
// RSS. For other cities we fall back to a Google News search.
const CITY_FEEDS: Record<string, { name: string; url: string }[]> = {
  hyderabad: [
    { name: 'The Hindu \u2014 Hyderabad',           url: 'https://www.thehindu.com/news/cities/Hyderabad/feeder/default.rss' },
    { name: 'Times of India \u2014 Hyderabad',      url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128816011.cms' },
    { name: 'Deccan Chronicle \u2014 Hyderabad',    url: 'https://www.deccanchronicle.com/rss_feed/?section_url=cities/hyderabad' },
  ],
  bangalore: [
    { name: 'The Hindu \u2014 Bangalore',           url: 'https://www.thehindu.com/news/cities/bangalore/feeder/default.rss' },
    { name: 'Times of India \u2014 Bengaluru',      url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128833038.cms' },
  ],
  bengaluru: [
    { name: 'The Hindu \u2014 Bangalore',           url: 'https://www.thehindu.com/news/cities/bangalore/feeder/default.rss' },
    { name: 'Times of India \u2014 Bengaluru',      url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128833038.cms' },
  ],
  mumbai: [
    { name: 'Times of India \u2014 Mumbai',         url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128838597.cms' },
    { name: 'The Hindu \u2014 Mumbai',              url: 'https://www.thehindu.com/news/cities/mumbai/feeder/default.rss' },
  ],
  delhi: [
    { name: 'Times of India \u2014 Delhi',          url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128839596.cms' },
    { name: 'The Hindu \u2014 Delhi',               url: 'https://www.thehindu.com/news/cities/Delhi/feeder/default.rss' },
  ],
  chennai: [
    { name: 'Times of India \u2014 Chennai',        url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128833039.cms' },
    { name: 'The Hindu \u2014 Chennai',             url: 'https://www.thehindu.com/news/cities/chennai/feeder/default.rss' },
  ],
  pune: [
    { name: 'Times of India \u2014 Pune',           url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128821991.cms' },
    { name: 'The Hindu \u2014 Pune',                url: 'https://www.thehindu.com/news/cities/pune/feeder/default.rss' },
  ],
  kolkata: [
    { name: 'Times of India \u2014 Kolkata',        url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128830821.cms' },
  ],
};

function sourcesForCity(category: 'local' | 'traffic', city: string): { name: string; url: string }[] {
  const slug = city.trim().toLowerCase();
  if (category === 'local') {
    const curated = CITY_FEEDS[slug];
    if (curated && curated.length > 0) return curated;
    // Unknown city \u2014 fall back to Google News scoped to "<City> news".
    return [{ name: `${city} News`, url: gnews(`${city} city news`) }];
  }
  // Traffic / civic \u2014 always Google News (no newspaper has a clean traffic feed).
  return [
    { name: `${city} Traffic`, url: gnews(`${city} traffic OR road closure OR diversion`) },
    { name: `${city} Civic`,   url: gnews(`${city} water supply OR power outage OR municipal`) },
    { name: `${city} Transit`, url: gnews(`${city} metro OR bus OR transport`) },
  ];
}

const VALID_CATEGORIES = new Set(['traffic', 'hyderabad', 'local', 'ai']);

// Cache aggressively: most feeds publish a few times an hour at most, and a
// 15-minute window is plenty fresh for daily reading. This caps the number
// of upstream calls we make even on a busy day.
export const revalidate = 900;

function dedupe(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const it of items) {
    const key = (it.link || it.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category') ?? '';
  const city = (url.searchParams.get('city') ?? 'Hyderabad').trim() || 'Hyderabad';

  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: 'Invalid category', allowed: [...VALID_CATEGORIES] },
      { status: 400 }
    );
  }

  // Resolve the actual source list for this category + city combination.
  let sources: { name: string; url: string }[];
  if (category === 'ai') {
    sources = STATIC_SOURCES.ai;
  } else if (category === 'traffic') {
    sources = sourcesForCity('traffic', city);
  } else if (category === 'hyderabad') {
    // Legacy alias \u2014 always serves Hyderabad regardless of user location,
    // so existing bookmarks keep working.
    sources = sourcesForCity('local', 'Hyderabad');
  } else {
    // category === 'local' \u2014 dynamic per the user's city.
    sources = sourcesForCity('local', city);
  }

  // Fan out in parallel. fetchFeed already times out at 6s so the worst
  // case for the whole route is bounded around 6\u20137 seconds even if every
  // upstream is slow.
  const batches = await Promise.all(
    sources.map((s) => fetchFeed(s.url, s.name, { limit: 6, revalidate: 900 }))
  );
  const merged = dedupe(batches.flat()).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return NextResponse.json({
    category,
    city,
    items: merged.slice(0, 20),
  });
}
