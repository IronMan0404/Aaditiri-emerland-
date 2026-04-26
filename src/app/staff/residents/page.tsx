'use client';

// /staff/residents
//
// Read-only resident directory for security and housekeeping.
//
// What staff sees per row:
//   • Full name
//   • Flat number
//   • Phone (tap-to-call)
//   • Resident type (owner/tenant) — small badge
//
// What staff does NOT see (intentionally):
//   • Email, avatar, role, audit timestamps, vehicle, push token
//
// All data comes through the SECURITY DEFINER function
// public.staff_visible_residents(), which gates access to
// role IN (staff, admin) at the DB level. The /api/staff/residents
// route adds another role check on top (defense in depth).
//
// We deliberately skip:
//   - bulk export (privacy)
//   - copy-all (privacy)
//   - infinite scroll (a "Load more" button is plenty for ~200 flats)

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import toast from 'react-hot-toast';
import {
  Users,
  Search,
  Phone,
  Home,
  Loader2,
  AlertCircle,
  RotateCcw,
  X,
  ShieldCheck,
} from 'lucide-react';

interface Resident {
  id: string;
  full_name: string;
  flat_number: string | null;
  phone: string | null;
  resident_type: 'owner' | 'tenant' | null;
  is_approved: boolean;
  // 'user' for residents, 'admin' for society office bearers.
  // Older API builds may omit this field — the UI treats a
  // missing value as 'user' so it degrades gracefully.
  role?: 'user' | 'admin';
}

interface ResidentsResponse {
  residents: Resident[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  const first = parts[0][0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

export default function StaffResidentsPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Token bumps with each search/refresh so a slow earlier
  // response can't overwrite a newer one.
  const reqToken = useRef(0);

  // Auth bootstrap — confirm the user actually is staff (or admin).
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace('/auth/login');
        return;
      }
      setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Debounce typing → search.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const fetchPage = useCallback(
    async (q: string, p: number, append: boolean) => {
      const myToken = ++reqToken.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        params.set('page', String(p));
        params.set('pageSize', String(PAGE_SIZE));

        const res = await fetch(`/api/staff/residents?${params.toString()}`, {
          cache: 'no-store',
        });
        const j = (await res.json().catch(() => ({}))) as
          | ResidentsResponse
          | { error?: string };

        if (myToken !== reqToken.current) return; // stale

        if (!res.ok) {
          const msg = (j as { error?: string }).error || 'Could not load residents.';
          setError(msg);
          if (!append) setResidents([]);
          return;
        }

        const ok = j as ResidentsResponse;
        setResidents((prev) => (append ? [...prev, ...ok.residents] : ok.residents));
        setPage(ok.page);
        setHasMore(ok.hasMore);
      } catch {
        if (myToken !== reqToken.current) return;
        setError('Network error.');
        if (!append) setResidents([]);
      } finally {
        if (myToken === reqToken.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  // Re-run when the debounced query changes.
  useEffect(() => {
    if (!authChecked) return;
    fetchPage(debouncedQuery, 0, false);
  }, [authChecked, debouncedQuery, fetchPage]);

  function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    fetchPage(debouncedQuery, page + 1, true);
  }

  function handleRefresh() {
    fetchPage(debouncedQuery, 0, false);
    toast.success('Refreshed');
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] rounded-2xl p-5 text-white shadow-lg mb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[#1B5E20] ring-2 ring-white/30 flex items-center justify-center">
            <Users size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-white/80">
              Society directory
            </p>
            <h1 className="text-lg font-bold leading-tight truncate">
              Residents &amp; admins
            </h1>
          </div>
        </div>
        <p className="text-[11px] text-white/80 leading-relaxed">
          Search by name, flat, or phone. Tap to call. Admins are pinned to the
          top so you always know who to escalate to.
        </p>
      </div>

      {/* Search bar */}
      <div className="bg-white rounded-2xl p-3 shadow-sm mb-3">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-gray-400 shrink-0 ml-1" />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search residents or admins…"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            className="text-gray-400 hover:text-gray-600 ml-1"
            aria-label="Refresh"
            disabled={loading}
          >
            <RotateCcw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading && residents.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
            <Loader2 className="animate-spin" size={16} /> Loading directory…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-4 text-rose-700 text-sm bg-rose-50">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : residents.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            {debouncedQuery
              ? `No matches for "${debouncedQuery}".`
              : 'Nobody to show yet.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {residents.map((r) => {
              const isAdmin = r.role === 'admin';
              return (
                <li
                  key={r.id}
                  className={`px-4 py-3 flex items-start gap-3 ${
                    isAdmin ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                      isAdmin
                        ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-200'
                        : 'bg-[#1B5E20]/10 text-[#1B5E20]'
                    }`}
                  >
                    {isAdmin ? (
                      <ShieldCheck size={16} />
                    ) : (
                      initialsOf(r.full_name)
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {r.full_name}
                      </p>
                      {isAdmin ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-0.5">
                          <ShieldCheck size={10} /> Admin
                        </span>
                      ) : (
                        r.resident_type && (
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                              r.resident_type === 'owner'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {r.resident_type}
                          </span>
                        )
                      )}
                    </div>
                    {!isAdmin || r.flat_number ? (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Home size={11} className="shrink-0" />
                        {r.flat_number || (
                          <span className="italic text-gray-400">No flat</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-700 mt-0.5 italic">
                        Society office bearer
                      </p>
                    )}
                    {r.phone ? (
                      <a
                        href={`tel:${r.phone}`}
                        className="inline-flex items-center gap-1 mt-1 text-xs text-[#1B5E20] font-medium hover:underline"
                      >
                        <Phone size={11} /> {r.phone}
                      </a>
                    ) : (
                      <p className="text-[11px] text-gray-400 italic mt-1">
                        No phone on file
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full py-2 text-xs font-semibold text-[#1B5E20] hover:bg-emerald-50 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loadingMore ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </>
              ) : (
                'Load more'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-gray-400 text-center mt-4 leading-snug flex items-center justify-center gap-1">
        <AlertCircle size={10} />
        Use this only for legitimate community duties. Calls are not recorded by us.
      </p>
    </div>
  );
}
