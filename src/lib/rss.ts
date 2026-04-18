// Lightweight RSS / Atom parser. We deliberately avoid adding `rss-parser`
// (or any XML library) for one tiny use-case \u2014 RSS feeds have a small
// well-known shape and a 50-line regex parser handles them fine. If a feed
// breaks, we just drop its items and serve the others.

export interface FeedItem {
  title: string;
  link: string;
  publishedAt: string;        // ISO string, best-effort
  source: string;             // Feed name, set by the caller
  summary?: string;           // Short text snippet
  imageUrl?: string;          // Optional thumbnail (from <enclosure>, <media:thumbnail>, or first <img> in description)
}

// Extract every <tag>...</tag> match (non-greedy, dotAll-equivalent via [\s\S]).
function matchAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// Pull the first <tag>...</tag> body, or empty string.
function pick(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return m ? m[1] : '';
}

// Atom uses <link href="..." /> (self-closing) instead of <link>...</link>.
function pickAtomLink(xml: string): string {
  const m = /<link[^>]*\bhref="([^"]+)"[^>]*\/?>/i.exec(xml);
  return m ? m[1] : '';
}

// Decode the handful of XML/HTML entities feeds actually emit. Done as a
// separate pass because many feeds (TOI, Deccan Chronicle, Google News)
// embed escaped HTML (`&lt;a href...&gt;`) INSIDE their <description>, so
// we need to decode entities before we can strip tags.
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&'); // last so we don't double-decode &amp;lt; etc.
}

// Strip CDATA, decode entities, then nuke HTML tags. Order matters:
// 1. CDATA unwrap                  \u2014 reveals raw text + escaped HTML
// 2. Entity decode                 \u2014 turns &lt;a&gt; into <a>
// 3. Strip <a>/<img>/<script> etc. \u2014 removes attribute noise (URLs!)
// 4. Strip remaining tags          \u2014 keeps only text content
// 5. Collapse whitespace
function clean(s: string): string {
  return decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')
    .replace(/<img\b[^>]*\/?>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Coerce whatever the feed says about publish time into an ISO string.
// Falls back to "now" so items still sort somewhere reasonable.
function parseDate(s: string): string {
  if (!s) return new Date().toISOString();
  const t = Date.parse(clean(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

// Pull the most likely thumbnail URL out of an item block. Different feeds
// use different conventions, so we try them in order of reliability:
//   1. <enclosure url="..." type="image/..." />     (TOI, The Hindu)
//   2. <media:thumbnail url="..." />                (some news feeds)
//   3. <media:content url="..." medium="image" />   (Atom-style media)
//   4. First <img src="..."> embedded in description (after entity decode)
// If none are found we return undefined and the UI just renders no image.
function extractImage(block: string): string | undefined {
  const patterns: RegExp[] = [
    /<enclosure[^>]*\burl=["']([^"']+\.(?:jpe?g|png|webp|gif))["'][^>]*\/?>/i,
    /<media:thumbnail[^>]*\burl=["']([^"']+)["'][^>]*\/?>/i,
    /<media:content[^>]*\burl=["']([^"']+\.(?:jpe?g|png|webp|gif))["'][^>]*\/?>/i,
  ];
  for (const re of patterns) {
    const m = re.exec(block);
    if (m) return m[1];
  }
  // Fall back: scan description / content for an embedded <img>. The
  // description body is XML-escaped so we have to decode entities first.
  const desc = pick(block, 'description') || pick(block, 'content') || pick(block, 'summary');
  if (desc) {
    const decoded = desc
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
    const m = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(decoded);
    if (m) return m[1];
  }
  return undefined;
}

export function parseFeed(xml: string, sourceName: string, limit = 8): FeedItem[] {
  // RSS 2.0: <item>, Atom: <entry>. Try both.
  const blocks = [...matchAll(xml, 'item'), ...matchAll(xml, 'entry')];
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = clean(pick(block, 'title'));
    if (!title) continue;
    let link = clean(pick(block, 'link'));
    if (!link) link = pickAtomLink(block);
    const pubRaw = pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated') || pick(block, 'dc:date');
    const summary = clean(pick(block, 'description') || pick(block, 'summary') || pick(block, 'content'));
    items.push({
      title,
      link,
      publishedAt: parseDate(pubRaw),
      source: sourceName,
      summary: summary ? summary.slice(0, 240) : undefined,
      imageUrl: extractImage(block),
    });
    if (items.length >= limit) break;
  }
  return items;
}

// Fetch + parse a single feed, with a hard timeout so a slow upstream
// doesn't hold up the whole aggregation. Errors are swallowed and turned
// into an empty array \u2014 the caller already merges multiple feeds.
export async function fetchFeed(
  url: string,
  sourceName: string,
  opts: { limit?: number; timeoutMs?: number; revalidate?: number } = {}
): Promise<FeedItem[]> {
  const { limit = 8, timeoutMs = 6000, revalidate = 900 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // The route handler that wraps this call already has its own
  // `export const revalidate = 900` so the JSON output is cached for
  // 15 minutes. We pass `revalidate` through here too so production
  // fetches share the upstream cache; in dev Next ignores it anyway
  // and always re-fetches, which is what we want during testing.
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate },
      headers: {
        // Some publishers (e.g. The Hindu) serve a placeholder page to the
        // default Node UA. A browser-ish UA gets the real RSS payload.
        'User-Agent': 'Mozilla/5.0 (compatible; AEMerlandNewsBot/1.0)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml, sourceName, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
