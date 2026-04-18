'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, X, Megaphone, Calendar, Radio, Newspaper, Image as ImageIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase';

type ResultKind = 'announcement' | 'event' | 'broadcast' | 'update' | 'photo';

interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  snippet?: string;
  href: string;
  meta?: string;
}

const KIND_META: Record<ResultKind, { label: string; icon: typeof Megaphone; tint: string }> = {
  announcement: { label: 'Announcement', icon: Megaphone, tint: 'bg-purple-100 text-purple-700' },
  event:        { label: 'Event',        icon: Calendar,  tint: 'bg-orange-100 text-orange-700' },
  broadcast:    { label: 'Broadcast',    icon: Radio,     tint: 'bg-green-100 text-green-700' },
  update:       { label: 'Update',       icon: Newspaper, tint: 'bg-blue-100 text-blue-700' },
  photo:        { label: 'Photo',        icon: ImageIcon, tint: 'bg-pink-100 text-pink-700' },
};

// Simple debounce hook — we don't want to fire 5 parallel queries on every keystroke.
function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

// Escape user input before stuffing it into a Postgres ILIKE pattern. % and _
// are wildcards; left unescaped, "100%" becomes a slow scan-everything query.
function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const debouncedQ = useDebounced(q.trim(), 250);

  // Close the dropdown when the user clicks outside the search container.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpenDropdown(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (debouncedQ.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const pattern = `%${escapeIlike(debouncedQ)}%`;

      // Fan out: 5 lightweight parallel queries, each capped to a small limit
      // so the dropdown never balloons. RLS handles visibility — these are the
      // exact same tables the user can already read elsewhere in the app.
      const [a, ev, b, u, ph] = await Promise.all([
        supabase
          .from('announcements')
          .select('id, title, content, created_at')
          .or(`title.ilike.${pattern},content.ilike.${pattern}`)
          .order('created_at', { ascending: false })
          .limit(4),
        supabase
          .from('events')
          .select('id, title, description, location, date, time')
          .or(`title.ilike.${pattern},description.ilike.${pattern},location.ilike.${pattern}`)
          .order('date', { ascending: false })
          .limit(4),
        supabase
          .from('broadcasts')
          .select('id, title, message, created_at')
          .or(`title.ilike.${pattern},message.ilike.${pattern}`)
          .order('created_at', { ascending: false })
          .limit(4),
        supabase
          .from('updates')
          .select('id, title, content, category, created_at')
          .or(`title.ilike.${pattern},content.ilike.${pattern},category.ilike.${pattern}`)
          .order('created_at', { ascending: false })
          .limit(4),
        supabase
          .from('photos')
          .select('id, caption, url, created_at')
          .ilike('caption', pattern)
          .order('created_at', { ascending: false })
          .limit(4),
      ]);

      if (cancelled) return;

      const merged: SearchResult[] = [];
      (a.data ?? []).forEach((r: { id: string; title: string; content: string }) => merged.push({
        id: r.id, kind: 'announcement', title: r.title, snippet: r.content,
        href: '/dashboard/announcements',
      }));
      (ev.data ?? []).forEach((r: { id: string; title: string; description: string | null; location: string; date: string; time: string }) => merged.push({
        id: r.id, kind: 'event', title: r.title,
        snippet: r.description ?? r.location,
        meta: `${r.date} · ${r.time}`,
        href: '/dashboard/events',
      }));
      (b.data ?? []).forEach((r: { id: string; title: string; message: string }) => merged.push({
        id: r.id, kind: 'broadcast', title: r.title, snippet: r.message,
        href: '/dashboard/broadcasts',
      }));
      (u.data ?? []).forEach((r: { id: string; title: string; content: string; category: string }) => merged.push({
        id: r.id, kind: 'update', title: r.title, snippet: r.content, meta: r.category,
        href: '/dashboard/announcements',
      }));
      (ph.data ?? []).forEach((r: { id: string; caption: string | null }) => merged.push({
        id: r.id, kind: 'photo', title: r.caption || 'Untitled photo', href: '/dashboard/gallery',
      }));

      setResults(merged);
      setLoading(false);
    }
    run();
    return () => { cancelled = true; };
  }, [debouncedQ, supabase]);

  const showDropdown = openDropdown && q.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm border border-gray-200 px-3 py-2 focus-within:border-[#1B5E20] focus-within:ring-1 focus-within:ring-[#1B5E20]/20 transition">
        <Search size={16} className="text-gray-400 shrink-0" />
        <input
          type="search"
          inputMode="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpenDropdown(true); }}
          onFocus={() => setOpenDropdown(true)}
          placeholder="Search announcements, events, broadcasts…"
          className="flex-1 bg-transparent outline-none text-sm text-gray-900 placeholder:text-gray-400 min-w-0"
          aria-label="Search community content"
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); setResults([]); }}
            aria-label="Clear search"
            className="text-gray-400 hover:text-gray-600 p-0.5"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-xl shadow-lg border border-gray-200 max-h-[60vh] overflow-y-auto z-40">
          {loading ? (
            <div className="p-4 text-sm text-gray-400 text-center">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">No matches for &ldquo;{q.trim()}&rdquo;</div>
          ) : (
            <ul className="py-1">
              {results.map((r) => {
                const meta = KIND_META[r.kind];
                const Icon = meta.icon;
                return (
                  <li key={`${r.kind}:${r.id}`}>
                    <Link
                      href={r.href}
                      onClick={() => setOpenDropdown(false)}
                      className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50"
                    >
                      <span className={`w-8 h-8 rounded-lg ${meta.tint} flex items-center justify-center shrink-0`}>
                        <Icon size={14} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 truncate">{r.title}</span>
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold shrink-0">{meta.label}</span>
                        </span>
                        {r.snippet && (
                          <span className="block text-xs text-gray-500 line-clamp-1 mt-0.5">{r.snippet}</span>
                        )}
                        {r.meta && (
                          <span className="block text-[10px] text-gray-400 mt-0.5">{r.meta}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
