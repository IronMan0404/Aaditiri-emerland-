'use client';

// Staff home component used by both /staff/security and /staff/
// housekeeping. The two routes are nearly identical — the only
// thing that changes is the role banner color + label — so we
// share the entire body and pass the role in as a prop.
//
// State machine
// -------------
//   loading → idle (not on shift) ──[Check In tap]──► on_shift
//                                                       │
//                                                       └──[Check Out tap]──► idle
//
// Display
// -------
//   - Role banner (Security or Housekeeping)
//   - Big primary CTA: Check In if idle, Check Out if on shift
//   - Live elapsed-on-shift label (refreshes every 30s)
//   - Attendance history: last 30 days of completed shifts
//   - Sign out at the bottom
//
// We deliberately do NOT show the resident-app shell (no bottom nav,
// no admin links, no /dashboard chrome). Staff should never be
// tempted to navigate elsewhere.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import toast from 'react-hot-toast';
import {
  Shield,
  Sparkles,
  LogIn,
  LogOut,
  Clock,
  Calendar,
  AlertCircle,
  Loader2,
  RotateCcw,
} from 'lucide-react';

type StaffRole = 'security' | 'housekeeping';

interface OpenShift {
  id: string;
  check_in_at: string;
  check_out_at: string | null;
  notes: string | null;
}

interface HistoryRow {
  id: string;
  check_in_at: string;
  check_out_at: string | null;
  duty_date: string;
  notes: string | null;
}

interface AttendanceResponse {
  open_shift: OpenShift | null;
  history: HistoryRow[];
}

const ROLE_THEME: Record<
  StaffRole,
  { label: string; tint: string; iconBg: string; iconColor: string; Icon: typeof Shield }
> = {
  security: {
    label: 'Security',
    tint: 'from-[#1B5E20] to-[#2E7D32]',
    iconBg: 'bg-[#1B5E20]',
    iconColor: 'text-white',
    Icon: Shield,
  },
  housekeeping: {
    label: 'Housekeeping',
    tint: 'from-[#0E5F8A] to-[#0277BD]',
    iconBg: 'bg-[#0E5F8A]',
    iconColor: 'text-white',
    Icon: Sparkles,
  },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return '< 1 min';
  const totalMins = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

interface Props {
  role: StaffRole;
  staffName: string;
}

export default function StaffHome({ role, staffName }: Props) {
  const theme = ROLE_THEME[role];
  const router = useRouter();

  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Tick state used to recompute the elapsed-time label without
  // calling Date.now() during render (purity rule).
  const [now, setNow] = useState<number | null>(null);

  // Stable counter for client-only IDs (avoids Date.now() lint).
  const tickRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/staff/attendance', { cache: 'no-store' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error || 'Could not load attendance.');
        return;
      }
      const j = (await res.json()) as AttendanceResponse;
      setData(j);
    } catch {
      toast.error('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Drive the elapsed label.
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => {
      tickRef.current += 1;
      setNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function handleToggle(action: 'check_in' | 'check_out') {
    setBusy(true);
    try {
      const res = await fetch('/api/staff/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(j.error || 'Could not record action.');
        return;
      }
      toast.success(action === 'check_in' ? 'Checked in' : 'Checked out');
      await load();
    } catch {
      toast.error('Network error.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/auth/login');
  }

  const open = data?.open_shift ?? null;
  const elapsedLabel =
    open && now !== null
      ? formatDuration(now - new Date(open.check_in_at).getTime())
      : null;

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      {/* Role banner */}
      <div
        className={`bg-gradient-to-br ${theme.tint} rounded-2xl p-5 text-white shadow-lg mb-4`}
      >
        <div className="flex items-center gap-3 mb-1">
          <div
            className={`w-10 h-10 rounded-xl ${theme.iconBg} flex items-center justify-center ring-2 ring-white/30`}
          >
            <theme.Icon size={20} className={theme.iconColor} />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-white/80">
              {theme.label} duty
            </p>
            <h1 className="text-lg font-bold leading-tight truncate">
              Hi, {staffName.split(' ')[0]}
            </h1>
          </div>
        </div>
      </div>

      {/* Status / CTA card */}
      <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
            <Loader2 className="animate-spin mr-2" size={16} /> Loading…
          </div>
        ) : open ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                On shift
              </p>
            </div>
            <p className="text-sm text-gray-700 mb-1">
              You checked in at{' '}
              <span className="font-semibold">{formatTime(open.check_in_at)}</span>
            </p>
            {elapsedLabel && (
              <p className="text-xs text-gray-500 mb-4 flex items-center gap-1">
                <Clock size={12} /> Working for {elapsedLabel}
              </p>
            )}
            <button
              type="button"
              onClick={() => handleToggle('check_out')}
              disabled={busy}
              className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <LogOut size={16} />}
              Check Out
            </button>
          </>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
              Off shift
            </p>
            <p className="text-sm text-gray-600 mb-4">
              You&apos;re not currently checked in. Tap below when you start your shift.
            </p>
            <button
              type="button"
              onClick={() => handleToggle('check_in')}
              disabled={busy}
              className="w-full py-3.5 bg-[#1B5E20] hover:bg-[#155318] text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />}
              Check In
            </button>
          </>
        )}
      </div>

      {/* Attendance history */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-gray-400" />
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              Last 30 days
            </h3>
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Refresh"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        {data && data.history.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-4 text-center">
            No attendance recorded yet.
          </p>
        ) : (
          <div className="space-y-1">
            {(data?.history ?? []).map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-gray-700 font-medium">
                    {formatDate(row.duty_date)}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {formatTime(row.check_in_at)} →{' '}
                    {row.check_out_at ? (
                      formatTime(row.check_out_at)
                    ) : (
                      <span className="text-emerald-600 font-semibold">on shift</span>
                    )}
                  </p>
                </div>
                {row.check_out_at && (
                  <span className="text-xs text-gray-500 font-mono shrink-0">
                    {formatDuration(
                      new Date(row.check_out_at).getTime() -
                        new Date(row.check_in_at).getTime(),
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sign out */}
      <button
        type="button"
        onClick={handleSignOut}
        className="w-full py-2.5 bg-white text-gray-600 hover:text-gray-800 text-xs font-semibold rounded-xl border border-gray-200 hover:border-gray-300 flex items-center justify-center gap-2"
      >
        <LogOut size={14} /> Sign out
      </button>

      {/* Footer note */}
      <p className="text-[10px] text-gray-400 text-center mt-4 leading-snug flex items-center justify-center gap-1">
        <AlertCircle size={10} />
        For password reset or profile changes, contact your admin.
      </p>
    </div>
  );
}
