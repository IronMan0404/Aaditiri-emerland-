'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Shield,
  Sparkles,
  Phone,
  Search,
  Loader2,
  AlertCircle,
  RotateCcw,
  X,
  Users,
} from 'lucide-react';

// Resident-facing society staff directory.
//
// Lists every active security guard and housekeeper with their
// name, role, photo, on-duty status, and a tap-to-call phone.
// Backed by /api/staff/directory which calls the
// public.resident_visible_staff() SECURITY DEFINER function —
// that function intentionally excludes email, address, hire
// date, and other admin-only audit columns.
//
// Layout follows the /staff/residents convention: gradient
// header, role chips, debounced search, list with pulse-dot
// for on-duty members.

type StaffRole = 'security' | 'housekeeping';

interface StaffEntry {
  id: string;
  full_name: string;
  staff_role: StaffRole;
  phone: string | null;
  photo_url: string | null;
  on_duty_since: string | null;
}

interface DirectoryResponse {
  staff: StaffEntry[];
}

const ROLE_CONFIG: Record<
  StaffRole,
  { label: string; tint: string; iconColor: string; Icon: typeof Shield }
> = {
  security: {
    label: 'Security',
    tint: 'bg-emerald-50 border-emerald-100',
    iconColor: 'text-emerald-700',
    Icon: Shield,
  },
  housekeeping: {
    label: 'Housekeeping',
    tint: 'bg-sky-50 border-sky-100',
    iconColor: 'text-sky-700',
    Icon: Sparkles,
  },
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  const first = parts[0][0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

function formatOnDutyClock(iso: string | null, nowMs: number | null): string {
  if (!iso) return '';
  if (nowMs === null) return 'on duty';
  const diffMs = nowMs - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'on duty · just now';
  if (mins < 60) return `on duty · ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins === 0 ? `on duty · ${hours}h` : `on duty · ${hours}h ${remMins}m`;
  }
  const days = Math.floor(hours / 24);
  return `on duty · ${days}d`;
}

export default function DashboardStaffPage() {
  const [staff, setStaff] = useState<StaffEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | StaffRole>('all');
  const [nowMs, setNowMs] = useState<number | null>(null);

  const reqToken = useRef(0);

  const load = async () => {
    const myToken = ++reqToken.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/staff/directory', { cache: 'no-store' });
      if (myToken !== reqToken.current) return;
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as DirectoryResponse;
      setStaff(j.staff ?? []);
    } catch (e) {
      if (myToken !== reqToken.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load staff');
      setStaff([]);
    } finally {
      if (myToken === reqToken.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Live "on duty for X mins" ticker — same pattern the admin
  // page uses. We compute it client-side in a useEffect to avoid
  // a hydration mismatch.
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Debounce search so the list doesn't re-filter on every
  // keystroke — pure client-side, but the perf is the same.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(() => {
    return staff.filter((s) => {
      if (roleFilter !== 'all' && s.staff_role !== roleFilter) return false;
      if (!debouncedQuery) return true;
      const q = debouncedQuery;
      return (
        s.full_name.toLowerCase().includes(q) ||
        (s.phone ?? '').toLowerCase().includes(q)
      );
    });
  }, [staff, roleFilter, debouncedQuery]);

  const onDutyCount = useMemo(
    () => staff.filter((s) => s.on_duty_since).length,
    [staff],
  );

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] rounded-2xl p-5 text-white shadow-lg mb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[#1B5E20] ring-2 ring-white/30 flex items-center justify-center">
            <Users size={20} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-white/80">
              Society staff
            </p>
            <h1 className="text-lg font-bold leading-tight truncate">
              Security &amp; Housekeeping
            </h1>
          </div>
          {onDutyCount > 0 && (
            <span className="inline-flex items-center gap-1 bg-emerald-500/20 border border-emerald-300/40 text-emerald-50 text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap">
              <span className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-pulse" />
              {onDutyCount} on duty
            </span>
          )}
        </div>
        <p className="text-[11px] text-white/80 leading-relaxed">
          Tap a phone number to call. Members on duty right now are pinned to
          the top.
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
            placeholder="Search by name or phone…"
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
            onClick={load}
            className="text-gray-400 hover:text-gray-600 ml-1"
            aria-label="Refresh"
            disabled={loading}
          >
            <RotateCcw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Role chips */}
      <div className="flex items-center gap-1.5 mb-3">
        {(['all', 'security', 'housekeeping'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoleFilter(r)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full border ${
              roleFilter === r
                ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            {r === 'all' ? 'All' : ROLE_CONFIG[r].label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading && staff.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
            <Loader2 className="animate-spin" size={16} /> Loading staff…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-4 text-rose-700 text-sm bg-rose-50">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            {debouncedQuery
              ? `No staff match "${debouncedQuery}".`
              : staff.length === 0
                ? 'No staff registered yet.'
                : 'No staff in this category.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((s) => {
              const cfg = ROLE_CONFIG[s.staff_role];
              const onDuty = !!s.on_duty_since;
              return (
                <li
                  key={s.id}
                  className={`px-4 py-3 flex items-start gap-3 ${
                    onDuty ? 'bg-emerald-50/40' : ''
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 ${
                      onDuty
                        ? 'bg-emerald-100 ring-2 ring-emerald-300'
                        : 'bg-gray-100'
                    }`}
                  >
                    {s.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.photo_url}
                        alt={s.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span
                        className={`text-xs font-bold ${
                          onDuty ? 'text-emerald-700' : 'text-gray-500'
                        }`}
                      >
                        {initialsOf(s.full_name)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {s.full_name}
                      </p>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border inline-flex items-center gap-1 ${cfg.tint} ${cfg.iconColor}`}
                      >
                        <cfg.Icon size={9} />
                        {cfg.label}
                      </span>
                      {onDuty && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                          {formatOnDutyClock(s.on_duty_since, nowMs)}
                        </span>
                      )}
                    </div>
                    {s.phone ? (
                      <a
                        href={`tel:${s.phone}`}
                        className="inline-flex items-center gap-1 mt-1.5 text-xs text-[#1B5E20] font-medium hover:underline"
                      >
                        <Phone size={11} /> {s.phone}
                      </a>
                    ) : (
                      <p className="text-[11px] text-gray-400 italic mt-1.5">
                        No phone on file
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Privacy note */}
      <p className="text-[10px] text-gray-400 text-center mt-3 leading-relaxed">
        For privacy, addresses, emails, and other personal details are not
        shown. Please be respectful when calling outside of duty hours.
      </p>
    </div>
  );
}
